#!/usr/bin/env bash
# 커밋된 HEAD만으로 운영 배포 패키지를 만듭니다. 커밋 안 된 로컬 파일(예: 루트의 원본 mp3)은 들어가지 않습니다.
# 사용법(Git Bash): bash deploy/pack.sh  →  output/camp-jelly-<커밋>.tar.gz 와 sha256 출력
# 절차 전체는 deploy/DEPLOY_AWS.md를 봅니다.
set -Eeuo pipefail
ROOT=$(git rev-parse --show-toplevel)
TAG=$(git -C "$ROOT" rev-parse --short=7 HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK" "$WORK.tgz"' EXIT
mkdir -p "$ROOT/output"
OUT="$ROOT/output/camp-jelly-$TAG.tar.gz"
# 리눅스 서버에서 쓰므로 Windows에서도 줄바꿈을 LF로 고정합니다.
git -C "$ROOT" -c core.autocrlf=false -c core.eol=lf archive --format=tar HEAD | tar -x -C "$WORK"
cd "$WORK"
if grep -rlI $'\r' server.js http-assets.js public compose.yaml Caddyfile Dockerfile package.json >/dev/null; then echo 'CRLF 줄바꿈이 섞여 있어 중단합니다.' >&2; exit 1; fi
# 시험 전에 묶어서 node_modules가 패키지에 들어가지 않게 합니다.
tar --force-local -czf "$WORK.tgz" .
npm ci --no-audit --no-fund
npm test
mv "$WORK.tgz" "$OUT"
cd "$ROOT/output"
echo "PACKAGE=output/camp-jelly-$TAG.tar.gz"
sha256sum "camp-jelly-$TAG.tar.gz"
