# execution-guide 화면 분해 설계 (2026-10-12)

`web/src/features/execution-guide/index.tsx` 1651줄(테스트 없음). 동작은 바꾸지 않고 `backtest`·`simulator`와 같은 순서(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅 → 정리)로 나눈다. 이 문서는 설계만이며 코드는 아직 바꾸지 않았다.

## 현재 구조 (측정)

| 줄 | 내용 |
|---|---|
| 1–66 | import, 타입(`RiskMode`, `CandidateMode`, `ScoreVersion`, `GuideRow`, `AutoCandidate`), 세션 키 |
| 67–206 | `getCandidateScoreByVersion`, `toExecutionGuideSnapshotText`(스냅샷 본문 텍스트 생성, 약 135줄) |
| 207–335 | 입력·표기 도우미: `parseCodes`, `normalizeSourceLabel`, `autoSourceLabelByMode`, `applyRiskMode`, `parseHoldDays`, 뉴스 제목·URL·출처·날짜 정규화, `formatDateRangeLabel`, `formatRowDataAsOf` |
| 335–483 | 점수 도우미: `clampValue`, `normalizeScoreFrom5`, `gradeToPct`, 순매수(`computeNetFlow`, `computeNetFlowScore`, `computeFlowAccelerationScore`), 신선도, 과열, 테마 가산 |
| 484–773 | 후보 점수화: `rankScanCandidate`(약 160줄), `rankHighlightCandidate`(약 125줄) — 모드(균형/멀티배거/스윙)별 가중치 |
| 774–823 | `formatFlowBadgeLabel`, `normalizeSectorKey`, `pickDiversifiedCandidates`(섹터당 2개 제한) |
| 824–1000 | `ExecutionGuidePage` 상태 30여 개, 스냅샷 저장·공유·PDF 다운로드 |
| 1004–1045 | 마운트 시 URL 파라미터·sessionStorage·시뮬레이터 계획에서 종목/투자금 이어받기, 시드 반영 |
| 1051–1210 | `buildGuide`(약 160줄): 종목별 `stock-latest` + 뉴스 조회 → `GuideRow` 생성 → 스냅샷 저장 |
| 1213–1285 | `fetchAutoCandidates`, `loadAutoCandidates`, `useAutoCandidatesAsCodes`, 이어받은 종목으로 자동 생성하는 effect |
| 1287–1651 | JSX: 헤더(엑셀 표) → 입력 카드 → 자동 후보 찾기 카드(`Detail`) → 오류 → 결과 표 → 액션 카드 → `ShareModal` |

핵심 관찰: **파일의 절반(약 820줄)이 컴포넌트 밖의 순수 함수**다. 컴포넌트를 쪼개기 전에 이 부분을 `lib/`로 옮기고 테스트하는 것이 가장 이득이 크고 위험이 낮다. 화면 본문(824~1651)은 `backtest`보다 작다.

## 바깥에서 이 화면에 의존하는 계약 (바꾸지 않는다)

- 기본 내보내기 `ExecutionGuidePage`(`App.tsx`, `ExcelShell.tsx`가 사용).
- 다른 화면이 넘기는 방식: `sessionStorage`의 `execution_guide_pending_v1`(`{ codes, source }`)과 URL `?codes=&source=`. `backtest/lib/navigation.ts`, `scan`, `highlights`, `discovery`, `analyze`가 이 키를 쓴다. 키 상수는 `constants.ts`로 옮기되 값은 그대로 둔다.
- 서버 API: `stock-latest`, `news`, `scan-highlights`, `scan-candidates`, `report-snapshot`(POST), `report-pdf`(GET, 직접 `fetch`), `report-share`(`useShareManager`).

## 목표 구조

```
execution-guide/
  index.tsx                  훅 호출 + 섹션 배치 (목표 250줄 이하)
  types.ts                   RiskMode, CandidateMode, ScoreVersion, GuideRow, AutoCandidate
  constants.ts               EXECUTION_GUIDE_PENDING_KEY
  lib/
    codes.ts                 parseCodes, normalizeSourceLabel, autoSourceLabelByMode
    risk.ts                  applyRiskMode, parseHoldDays
    news.ts                  decodeHeadlineText, normalizeNewsUrl/Source, normalizeDateLabel, formatDateRangeLabel, formatRowDataAsOf
    scoring.ts               clampValue, normalizeScoreFrom5, gradeToPct, 신선도·과열·테마·순매수 점수
    candidateRank.ts         rankScanCandidate, rankHighlightCandidate, getCandidateScoreByVersion
    diversify.ts             normalizeSectorKey, pickDiversifiedCandidates, formatFlowBadgeLabel
    snapshotText.ts          toExecutionGuideSnapshotText
    guideRow.ts              buildGuideRow(응답들, 옵션) — buildGuide 안의 행 만들기(순수 부분)
    request.ts               appendQueryParam, buildUiRequest(PDF용 URL·헤더)
  hooks/
    useGuideInputs.ts        코드·투자금·비중·분할·위험 성향, 마운트 시 이어받기, 시드 반영
    useAutoCandidates.ts     fetch/load, 모드·점수 버전, 보이는 후보
    useGuideBuild.ts         buildGuide, rows/loading/error, 스냅샷 저장, 이어받은 종목 자동 생성 effect
    useGuideShare.ts         공유·PDF 다운로드
  components/
    GuideInputCard.tsx, AutoFinderCard.tsx, GuideTable.tsx, GuideActions.tsx
  README.md
```

