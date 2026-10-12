# operations 화면 분해 설계 (2026-10-12)

`web/src/features/operations/index.tsx` 1598줄(테스트 없음). 관리자용 "운영 패널"이다. 동작은 바꾸지 않고 `sectors`·`analyze`와 같은 순서(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅 → 정리)로 나눈다. 이 문서는 설계만이며 코드는 아직 바꾸지 않았다.

## 현재 구조 (측정)

| 줄 | 내용 |
|---|---|
| 1–9 | import |
| 10–203 | 타입 16개(`TradeRow`, `SellCandidate`, `JobPayload`/`JobDetail`/`JobSnapshot`, `AutoTradeRun`, `TimelineEvent`, `DryRunDetails`, `OperationsKpi`, `AutoCycleInsights*` 등) |
| 204–416 | 순수 도우미 약 25개: 매매 메모 해석(`interpretMemo`), 배지·색, 작업 상태(`normalizeJobState`, `resolveTaskLabel`, `renderRunSummary`, `progressFill`), 타임라인, 드라이런 메모 분류(`classifyDryRunNote`), 실패 원인(`resolveFailureCause`), 메시지 번역(`translateOperationMessage`), 인사이트 실행 상태·판정 톤·필터 정규화, 사유 분류(`reasonCategoryFromText`, `estimateMissingReason`) |
| 417–450 | `OperationsPage` 상태 30여 개 |
| 452–492 | 조회 3종(`activity`, `dashboard`, `autocycle_insights`)과 마운트 effect 3개 |
| 494–545 | 작업 감시: `addWatchingJob`, `refreshJobSnapshot`(완료 시 재조회·드라이런 승인 대기 등록), 2초 폴링 effect |
| 546–660 | 자동매도 점검, `runAutocycle`(드라이런/실행/학습), `runAutotrigger`(순차 트리거), `retryJob`, 파생 2개 |
| 661–1598 | JSX 약 940줄: 헤더 → 지금 매매 체크 카드 → 드라이런 승인 배너 → KPI 카드 → 실시간 작업 카드(약 130줄) → 승인 대기 카드 → 최근 실행 이력(약 70줄) → 고급 진단 토글 → **(접힘) 학습 실행 카드, 자동매도 점검 카드, 자동매매 실행 인사이트 카드(약 430줄)** → 드라이런 상세 모달(약 65줄) |

핵심 관찰: ① 순수 도우미가 많고(약 215줄) 한국어 문구·분류 규칙이라 단위 테스트 가치가 크다. ② 인사이트 카드 하나가 430줄로 JSX의 절반이다. ③ **운영 DB에 쓰기 요청을 보내는 동작이 있다**(`runAutocycle(dryRun=false)`, 학습 실행, 순차 트리거). 분해 중 테스트에서 실제 호출이 나가지 않게 반드시 mock하고, 호출 본문(`mode`, `dry_run`, `trigger_mode`)을 고정한다.

## 바깥에서 이 화면에 의존하는 계약 (바꾸지 않는다)

- 기본 내보내기 `OperationsPage`(props 없음). `features/control/index.tsx`가 `lazy(() => import('../operations'))`로 "운영" 탭에 올린다. `/operations` 경로는 `/control?tab=operations`로 리다이렉트된다. 관리자 접근 제어는 `handlers/ui/_accessControl.ts`(서버)와 control 쪽이 맡으므로 이 화면에서 바꾸지 않는다.
- 서버 API(모두 `/api/ui/operations`): `GET ?view=activity | dashboard | autocycle_insights | autosellcheck | job&job_id=`, `POST`(본문 `{ mode: 'autocycle', dry_run, trigger_mode }` / `{ mode: 'autotrigger', step, dry_run: true }`).
- 작업은 `job_id`로 2초마다 폴링한다(감시 목록이 비면 중단).

## 목표 구조

```
operations/
  index.tsx                  훅 호출 + 섹션 배치 (목표 250줄 이하)
  types.ts                   위 타입 16개
  constants.ts               (필요 시) 폴링 주기 2000ms, 필터 값 목록
  lib/
    memo.ts                  interpretMemo, classifyDryRunNote, translateOperationMessage, resolveFailureCause
    jobs.ts                  normalizeJobState, resolveTaskLabel, renderRunSummary, progressFill, normalizeStep, getTimelineMeta
    insights.ts              runStatusLabel/Tone, decisionTone, normalizeDecisionFilter, reasonCategoryFromText, estimateMissingReason
    badges.ts                cardBgStyle, sideBadge (JSX 반환 시 components로)
  hooks/
    useOperationsData.ts     activity/dashboard/insights 조회와 마운트 effect 3개
    useJobWatcher.ts         liveJobs, watchingJobIds, refreshJobSnapshot, 2초 폴링, 승인 대기 상태
    useAutoRuns.ts           runAutocycle, runAutotrigger, retryJob, 자동매도 점검
  components/
    TradeNowCard.tsx         지금 매매 체크
    DryRunBanner.tsx, DryRunApprovalCard.tsx
    KpiCard.tsx
    LiveJobsCard.tsx         실시간 작업(+ 타임라인)
    ActivityList.tsx         최근 실행 이력
    LearningRunCard.tsx, SellCheckCard.tsx
    InsightsCard.tsx(+ InsightRunDetail 등으로 더 쪼갬)
    DryRunModal.tsx
  README.md
```

