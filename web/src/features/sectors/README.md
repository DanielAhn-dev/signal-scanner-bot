# 섹터 (`sectors`)

섹터 점수·수급을 경기 국면과 함께 보여준다. 탭 4개: 상위 섹터 / 다음 섹터 / 전체 섹터 / 섹터 가이드. 섹터를 펼치면 대장주 TOP 3를 보여주고, 대장주를 누르면 분석 화면으로 이동한다.

## 구조

| 폴더 | 역할 | 규칙 |
|---|---|---|
| `index.tsx` | 훅을 부르고 탭별 컴포넌트를 배치한다 | 조회·계산을 직접 넣지 않는다 |
| `hooks/` | `useSectorsData`(섹터+시장 개요 조회, 60초 캐시 초기값), `useSectorLeaders`(대장주 지연 조회·카드 펼침) | **호출 순서 = 효과 실행 순서**: 섹터 조회 → 대장주 조회 |
| `lib/` | 순수 계산: `phase`(경기 국면 추정), `tabs`(탭별 정렬·필터), `sectorText`(요약·사유 문구), `format`, `cache` | 테스트 `lib/helpers.test.ts` |
| `components/` | `SectorSummaryTable`, `TabBar`, `RankedSectorsTable`, `AllSectorsView`, `SectorGuideView`, `SheetSectionHeader`, `badges`(점수·등락·성격·국면 아이콘) | 필요한 값만 props로 받는다 |
| `sectorMeta.ts` | 섹터 정적 메타(WICS 분류, 성격, 유리한 국면), 로테이션 사이클, 거시 민감도 | 서버 API로 교체하는 가이드가 파일 머리에 있다 |
| `types.ts` / `constants.ts` | 타입 / TTL·키·임계값·색상표 | |

## 다른 화면과의 계약 (바꾸지 않는다)

- 기본 내보내기 `SectorsPage({ onNavigate? })` — `App.tsx`가 lazy로 불러온다.
- 대장주 클릭: `sessionStorage`의 `analyze_pending_code`에 코드를 쓰고 `onNavigate("analyze")`(없으면 `history.pushState`).
- localStorage 키 `ls_sectors_page`(섹터 목록, TTL 60초). 첫 렌더에서 읽어 `all`/`loading` 초기값을 정한다.

## 데이터

- `GET /api/ui/sectors` — 섹터 점수·등락·지표(실패하면 오류 표시)
- `GET /api/ui/market-overview` — 거시 국면(실패해도 섹터는 표시, `retries: 0`)
- `GET /api/ui/sector-leaders?sectorIds=&limitPerSector=3` — 대장주(최대 30개 섹터씩, 이미 받은 섹터 제외)

## 주의

- **대장주 효과의 의존성**: `displayed`는 렌더마다 새 배열이라 대장주 조회 효과가 매 렌더 실행된다. 중복 호출은 `loadSectorLeaders`의 가드(이미 받은 섹터 제외, 조회 중이면 중단)가 막는다. 훅 안에서도 같은 구조를 유지한다. 개선하려면(예: `useMemo`) 가드 의미가 달라지지 않는지 스모크 테스트로 확인한다.
- **국면 추정(`lib/phase.ts`)**은 안내용이다. 임계값(신뢰도 80/60, 격차 비율 0.12, 유효 섹터 12개 기준)을 바꾸면 화면 문구와 `helpers.test.ts`가 달라진다. 거시 신호가 없고 1·2위 점수 차가 작으면 판단을 보류한다. 확률이 아니라 판별 강도라는 점을 화면 툴팁이 설명한다.
- 시장 개요가 있으면 신뢰도에 거시 국면 일치(+)/불일치(−)를 반영한다(가중치는 거시 신뢰도의 20%, 8~20, 신뢰도가 없으면 12).
- `SectorGuideView`는 정적 설명이 대부분이다. 문구를 고칠 때 보장 수익을 암시하지 않도록 한다(주장 범위를 검증된 것으로 제한하는 원칙).
- 분해 중 어디에서도 쓰이지 않던 `SectorCard` 컴포넌트를 제거했다(유망/다음 탭은 표로 렌더링한다).
- 스모크 테스트(`index.test.tsx`)가 캐시, 탭별 목록, 대장주 지연 조회, 클릭 이동, 국면 신뢰도, 오류를 고정한다. 전체 섹터 탭은 범례·이름만 확인한다.
