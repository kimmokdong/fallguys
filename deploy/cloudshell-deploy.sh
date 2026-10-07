#!/usr/bin/env bash
set -Eeuo pipefail
# AWS CloudShell(서울 리전)에서 실행하는 캠프 젤리 운영 배포 스크립트입니다. 절차는 deploy/DEPLOY_AWS.md를 봅니다.
# 사용법: bash cloudshell-deploy.sh <커밋> <패키지 sha256>
#   같은 폴더에 deploy/pack.sh가 만든 camp-jelly-<커밋>.tar.gz가 있어야 합니다.
# 접속 중인 사용자가 있으면 교체 전에 멈춥니다. 새 이미지의 npm test가 통과해야 game 컨테이너만 교체하고,
# 실패하면 이전 소스와 이미지로 되돌립니다. 공유 프록시(Caddy)는 재시작하거나 reload하지 않습니다.
# 기본 키는 CloudShell 임시 폴더에만 두고 끝나면 지우며, 22번 포트 규칙은 항상 원래대로 복원합니다.
TAG=${1:-}; SHA=${2:-}
if [[ ! "$TAG" =~ ^[0-9a-f]{7,40}$ || ! "$SHA" =~ ^[0-9a-f]{64}$ ]]; then echo '사용법: bash cloudshell-deploy.sh <커밋> <sha256>' >&2; exit 2; fi
PKG=camp-jelly-$TAG.tar.gz
test -f "$PKG"
export AWS_PAGER=''
DEPLOY_TMP=$(mktemp -d /tmp/camp-jelly-deploy.XXXXXX)
aws lightsail get-instance-port-states --region ap-northeast-2 --instance-name camp-jelly --output json > "$DEPLOY_TMP/ports.json"
python3 - "$DEPLOY_TMP" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); data=json.loads((p/'ports.json').read_text())
ports=[{k:v for k,v in x.items() if k in ('fromPort','toPort','protocol','cidrs','ipv6Cidrs','cidrListAliases')} for x in data['portStates'] if x['state']=='open']
(p/'restore.json').write_text(json.dumps(ports))
PY
cleanup() {
  rc=$?
  trap - EXIT
  if aws lightsail put-instance-public-ports --region ap-northeast-2 --instance-name camp-jelly --port-infos "file://$DEPLOY_TMP/restore.json" >/dev/null; then
    echo ACCESS_RESTORED
  else
    echo ACCESS_RESTORE_FAILED
    rc=1
  fi
  rm -f "$DEPLOY_TMP/key.pem"
  aws lightsail get-instance-port-states --region ap-northeast-2 --instance-name camp-jelly --query 'portStates[?fromPort==`22`].{cidrs:cidrs,aliases:cidrListAliases}' --output json
  exit "$rc"
}
trap cleanup EXIT
printf '%s  %s\n' "$SHA" "$PKG" | sha256sum -c -
aws lightsail download-default-key-pair --region ap-northeast-2 --query privateKeyBase64 --output text > "$DEPLOY_TMP/key.pem"
chmod 600 "$DEPLOY_TMP/key.pem"
ssh-keygen -y -f "$DEPLOY_TMP/key.pem" >/dev/null
DEPLOY_IP=$(curl -4fsS https://checkip.amazonaws.com | tr -d '\n')
[[ "$DEPLOY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
aws lightsail open-instance-public-ports --region ap-northeast-2 --instance-name camp-jelly --port-info "{\"fromPort\":22,\"toPort\":22,\"protocol\":\"tcp\",\"cidrs\":[\"$DEPLOY_IP/32\"],\"cidrListAliases\":[\"lightsail-connect\"]}" >/dev/null
scp -i "$DEPLOY_TMP/key.pem" -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 "$PKG" "ubuntu@43.200.53.244:/tmp/$PKG"
ssh -i "$DEPLOY_TMP/key.pem" -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15 ubuntu@43.200.53.244 "sudo env TAG=$TAG SHA=$SHA bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
LIVE=/opt/camp-jelly
PKG=/tmp/camp-jelly-$TAG.tar.gz
STAMP=$(date -u +%Y%m%dT%H%M%S)
STAGE=/tmp/camp-jelly-stage-$STAMP
BACKUP=$LIVE/backups/pre-$TAG-$STAMP.tar.gz
[[ -d "$LIVE" && -f "$LIVE/.env" && -f "$LIVE/compose.yaml" ]]
printf '%s  %s\n' "$SHA" "$PKG" | sha256sum -c -
cd "$LIVE"
# /healthz는 방 수만 알려 주므로, game 컨테이너의 3000번 포트 ESTABLISHED 연결 수를 직접 셉니다(Caddy의 WebSocket 중계 연결 포함).
check_connections() {
  docker exec "$(docker compose ps -q game)" node -e 'const fs=require("fs");let n=0,ok=0;for(const f of ["/proc/net/tcp","/proc/net/tcp6"]){let t="";try{t=fs.readFileSync(f,"utf8");ok=1}catch{continue}for(const l of t.trim().split("\n").slice(1)){const c=l.trim().split(/\s+/);if(c[1].endsWith(":0BB8")&&c[3]==="01")n++}}console.log(JSON.stringify({established3000:n,ok}));if(!ok)process.exit(9);if(n>0)process.exit(8)'
}
check_connections
mkdir "$STAGE"
tar -xzf "$PKG" -C "$STAGE"
# 공유 프록시가 쓰는 파일이 바뀌는 배포는 다른 사이트에도 영향을 주므로 자동으로 진행하지 않습니다.
for f in Caddyfile compose.yaml; do
  if ! cmp -s "$STAGE/$f" "$LIVE/$f"; then echo "$f가 운영과 달라 중단합니다. 프록시 설정 변경은 README의 수동 절차로 처리합니다." >&2; exit 3; fi
done
IMAGE=$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q game)")
docker tag "$IMAGE" "camp-jelly-game:rollback-$STAMP"
mkdir -p backups
tar --exclude=./backups -czf "$BACKUP" .
SWAPPED=0; RECREATED=0
rollback() {
  rc=$?
  trap - ERR
  set +e
  if [[ "$SWAPPED" == 1 ]]; then
    cd "$LIVE"
    rm -rf public tests
    tar -xzf "$BACKUP" -C "$LIVE"
    docker tag "camp-jelly-game:rollback-$STAMP" "$IMAGE"
    # 컨테이너를 아직 바꾸지 않았다면 실행 중인 게임(접속자 포함)은 그대로 둡니다.
    if [[ "$RECREATED" == 1 ]]; then docker compose up -d --no-deps --no-build --force-recreate game; fi
    echo ROLLED_BACK
  fi
  exit "$rc"
}
trap rollback ERR
SWAPPED=1
# 지운 파일이 남지 않도록 화면·시험 폴더는 통째로 바꿉니다. .env와 backups는 패키지에 없으므로 유지됩니다.
rm -rf public tests
cp -a "$STAGE/." "$LIVE/"
docker compose config --quiet
docker compose build game
# -T와 </dev/null: 이 원격 스크립트는 ssh 표준 입력으로 들어오므로, 컨테이너가 표준 입력을 읽어 남은 줄을 삼키지 않게 막습니다.
docker compose run -T --rm --no-deps -v "$LIVE/tests:/app/tests:ro" game npm test </dev/null
check_connections
RECREATED=1
docker compose up -d --no-deps --no-build --wait --wait-timeout 90 game
READY=0
for n in {1..20}; do
  if curl -fsS https://camp-jelly.43-200-53-244.nip.io/healthz >/dev/null; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == 1 ]]
trap - ERR
rm -rf "$STAGE"
docker compose ps
curl -fsS https://camp-jelly.43-200-53-244.nip.io/healthz
curl -fsS -o /dev/null -w '\nJELLY_HTTP=%{http_code}\n' https://camp-jelly.43-200-53-244.nip.io/
curl -fsS -o /dev/null -w 'PAINT_HTTP=%{http_code}\n' https://camp-paint.43-200-53-244.nip.io/
printf 'DEPLOYED=%s BACKUP=%s ROLLBACK_IMAGE=camp-jelly-game:rollback-%s\n' "$TAG" "$BACKUP" "$STAMP"
REMOTE_SCRIPT
