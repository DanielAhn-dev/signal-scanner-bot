# 실행 가이드 (`execution-guide`)

종목 코드와 투자금을 넣으면 종목별 진입 구간·손절·목표·수량·1회 주문 금액과 뉴스 요약을 만들어 주는 매매 계획 화면. 종목을 고르기 어려우면 스캔·집행우선 데이터에서 자동 후보를 찾아 채운다. 만든 가이드는 스냅샷으로 저장해 공유 링크·리포트 PDF로 내보낸다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 카드 4개를 배치한다 | 조회·계산을 직접 넣지 않는다. `error`는 생성·공유·자동 후보가 함께 쓰므로 여기에 둔다 |
| `hooks/` | `useGuideInputs`(입력·이어받기·시드), `useAutoCandidates`(자동 후보), `useGuideBuild`(생성·스냅샷·자동 생성), `useGuideShare`(공유·PDF) | **호출 순서 = 효과 실행 순서**: 이어받기·시드 → 자동 후보 → 이어받은 종목 자동 생성 |
| `lib/` | 순수 계산: `codes`, `risk`, `news`, `scoring`, `candidateRank`(후보 점수화), `diversify`(섹터 제한), `guideRow`(행 만들기), `snapshotText`, `request`(인증 요청 구성) | 테스트 `helpers.test.ts`, `logic.test.ts` |
| `components/` | `GuideInputCard`, `AutoFinderCard`, `GuideTable`, `GuideActions`(공유 모달 포함) | 필요한 값만 props로 받는다 |
| `types.ts` / `constants.ts` | `GuideRow`, `AutoCandidate` 등 / 세션 키 | |

## 다른 화면과의 계약 (바꾸지 않는다)

- 기본 내보내기 `ExecutionGuidePage`.
- 다른 화면이 종목을 넘기는 방식: `sessionStorage`의 `execution_guide_pending_v1`(`{ codes, source }`)과 URL `?codes=&source=`. `backtest`, `scan`, `highlights`, `discovery`, `analyze`가 쓴다.
- 이어받기 우선순위: URL `codes` → 세션 pending → (둘 다 없으면) 시뮬레이터 계획. URL은 종목·출처만 채우고 자동 생성하지 않는다. 세션/시뮬레이터 계획은 채운 뒤 **한 번** 자동으로 가이드를 만든다. 시뮬레이터 계획으로 채울 때만 투자금도 이어받으며, 사용자가 직접 고친 투자금(`capitalEditedRef`)은 덮지 않는다.

## 데이터

- `GET /api/ui/stock-latest?code=` — 종목별(병렬, 하나라도 실패하면 전체 실패)
- `GET /api/ui/news?q=` — 종목별 상위 3건(뉴스 포함일 때, 실패해도 무시)
- `GET /api/ui/scan-highlights`, `GET /api/ui/scan-candidates?limit=120` — 자동 후보
- `POST /api/ui/report-snapshot` — 스냅샷 저장(실패해도 화면은 계속, 공유·PDF 시점에 다시 시도)
- `GET /api/ui/report-pdf?topic=실행가이드` — PDF(직접 `fetch`, `lib/request.ts`가 UI 키·클라이언트/채팅 ID·인증 헤더를 붙임)
- `/api/ui/report-share` — `useShareManager`

## 주의

- 종목이 3개 미만이면 자동 후보로 채운다. 예산은 `min(투자금 ÷ 종목 수, 투자금 × 최대 비중)`이고 수량은 `⌊예산 ÷ 진입 기준가⌋`다.
- 위험 성향은 손절·목표에 계수를 곱한다(보수 0.9/0.85, 중립 1/1, 공격 1.15/1.18).
- 후보 점수화(`lib/candidateRank.ts`)의 가중치는 매직 넘버다. 바꾸면 자동 후보 순위가 바뀐다. 근거와 검증은 `docs/hypothesis-ledger.md`·`docs/investment-idea-registry-2026-10-07.md`를 먼저 본다(후보 선택 규칙은 11/23 전 확정 금지 대상).
- `scoreSignalFreshness(null, null)`은 100점을 준다(`Number(null) === 0`이라 신호 나이가 없으면 "오늘 신호"로 취급). 현재 동작이며 `helpers.test.ts`가 고정한다. 고치면 점수가 바뀌므로 규칙 변경으로 다룬다.
- `formatCompactKrw`는 10억 이상만 소수 1자리, 그 미만의 억 단위는 반올림한 정수다.
- `lib/request.ts`의 `buildUiRequest`는 인증 관련 코드다. 쿼리·헤더 구성을 테스트로 고정했으니 수정 전에 확인한다.
- 스모크 테스트(`index.test.tsx`)는 이어받기 우선순위, 수량 계산, 위험 성향 보정, 자동 채움, 일부 실패, 자동 후보, 공유를 고정한다. PDF 다운로드는 다루지 않는다.
