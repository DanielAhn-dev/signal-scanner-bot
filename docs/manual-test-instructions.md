명령(명령어) 수동 테스트 가이드
=================================

목적
- 로컬에서 변경된 소비자 핸들러(`score`, `buy`, `finance`, `scan` 등)를 빠르게 검증하기 위한 절차 정리.

사전 준비
- `.env`에 필요한 환경변수 설정(예: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- 로컬에서 `pnpm install` 실행.

기본 실행
1) 타입체크 및 빌드
```bash
pnpm build
```

2) 특정 명령 시뮬레이션(예: `finance`) — 간단한 Node 스크립트로 핸들러를 호출하거나 실제 봇 환경의 API를 흉내냄.
예: `pnpm exec tsx`로 간단한 런너를 작성해 특정 핸들러를 호출합니다.

예시 스니펫 (테스트 러너)
```js
// scripts/test_command.ts
import { handleFinanceCommand } from "../src/bot/commands/finance";
const fakeCtx = { chatId: 12345, from: { id: 67890 } };
const fakeTg = (method, payload) => console.log("tgSend ->", method, payload);

handleFinanceCommand("삼성전자", fakeCtx, fakeTg).catch(console.error);
```

3) 로그 확인
- 출력 메시지(콘솔 또는 tgSend로 찍힌 텍스트)를 확인해 `재무 요약` 블록이 정상 표시되는지 검증.

검증 포인트
- `fundamentals` 테이블의 최신 스냅샷이 사용되는지(라이브 스크레이프 대신) 확인
- 누락 필드가 있어도 핸들러가 예외 없이 동작하는지 확인
- 메시지의 숫자 포맷/단위가 적절한지 확인

문제 발생 시
- 에러/스택트레이스가 나오면 해당 핸들러의 DB 매핑(필드명/타입)을 점검
- 필요한 경우 `fundamentalStore.getLatestFundamentalSnapshot` 대신 임시로 `getFundamentalSnapshot`을 직접 호출해 비교
