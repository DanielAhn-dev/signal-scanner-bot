# 포트폴리오 화면 (`/portfolio`)

보유 종목을 계좌별로 보여주고, 종목별 대응·봇 판정, 추가매수/매도 기록, 보유 수정, 공유 링크를 다룬다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 컴포넌트에 연결만 한다 | 로직·JSX 상세를 넣지 않는다 |
| `hooks/` | 상태·서버 호출·핸들러 (관심사별 1개) | `usePortfolioView`만 파생 계산, 나머지는 데이터·상태 |
| `lib/` | 순수 계산 (React·fetch 모름) | 테스트는 `*.test.ts`. 판정 규칙은 `holdingState.ts` |
| `components/` | 표시 컴포넌트 | props만 받는다. 모달은 `components/modals/`, 훅의 상태 묶음 하나를 받는다 |
| `types.ts` | `HoldingRow` 등 화면 타입 | 서버 positions 응답에서 화면이 읽는 필드만 적는다 |

## 데이터

- `GET /api/ui/positions` — 처음 20건을 받은 뒤 나머지를 백그라운드로 이어받는다. 상단 합계가 대시보드(`portfolio-realtime`)와 같은 전체 기준이어야 하기 때문이다.
- `/api/ui/investment-prefs`(시드·현금), `/api/ui/market-overview`(거시), `/api/ui/account-policies`, `/api/ui/advisor-performance`
- 쓰기: `/api/ui/virtual-trade`(매수·매도), `/api/ui/positions-maintenance`(수정·삭제·전체매도), `/api/ui/portfolio-share`
- 계좌별 예수금은 포트폴리오 계좌 카드에서 잔액 보정(실제 잔액으로 맞춤)과 입금 기록(입력액을 추가)을 구분한다. 수동 내역은 `income-guide` 저장 파일에 계좌별로 남고, 매매·분배금 기록은 기존처럼 자동 반영된다.

## 주의

- 보유 상태(`hold`/`add`/`partial`) 판정은 `lib/holdingState.ts`가 정본이다. 기준값은 사용자 설정(`holdingRules`) → 거시 보정 → 계좌정책 가감 순으로 겹친다.
- 손익은 "비용 포함" 설정에 따라 수수료·거래세를 뺀다. 종목별 비용은 `lib/summary.ts`의 `rowTradeCost` 하나만 쓴다(카드와 합계가 같은 식).
- 실계좌 행은 `broker_name`/`account_name`이 있고, 봇 가상 계좌는 비어 있다. 지난 날짜 기록은 실계좌 매수만 허용한다.
- 공유 모달은 열릴 때 활성 링크가 없으면 새로 만든다. 서버가 만든 링크를 이력에 돌려주지 않으면 반복 생성될 수 있다(`hooks/useShare.ts`).
- `portfolio-*` CSS는 아직 `web/src/styles/index.css`에 있다(일부 클래스는 `dbView`와 공유). 옮기려면 import 순서에 따른 cascade 변화를 화면으로 확인해야 한다.
