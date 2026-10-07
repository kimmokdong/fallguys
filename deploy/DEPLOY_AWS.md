# AWS 운영 배포 절차 (캠프 젤리)

운영 주소: https://camp-jelly.43-200-53-244.nip.io/
서버: AWS 서울 리전(`ap-northeast-2`) Lightsail `camp-jelly`(43.200.53.244)의 `/opt/camp-jelly`.
같은 서버에 캠프 페인트(`/opt/camp-paint`)와 도서 프로젝트가 함께 있습니다. 공유 프록시(`camp-jelly-proxy-1`)는 `/opt/camp-paint/deploy/Caddyfile.gateway`를 씁니다.

GitHub `main`에 올려도 운영 서버는 자동으로 바뀌지 않습니다. 아래 순서는 README "AWS 운영"의 수동 절차(2026-10-06 배포)를 스크립트로 묶은 것입니다.

## 1. 최신 코드 받기

```bash
git pull --ff-only origin main
```

루트에 있는 커밋 안 된 원본 mp3는 배포에 쓰지 않습니다. 배포 음원은 `public/music/`의 커밋된 파일입니다.

## 2. 커밋 기준 패키지 만들기

```bash
bash deploy/pack.sh
```

- 커밋된 HEAD만 LF 줄바꿈으로 풀어 `output/camp-jelly-<커밋>.tar.gz`로 묶습니다.
- 같은 소스로 `npm ci`·`npm test`를 돌린 뒤 sha256을 출력합니다.

## 3. CloudShell에서 배포

Claude in Chrome으로 AWS CloudShell을 엽니다: `https://ap-northeast-2.console.aws.amazon.com/cloudshell/home?region=ap-northeast-2`

1. 작업 → 파일 업로드로 `output/camp-jelly-<커밋>.tar.gz`와 `deploy/cloudshell-deploy.sh`를 **한 번에 하나씩** 올립니다.
2. CloudShell에서 `sha256sum`으로 두 파일의 해시가 로컬과 같은지 확인합니다.
3. 실행합니다.

```bash
bash cloudshell-deploy.sh <커밋> <패키지 sha256> 2>&1 | tee deploy-<커밋>.log; echo EXIT=${PIPESTATUS[0]}
```

스크립트가 하는 일:

1. 현재 포트 규칙을 저장하고, CloudShell IP에만 22번 포트를 엽니다. 기본 키는 CloudShell 임시 폴더에만 둡니다.
2. game 컨테이너의 3000번 포트 연결 수가 0인지 확인합니다. 접속자가 있으면 멈춥니다(EXIT=8).
3. 패키지의 `Caddyfile`·`compose.yaml`이 운영과 다르면 멈춥니다(EXIT=3). 공유 프록시에 닿는 변경은 README의 수동 절차로 처리합니다.
4. 현재 소스를 `backups/pre-<커밋>-<시각>.tar.gz`로, 현재 이미지를 `camp-jelly-game:rollback-<시각>`으로 백업합니다.
5. 소스를 교체합니다. `public`·`tests`는 통째로 바꾸고 `.env`·`backups`는 유지합니다.
6. 새 이미지를 빌드하고 서버 안에서 `npm test`를 돌립니다. 접속자 0명을 다시 확인한 뒤 game 컨테이너만 교체합니다(`--wait`로 healthy 대기).
7. 중간에 실패하면 소스와 이미지를 되돌립니다(`ROLLED_BACK`). 컨테이너를 아직 바꾸지 않았다면 실행 중인 게임은 그대로 둡니다.
8. 끝나면 포트 규칙을 원래대로 복원하고(`ACCESS_RESTORED`) 키를 지웁니다.

공유 프록시는 재시작하거나 reload하지 않습니다.

## 4. 배포 확인

- 로그 끝에 아래 항목이 모두 있어야 합니다.
  - `DEPLOYED=<커밋>`
  - `{"ok":true,...}`
  - `JELLY_HTTP=200`
  - `PAINT_HTTP=200`
  - `ACCESS_RESTORED`
  - `EXIT=0`
- 로컬에서 운영의 `public` 파일(`app.js`·`index.html` 등)을 내려받아 커밋과 바이트 단위로 비교합니다. 브라우저로 첫 화면과 3D 캐릭터도 확인합니다.
- README "AWS 운영"의 배포 기준 커밋과 검증 기록을 최신화해 커밋합니다.

## 주의

- 수업 중에는 배포하지 않습니다.
- SSH 키·인증서를 로컬이나 대화에 꺼내지 않습니다. AWS MCP는 상태 조회에만 씁니다.
- 이 스크립트는 2026-10-07에 만들었고 아직 실제 배포에 쓴 적이 없습니다. 첫 사용 때는 로그를 단계별로 확인합니다.
