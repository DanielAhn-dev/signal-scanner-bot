# sectors 화면 분해 설계 (2026-10-12)

`web/src/features/sectors/index.tsx` 1292줄(테스트 없음), 정적 데이터 `sectorMeta.ts` 236줄은 이미 분리돼 있다. 동작은 바꾸지 않고 `analyze`·`execution-guide`와 같은 순서(특성화 테스트 → 순수 로직 → 컴포넌트 → 훅 → 정리)로 나눈다. 이 문서는 설계만이며 코드는 아직 바꾸지 않았다.

## 현재 구조 (측정)

| 줄 | 내용 |
|---|---|
| 1–48 | import, localStorage 캐시 도우미 `readLS`/`writeLS`(TTL 60초) |
| 49–104 | 타입(`Sector`, `SectorLeader`, `Tab`, `MacroPhase`, `SectorMarketOverviewSnapshot`, `PhaseDetectionResult`), 상수 |
| 105–296 | 순수 도우미: `clampNum`, `confidenceLabel`, `mapMacroPhaseToRotation`, **`detectCurrentPhase`(약 80줄, 경기 국면 추정)**, `toNum`, `formatKoreanMoney`, `buildMetricsSummary`, `buildSectorReason`, 날짜 표기 2개 |
| 297–696 | 작은 컴포넌트: `ScoreBadge`, `ChangeRate`, `NatureBadge`, `PhaseIcon`, `SectorCard`(약 95줄), `SectorSummaryTable`(약 85줄), `SheetSectionHeader`, `AllSectorsView`(약 130줄) |
| 697–950 | `SectorGuideView`(약 255줄, 대부분 정적 설명 JSX — 경기 국면별 섹터 로테이션 가이드) |
| 951–1086 | `SectorsPage` 상태 11개, `detected`/`latestUpdatedAt` 파생, `loadData`(섹터+시장 개요 병렬 조회), `loadSectorLeaders`(대장주 지연 조회), `navigateToAnalyze`, `onSectorCardClick` |
| 1087–1292 | 탭별 정렬/필터(`sorted`, `promising`, `next`, `displayed`)와 JSX: 헤더 → 요약 표 → 갱신 문구 → 탭 → 오류 → 탭 설명 → 유망/다음 섹터 표(약 110줄 인라인) → 전체 섹터 → 가이드 |

핵심 관찰: 이 화면은 **이미 컴포넌트 7개가 한 파일에 같이 들어 있는 구조**라 `analyze`·`execution-guide`보다 "파일 쪼개기"에 가깝다. 이동 위주라 위험이 낮고, 순수 로직 중 `detectCurrentPhase`(경기 국면 추정 점수식)와 `buildSectorReason`/`buildMetricsSummary`를 테스트로 고정하는 것이 가장 가치가 크다.

## 바깥에서 이 화면에 의존하는 계약 (바꾸지 않는다)

- 기본 내보내기 `SectorsPage({ onNavigate? })`: `App.tsx`가 lazy로 불러온다.
- 대장주 클릭 → `sessionStorage`의 `analyze_pending_code`를 쓰고 `analyze` 화면으로 이동(`onNavigate` 우선, 없으면 `history.pushState`).
- 서버 API: `GET /api/ui/sectors`, `GET /api/ui/market-overview`(실패해도 섹터 표시는 계속), `GET /api/ui/sector-leaders?sectorIds=&limitPerSector=3`.
- localStorage 키 `ls_sectors_page`(섹터 목록 60초 캐시): 키·구조를 바꾸면 첫 로딩 동작이 달라진다.
- `sectorMeta.ts`의 `getSectorMeta`, `ROTATION_CYCLE`, `NATURE_LABELS` 등 공개 상수(이 파일은 그대로 둔다).

## 목표 구조

```
sectors/
  index.tsx                  훅 호출 + 탭 배치 (목표 250줄 이하)
  sectorMeta.ts              (유지)
  types.ts                   Sector, SectorLeader, Tab, MacroPhase, SectorMarketOverviewSnapshot, PhaseDetectionResult
  constants.ts               SECTORS_TTL, LS_KEY, ANALYZE_PENDING_CODE_KEY, PHASE_CONFIDENCE_THRESHOLD, TAB_ITEMS, 기본 리더 기준 문구
  lib/
    cache.ts                 readLS, writeLS
    phase.ts                 clampNum, confidenceLabel, mapMacroPhaseToRotation, detectCurrentPhase
    format.ts                toNum, formatKoreanMoney, formatKoDateTime(+Long)
    sectorText.ts            buildMetricsSummary, buildSectorReason
    tabs.ts                  rankSectors(sorted/promising/next/displayed 계산), latestUpdatedAt 계산
  hooks/
    useSectorsData.ts        all/loading/error, loadData, 캐시 초기값, 마운트 로드, marketOverview, lastLoadedAt
    useSectorLeaders.ts      sectorLeaders/로딩/오류/기준, loadSectorLeaders, 펼침 상태, 카드 클릭, 탭 변화 시 상위 20개 지연 조회
  components/
    ScoreBadge.tsx, ChangeRate.tsx, NatureBadge.tsx, PhaseIcon.tsx   (작은 표시 컴포넌트, 한 파일 badges.tsx로 묶어도 됨)
    SectorCard.tsx, SectorSummaryTable.tsx, SheetSectionHeader.tsx
    RankedSectorsTable.tsx   유망/다음 섹터 표(인라인 110줄)
    AllSectorsView.tsx, SectorGuideView.tsx, TabBar.tsx
  README.md
```