## 단계

0. **스모크 테스트**로 현재 동작 고정. 가짜 `apiFetch`(`view=` 별 응답, POST), 토스트, `Modal` 필요 시 통과 mock, 폴링은 `vi.useFakeTimers`. 고정할 것:
   - 마운트 시 `activity`·`dashboard`·`autocycle_insights` 3종 조회, 이력의 메모 해석 라벨 표시.
   - "점검(dry-run)" 요청: POST 본문 `{ mode:'autocycle', dry_run:true, trigger_mode:'auto' }` → `job_id` 등록 → 즉시 1회 `view=job` 조회 → 2초 폴링.
   - 작업이 완료되면 감시 목록에서 빠지고 이력·KPI·인사이트가 다시 조회되며(타이머 500/600/700ms), 드라이런이면 승인 대기 배너가 뜬다.
   - 실제 실행(`dry_run:false`)은 승인 대기를 지운다. 학습 실행은 `trigger_mode:'learning'`.
   - 순차 트리거는 `step`(intraday/ready)과 `dry_run:true`를 보낸다.
   - 실패한 작업의 재시도: 작업 종류별 분기(autocycle, intraday, 미지원 시 토스트).
   - `job_id` 누락·서버 오류·`execution_error` 문구.
   - 고급 진단 토글, 자동매도 점검 조회.
1. `types.ts`와 순수 도우미를 `lib/`로 이동 + 단위 테스트(문구·분류 규칙).
2. (선택) 인사이트 계산이 JSX 안에 인라인으로 섞여 있으면 `lib/insights.ts`로 추출하고 테스트.
3. 섹션 JSX를 `components/`로(인사이트 카드가 가장 크다).
4. 훅 3개로.
5. 정리와 README.

## 주의 (동작 유지)

- **쓰기 요청**: `POST /api/ui/operations`(실제 매매 사이클 실행 요청)는 테스트에서 절대 실제로 나가지 않게 한다. 분해 후에도 버튼의 `disabled` 조건(진행 중 중복 클릭 방지)과 확인 흐름을 그대로 둔다.
- **폴링과 정리**: 감시 목록이 비면 `setInterval`을 해제하고, 의존 배열(`refreshJobSnapshot`, `watchingJobIds`)을 유지한다. 완료 후 재조회는 `setTimeout` 500/600/700ms다. 타이머 값을 바꾸지 않는다.
- **승인 대기 등록 조건**: `task === 'virtualAutoTrade'` 이고 `dry_run !== false`일 때만, 같은 `jobId`는 중복 등록하지 않는다.
- **`retryJob`**은 `runAutocycle`/`runAutotrigger`를 직접 호출한다. 훅 분리 시 순환 의존이 생기지 않도록 `useAutoRuns`에 함께 둔다.
- 번역·분류 문구(`translateOperationMessage` 등)는 서버 메시지 형식에 의존한다. 옮길 때 정규식과 문구를 한 글자도 바꾸지 않고 테스트로 고정한다.
- 이 화면은 관리자용(Excel 셸 방침)이다. UI 정리는 하지 않고 구조만 나눈다. CSS는 옮기지 않는다.

## 위험과 판단

- 0단계가 가장 오래 걸린다: 폴링·타이머·POST 흐름 때문에 fake timer와 `act` 조합이 필요하다.
- 1단계는 도우미 25개의 문구 테스트가 대부분이라 분량은 많지만 쉽다.
- 3단계는 `InsightsCard`(430줄)를 한 파일로 옮기고 이후 필요하면 안쪽(실행 카드, 비교표, 사유 퍼널)을 더 쪼갠다.
- 4단계에서 `refreshJobSnapshot`이 `loadActivity` 등 세 조회 함수를 의존하므로, `useOperationsData`가 이 함수들을 반환하고 `useJobWatcher`가 인자로 받는 순서(데이터 훅 → 감시 훅 → 실행 훅)를 지킨다.
- 관리자 전용이라 사용자 영향은 작지만 실제 매매 요청을 보내는 화면이므로, 분해 후 푸시 전에 **로컬에서 dry-run 버튼으로 한 번 확인**하는 것을 권한다(이 확인은 제가 대신하지 않는다).
