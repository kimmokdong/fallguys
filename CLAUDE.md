# 캠프 젤리 작업 지침

## 운영 배포

"운영 서버에 배포해줘"는 [deploy/DEPLOY_AWS.md](deploy/DEPLOY_AWS.md) 절차대로 진행합니다. 서버 접속·키 처리 공통 규칙은 전역 지침의 "AWS 운영 서버 배포 규칙"을 따릅니다.

- 패키지는 `bash deploy/pack.sh`로 커밋된 HEAD에서만 만듭니다. 테스트가 이 안에서 함께 돌아갑니다.
- Claude in Chrome으로 AWS CloudShell(서울)을 엽니다. 패키지와 `deploy/cloudshell-deploy.sh`를 하나씩 업로드한 뒤 `bash cloudshell-deploy.sh <커밋> <sha256>`를 실행합니다.
- 같은 서버의 캠프 페인트·도서 사이트와 공유 프록시를 건드리지 않습니다. `Caddyfile`·`compose.yaml` 변경이 있으면 스크립트가 멈추므로 README의 수동 절차로 처리합니다.
- 배포 후에는 README "AWS 운영"의 배포 기준 커밋과 검증 기록을 최신화해 커밋합니다.
