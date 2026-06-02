# Secret Rotation Runbook

이 문서는 signal-scanner-bot 운영 시 노출 가능성이 있는 키/시크릿을 정기적으로 교체하기 위한 체크리스트입니다.

## 1. 교체 우선순위

### P0 (즉시 교체)
- TELEGRAM_BOT_TOKEN
- SUPABASE_SERVICE_ROLE_KEY
- KOREA_APP_KEY
- KOREA_APP_SECRET
- CRON_SECRET
- INGEST_SECRET
- UI_READ_KEY
- VITE_UI_READ_KEY
- KRX_PW

### P1 (권장 교체)
- TELEGRAM_BOT_SECRET
- KRX_ID
- KOREA_ID

## 2. 보안 원칙

- 서버 전용 비밀값은 프론트 환경변수(VITE_*)로 노출하지 않는다.
- 특히 `VITE_SUPABASE_SERVICE_ROLE_KEY`는 사용 금지(즉시 제거).
- VITE_*에는 공개되어도 되는 값만 둔다.
- 시크릿은 로컬만 바꾸면 끝나지 않는다. Vercel, GitHub Actions, 로컬 .env를 함께 맞춘다.

## 3. 교체 대상 저장소/플랫폼

- 로컬: .env
- 배포: Vercel Project Environment Variables (Production/Preview/Development)
- CI: GitHub Actions Secrets
- 외부 제공자:
  - Telegram BotFather
  - Supabase Dashboard
  - 한국투자증권(KIS) 개발자 포털
  - KRX 계정

## 4. 교체 절차 (매번 동일)

1. 사전 준비
- 작업 시작 전 현재 서비스 상태를 점검한다.
- 배치/크론 실행 시간대를 피해서 교체한다.

2. 키 재발급/폐기
- 각 제공자 콘솔에서 기존 키를 revoke(폐기)하고 새 키를 발급한다.

3. 환경변수 반영
- 로컬 .env 업데이트
- Vercel 환경변수 업데이트
- GitHub Actions Secrets 업데이트

4. 프론트/서버 분리 점검
- VITE_*에 민감값이 없는지 확인한다.
- 서비스 롤 키는 서버 핸들러에서만 사용되는지 확인한다.

5. 배포 및 검증
- 배포 후 아래 항목을 즉시 검증한다.
  - /api/ui/settings 조회/저장
  - /api/ui/operations 실행
  - 텔레그램 테스트 알림
  - 크론 엔드포인트 인증(401/200)
  - daily batch 1회 수동 실행

6. 사후 점검
- 실패 로그, 인증 오류, 비정상 트래픽 여부를 확인한다.
- 필요한 경우 재발급된 키로 한 번 더 정합성 점검한다.

## 5. 빠른 점검 체크리스트

- [ ] TELEGRAM_BOT_TOKEN 교체
- [ ] SUPABASE_SERVICE_ROLE_KEY 교체
- [ ] KOREA_APP_KEY/KOREA_APP_SECRET 교체
- [ ] CRON_SECRET/INGEST_SECRET 교체
- [ ] UI_READ_KEY/VITE_UI_READ_KEY 교체
- [ ] .env 반영
- [ ] Vercel 반영
- [ ] GitHub Actions 반영
- [ ] VITE_SUPABASE_SERVICE_ROLE_KEY 제거
- [ ] 배포 후 API/알림/크론/배치 검증 완료

## 6. 권장 주기

- 정기 교체: 월 1회
- 즉시 교체:
  - 키가 채팅/문서/스크린샷/로그에 노출된 경우
  - 권한 오남용 의심 로그가 발견된 경우
  - 담당자 변경/외주 종료 시점

## 7. 비고

- 이 문서는 운영 절차 문서이며 실제 비밀값은 절대 기록하지 않는다.
- 교체 이력은 날짜/담당자/완료 여부만 기록한다.