## 단계

0. **스모크 테스트**로 현재 동작 고정(이 화면은 테스트가 없다). 가짜 API·토스트·`useShareManager`·`useSeedCapital`·`viewModeStore`를 쓴다. 고정할 것:
   - 마운트 시 URL `?codes=`/세션 `execution_guide_pending_v1`/시뮬레이터 계획에서 종목을 이어받고, 이어받은 경우 자동으로 가이드를 만든다.
   - 투자금 직접 입력 뒤에는 시드·계획 값으로 덮어쓰지 않는다.
   - 가이드 생성 시 종목별 `stock-latest` 호출, 뉴스 포함 여부에 따른 `news` 호출, 행의 수량 = ⌊배정금 ÷ 진입가⌋, 위험 성향별 손절·목표 보정.
   - 종목이 3개 미만이면 자동 후보로 채운다.
   - 스냅샷 저장(`report-snapshot` POST) 후 공유·PDF 버튼 동작, 실패 시 오류 문구.
   - 자동 후보 찾기: 모드별 정렬, 섹터당 2개 제한.
1. `types.ts`·`constants.ts`와 도우미 함수를 `lib/codes·risk·news·scoring`으로 이동(+테스트).
2. 후보 점수화·다양화·스냅샷 텍스트·행 만들기를 `lib/`로 이동하고 단위 테스트(분리 전 코드로 기대값 확인). 가장 큰 단계지만 순수 함수라 안전하다.
3. 섹션 JSX를 `components/`로.
4. 훅 4개로.
5. 정리와 README.

## 주의 (동작 유지)

- **마운트 effect의 우선순위**: URL `codes` → 세션 pending → (둘 다 없으면) 시뮬레이터 계획 순이다. 시뮬레이터 계획으로 채울 때만 투자금도 이어받고, 사용자가 이미 투자금을 고쳤으면(`capitalEditedRef`) 덮지 않는다. 이 ref를 훅으로 옮길 때 같은 훅 안에 둔다.
- **자동 생성 effect**: `hydratedByPending && !loading && rows.length === 0 && codeList.length > 0`일 때만 한 번 `buildGuide`를 부르고 플래그를 내린다. 의존 배열을 바꾸면 중복 생성되거나 안 만들어진다.
- `buildGuide`는 종목 수만큼 `stock-latest`를 병렬 호출하고, 하나라도 실패하면 전체를 실패로 처리한다(`Promise.all`). 이 의미를 바꾸지 않는다.
- 스냅샷 저장 실패는 화면 사용을 막지 않는다(공유·PDF 시점에 다시 시도). `snapshotReady` 상태 전이를 그대로 유지한다.
- `rankScanCandidate`/`rankHighlightCandidate`의 가중치·임계값(과열, 순매수 가속, 테마 가산 등)은 매직 넘버다. 옮길 때 숫자를 바꾸지 않고, 단위 테스트로 대표 입력의 점수를 고정한다. 이 점수의 근거가 11/23 전 규칙 보류 대상인지(후보 선택 규칙에 해당)는 분해와 별개로 판단한다 — 분해는 값을 바꾸지 않는다.
- `buildUiRequest`는 `VITE_API_BASE`, `VITE_UI_READ_KEY`, 클라이언트 ID를 쿼리·헤더에 붙이는 인증 관련 코드다. 한 글자도 바꾸지 않고 옮기며, 테스트로 URL·헤더 구성만 고정한다.
- CSS 클래스(`execution-guide-*`, `xls-*`)는 공유되므로 옮기지 않는다.

## 위험과 판단

- 가장 큰 위험은 0단계 테스트 작성이다. 화면이 `Detail`(간단히/자세히 보기) 안에 많은 요소를 숨겨, 테스트에서 자세히 보기로 고정해야 한다(`simulator`처럼 `Detail`을 통과 컴포넌트로 mock).
- 2단계의 점수화 함수는 입력 형태가 느슨하다(`any`). 단위 테스트에서 필드 이름 별칭(여러 후보 키)을 대표 케이스로 고정해야 하며, 모든 별칭 조합을 다 테스트하지는 않는다.
- `lib/` 이동이 전체의 절반이라 1~2단계에서 `index.tsx`가 약 830줄이 된다. 이후 3~4단계로 250줄 이하를 목표로 한다.
