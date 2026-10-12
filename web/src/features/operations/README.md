# 운영 패널 (`operations`)

관리자용 화면. 지금 매매를 확인(순차 트리거)하고, 자동사이클 실행 상태·최근 체결·실행 인사이트를 따라간다. `features/control`의 "운영" 탭이 `lazy(() => import('../operations'))`로 불러오며, `/operations` 경로는 `/control?tab=operations`로 리다이렉트된다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 카드 컴포넌트를 배치한다 | 조회·요청을 직접 넣지 않는다 |
| `hooks/` | `useOperationsData`(이력·KPI·인사이트 조회, 자동매도 점검), `useJobWatcher`(작업 감시·2초 폴링·승인 대기), `useAutoRuns`(자동사이클·순차 트리거 요청, 재시도) | **호출 순서 = 효과 실행 순서**: 조회 3종(마운트) → 작업 감시. `retryJob`이 두 실행 함수를 직접 부르므로 `useAutoRuns`에 함께 둔다 |
| `lib/` | 순수 도우미: `memo`(매매 메모 해석·드라이런 노트 분류·서버 메시지 번역·실패 원인), `jobs`(작업 상태·이름·요약·타임라인), `insights`(실행 상태·판정 톤·사유 분류·비교 행 필터) | 테스트 `lib/helpers.test.tsx` |
| `components/` | `TradeNowCard`, `DryRunBanner`, `KpiCards`, `LiveJobsCard`, `DryRunApprovalCard`, `ActivityList`, `LearningRunCard`, `SellCheckCard`, `InsightsCard`(약 470줄), `DryRunModal`, `badges` | 필요한 값만 props로 받는다 |
| `types.ts` / `constants.ts` | 응답·작업·인사이트 타입 / 이벤트·전략 한글 라벨 맵 | |

## 서버 호출 (모두 `/api/ui/operations`)

- `GET ?view=activity | dashboard | autocycle_insights | autosellcheck | job&job_id=`
- `POST` 본문: 자동사이클 `{ mode: 'autocycle', dry_run, trigger_mode: 'auto' | 'learning' }`, 순차 트리거 `{ mode: 'autotrigger', step: 'intraday' | 'ready', dry_run: true }`

**`dry_run: false`인 POST와 학습 실행은 가상 매매 사이클을 실제로 돌린다.** 분해/수정 후에는 푸시 전에 로컬에서 드라이런 버튼으로 흐름을 한 번 확인한다.

## 주의

- **폴링**: 감시 목록이 비면 `setInterval`을 해제한다. 의존 배열(`refreshJobSnapshot`, `watchingJobIds`)을 유지한다.
- **완료 후 재조회**: 작업이 끝나면 이력·KPI·인사이트를 `setTimeout` 500/600/700ms 뒤에 다시 조회한다. 값을 바꾸지 않는다.
- **승인 대기 등록 조건**: `task === 'virtualAutoTrade'`이고 `dry_run !== false`이며 상태가 완료일 때만, 같은 job은 한 번만. 실제 실행(`dry_run:false`)을 요청하면 승인 대기를 지운다. 학습이 아닌 드라이런 요청은 배너 닫힘 상태를 초기화한다.
- 서버 메시지 번역(`translateOperationMessage`)은 FIFO 수량 부족·시간 초과·미지원 작업 메시지 형식에 의존한다. 정규식을 바꾸면 `helpers.test.tsx`가 알려준다.
- 분해 중 화면에 표시되지 않던 `autocycleResult` 상태를 제거했다(자동사이클 요청 결과 문구는 토스트로만 보이고, 순차 트리거 결과는 화면에 표시된다).
- 스모크 테스트(`index.test.tsx`)가 실행 요청 본문, 폴링, 완료 후 재조회, 승인 대기·수락·보류, 실패 재시도, 오류 문구, 상세 모달을 고정한다. 모든 서버 호출은 mock이다.