## 단계

0. **스모크 테스트**로 현재 동작 고정. 가짜 `apiFetch`(`sectors`, `market-overview`, `sector-leaders`), `EconomicEventBadge`/`SheetHeaderBar` 필요 시 mock. 고정할 것:
   - 마운트 시 `sectors`·`market-overview` 병렬 조회, 시장 개요 실패해도 섹터 표시.
   - 캐시(`ls_sectors_page`, 60초 이내)가 있으면 조회하지 않고 바로 표시.
   - 탭별 목록: 상위(점수 55 이상, 없으면 전체), 다음(수급 5일 합 > 0 또는 등락 > 0 & 점수 ≥ 40, 수급 순), 전체, 가이드.
   - 상위/다음 탭에서 상위 20개 섹터의 대장주를 한 번에 조회하고, 이미 받은 섹터는 다시 조회하지 않음.
   - 카드 클릭 → 펼침 토글 + 대장주 조회, 대장주 클릭 → 세션 키 + `onNavigate('analyze')`.
   - 국면 추정: 점수가 없으면 "데이터 부족", 1·2위 격차가 작으면 판단 보류, 거시 국면과 일치/불일치에 따른 신뢰도 가감.
   - 조회 실패 시 오류 표시와 재시도.
1. `types.ts`·`constants.ts`, 순수 도우미를 `lib/`로 + 단위 테스트(`detectCurrentPhase`의 신뢰도 계산, `buildSectorReason` 등).
2. 탭 계산(`rankSectors`)을 `lib/`로 + 테스트. 정렬 동률·`null` 점수 처리를 고정.
3. 컴포넌트를 파일로 이동(`SectorGuideView`, `AllSectorsView`, `SectorCard`, 표, 배지), 유망/다음 표 분리.
4. 훅 2개로 분리.
5. 정리와 README.

## 주의 (동작 유지)

- **`displayed` 효과의 의존성**: `displayed`는 렌더마다 새 배열이라 대장주 조회 효과가 매 렌더 실행된다. `loadSectorLeaders` 안의 가드(이미 받은 섹터 제외, 조회 중이면 중단)가 중복 호출을 막는다. 분해하면서 `useMemo`로 고정하고 싶겠지만, 가드 의미가 달라질 수 있으니 **동작 보존 단계에서는 그대로 두고** 별도 개선으로 다룬다(`useSectorLeaders`로 옮길 때 같은 가드를 유지).
- **캐시 초기값**: 첫 렌더에서 `readLS`로 목록을 채우고 `loading`을 그에 맞춰 시작한다. 이 초기화를 훅으로 옮길 때 `useState` 초기값 함수 시점(첫 렌더)을 유지한다.
- **시장 개요 실패 허용**: `Promise.allSettled`로 섹터가 성공하면 시장 개요 실패는 무시한다. 의미를 바꾸지 않는다.
- **`detectCurrentPhase`** 임계값(80/60 신뢰도, 격차 비율 0.12, 유효 섹터 12개 기준)은 매직 넘버다. 옮길 때 값을 바꾸지 않고 테스트로 고정한다. 이 추정은 화면 안내용이며 매매 규칙이 아니다(11/23 규칙 보류 대상 아님).
- `SectorGuideView`는 대부분 정적 설명이라 위험이 낮지만 문구가 길다. 문구를 고치지 않는다. 보장 수익을 암시하는 표현이 없는지는 분해와 별개로 확인한다(원칙: 주장 범위를 검증된 것으로 제한).
- CSS(`sector-*`, `xls-*`)는 공유될 수 있어 옮기지 않는다.

## 위험과 판단

- 0단계는 비교적 쉽다: 외부 의존이 적다(차트·공시 컴포넌트 없음). 표/카드 텍스트가 많아 `getByText` 충돌만 조심하면 된다.
- 3단계가 가장 크다(이동만 약 700줄). 컴포넌트들이 이미 props 기반이라 변환 오류 가능성은 낮다.
- 4단계 훅은 2개뿐이고 상태 의존이 단순해(데이터 → 리더 조회) `analyze`보다 쉽다.
- `operations`(1598줄, 관리자 화면)는 이 다음 후보다. 관리자 전용이라 사용자 영향이 작으니 우선순위는 낮다.
