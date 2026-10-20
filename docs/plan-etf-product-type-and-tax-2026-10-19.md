# ETF 상품 유형·과세 분류 계획 (2026-10-19)

## 왜 하나

데이터 구조가 개별주 중심이라 ETF는 예외 처리로 끼워져 있다.

- **ETF 여부**: `stocks`에 상품 유형 컬럼이 없다. 운용사 브랜드 이름 정규식(`src/lib/securitiesTax.ts` `ETF_BRAND_PATTERN`)으로 판정한다. 서버 사본과 웹 사본(`web/src/lib/tradeCost.ts`)이 이미 갈라졌다. 웹의 `KNOWN_ETF_CODES`에는 102110·122630이 없다.
- **매매차익 과세(기타 ETF 15.4%)**: 코드 4개(`OTHER_ETF_CODES`: CD금리 3종·KODEX 레버리지)만 과세한다. 리밸런싱 리포트는 따로 `FOREIGN` 이름 정규식(`src/lib/rebalanceReport.ts:31`)으로 해외 ETF를 과세한다. 그래서 같은 상품을 두고 경로마다 판정이 다르다.
  - 지금 과세에서 빠지는 것: 국고채·미국채·금현물 ETF(코어 프로필 148070·453850·308620·411060). 이름에 "미국"이 없는 해외 ETF도 빠진다.
  - 가상매매는 아직 이 상품들을 사지 않는다. 그래서 **지금 기록이 틀린 것은 아니다.** 다만 코어 프로필이나 자산배분을 가상 계좌로 돌리면 바로 결과가 실제보다 좋아 보인다.
- **유니버스 제외**: `isExcludedStockName`·`refresh_universe_membership.py`의 `/ETF/` 패턴은 "KODEX 200"처럼 이름에 ETF가 없는 상품을 못 잡는다. 실제로 ETF가 빠지는 이유는 따로 있다. 유니버스 원본(KRX 상장사·pykrx 종목 목록)이 처음부터 ETF를 빼고 오기 때문이다. 이름 규칙은 사실상 동작하지 않는 안전망이다.

> **이후 바뀐 것 (31d566e, 같은 날)**: ETF 브랜드 판별은 `securitiesTax.ts` `ETF_BRANDS` 하나로 합쳤다. 웹 `tradeCost.ts`는 서버 함수를 그대로 쓰므로 위의 코드 목록 차이는 사라졌다. 브랜드 뒤 조건을 `\b` → (공백|끝)으로 바꿔 BNK금융지주 오탐·한글 브랜드 누락을 고쳤다. `isExcludedStockName`과 `refresh_universe_membership.py`도 브랜드로 시작하는 이름을 거른다. 사본이나 네이버 ETF 엔드포인트 모듈이 새로 생기면 `tests/etfBrandSingleSource.test.ts`가 실패한다. 아래 2단계에서 `market_snapshot.py`가 ETF 목록을 읽으면 파이썬 쪽 첫 모듈이라 이 테스트를 통과한다. 그런데 2단계 뒤 5단계(유니버스 제외를 `product_type`으로)를 하면 이름 규칙은 대체 판정으로만 남는다.

## 데이터 출처 (2026-10-19 실측)

| 필드 | 출처 | 비고 |
|---|---|---|
| `product_type` | 네이버 모바일 시세 `stockEndType` | 이미 `market_snapshot.py`가 받고 있는데 버린다 |
| `etf_category` | `finance.naver.com/api/sise/etfItemList.nhn` `etfTabCode` | 요청 1번에 국내 ETF 1,176종 전부. EUC-KR |
| `etf_tax_class` | `etf_category`에서 파생 + 코드 덮어쓰기 | 1·2 → `domestic_equity`, 3~7 → `other` |

etfTabCode 분포: 1 국내지수 99 · 2 국내업종/테마 342 · 3 국내파생 37 · 4 해외주식 380 · 5 원자재 23 · 6 채권 171 · 7 기타 124.

## 단계

### 1. 마이그레이션 — `db/migrations/036_stock_product_type.sql` (**Supabase SQL Editor에서 실행 필요**)
- `stocks`에 `product_type`·`etf_category`·`etf_tax_class`·`product_type_updated_at` 컬럼을 추가하고 CHECK 제약을 건다. ETF가 아닌 행에는 ETF 필드를 못 넣는다.
- 지금 다루는 ETF 26종을 미리 채운다. 첫 배치가 돌기 전에도 쓸 수 있게 하려는 것이다.
- `apply_stock_product_types(jsonb)` RPC: 바뀐 행만 UPDATE한다. upsert를 쓰면 없는 코드로 행이 생기므로 쓰지 않는다. 실행 권한은 service_role만 준다.

### 2. 일일 배치 — `scripts/batch_modules/market_snapshot.py`
- 이미 받는 `stockEndType`에 ETF 목록 요청 1번을 더한다. 이 요청은 실패해도 배치를 막지 않고, ETF 필드만 그날 건너뛴다.
- 순수 함수 `build_product_type_rows(snapshot_rows, etf_tabs)`를 만들고 RPC를 200행 단위로 호출한다.
- **안전장치**: ETF 목록이 비었거나 평소의 절반(예: 500종 미만)이면 ETF 필드는 쓰지 않는다. 일시 오류를 "ETF 아님"으로 덮어쓰지 않기 위해서다. 조회 실패를 '없음'으로 취급하지 않는다는 원칙을 따른다.
- `--dryRun=true`로 바뀔 행 수와 분류별 개수를 먼저 출력해 보고 운영에 쓴다.
- **구현함 (2026-10-19)**: `market_snapshot.py` `sync_product_types`(스냅샷 저장·신규 상장 등록 뒤 실행)와 즉시 실행용 `scripts/sync_product_types.py [--dry-run]`을 만들었다. 테스트는 `python -m unittest scripts/batch_modules/test_market_snapshot_product_types.py`로 돌린다.
  - 드라이런 결과(운영 DB 읽기만 함): 4,307종 = stock 2,763 · etf 1,176 · etn 368. ETF 과세는 domestic_equity 441 · other 735이고 건너뛴 종목은 없다. 바뀔 행은 4,281개다. 036에서 미리 채운 26종은 배치 값과 같아서 바뀌지 않는다.

### 3. 판정 함수 일원화 — `src/lib/securitiesTax.ts`
- `resolveProductKind({ code, name, productType? })`: DB 값을 먼저 보고, 없으면 지금의 코드 목록과 이름 규칙으로 판정한다.
- `resolveEtfTaxClass({ code, name, productType?, etfTaxClass? })`: 덮어쓰기 목록 → DB 값 → 이름 규칙 순서로 정한다. 이름 규칙에서 해외 지역명·채권·국채·금·은·원유·선물·레버리지·인버스·합성·혼합이 들어 있으면 `other`로 본다.
- `resolveOtherEtfGainTax({ code, name?, etfTaxClass?, gain })`: 기존 시그니처를 유지한다. 인자가 늘어도 예전 호출은 그대로 동작한다.
- `rebalanceReport.ts`의 `FOREIGN` 정규식을 이 함수로 바꾼다. 리포트 숫자가 바뀌므로 `tests/rebalanceReport.test.ts`의 기대값을 확인한다.
- **구현함 (2026-10-20)**: `isExchangeTradedProduct(code, name, productType?)`, `resolveEtfTaxClass`, `resolveOtherEtfGainTax({code, name?, productType?, etfTaxClass?, gain})`를 만들었다. 리포트 매도 비용과 합치기의 `taxedGain`(rebalancePlan)도 이 함수로 판정한다. 지역별로 묶는 데 쓰는 `FOREIGN`은 과세가 아니라서 그대로 둔다.
  - 운영 DB 반영: 첫 실행에서 4,278행을 바꿨고, 아래 보정 뒤 34행을 더 바꿨다. 다시 돌린 드라이런은 0행이다.
  - 네이버 ETF 1,176종과 대조하다 두 가지를 찾았다.
    - (a) 브랜드 목록에 TIME·KoAct·KCGI·MIDAS·DS·HK·IBK·아이엠에셋·DAISHIN·TRUSTON·더제이가 빠져 있었다(76종). 목록에 추가했고, stocks 전체에서 개별주 이름과 겹치지 않는 것을 확인했다.
    - (b) 네이버 탭 1·2(국내)에 단일종목·업종 레버리지·인버스, 은행채·채권혼합, 인도·미국 ETF가 섞여 있었다(31종). 배치가 이름으로 골라 `other`로 돌린다(`NOT_DOMESTIC_EQUITY_NAME`).
  - 이름 규칙만 쓸 때(DB 값이 없을 때) 1,176종 중 약 1,135종이 맞는다. 틀리는 쪽은 둘이다. 하나는 이름에 나라가 없는 해외 ETF(테슬라밸류체인 등)로, 세금을 덜 잡는다. 다른 하나는 국내 리츠·코스닥글로벌 등으로, 세금을 더 잡는다. 그래서 4단계에서 DB 값을 실어 보내는 것이 중요하다.

### 4. 호출처 배선
`stocks`를 이미 읽는 곳은 select에 `product_type, etf_tax_class`를 더해 넘긴다.
- 가상매매 매도: `virtualAutoTradeSellStep.ts:248`, `virtualAutoTradeCashSweepStep.ts:304`, `handlers/ui/virtual-trade.ts:123`, `handlers/ui/positions-maintenance.ts:235`
  - 확인된 빈틈: 종목 봇 매도 경로(`SellStep`)에는 기타 ETF 매매차익세가 아예 없다. 지금은 종목 봇이 ETF를 사지 않아 영향이 없지만, 같은 함수로 통일한다.
- 리포트·가이드: `rebalanceReport.ts`, `incomeGuide.ts`, `handlers/ui/rebalance-report.ts`, `handlers/ui/positions.ts`
- 웹: `web/src/lib/tradeCost.ts`는 손으로 옮긴 사본이다. API 응답에 `product_type`을 실어 보내 웹이 그 값을 먼저 쓰게 하고, 코드 목록은 서버와 맞춘다(`diff`로 확인).

### 5. 유니버스 제외 (후순위)
- `refresh_universe_membership.py`·`investableUniverse.ts`가 이름 규칙 대신 `product_type in ('etf','etn')`을 쓰게 한다. 보호 목록(스윕·레짐 프록시·사용자 보유)은 지금 동작을 유지한다.
- 유니버스 구성이 바뀔 수 있으니 `--dryRun`으로 승격·강등 차이를 먼저 본다. 차이가 생기면 별도 커밋으로 나눈다.

### 6. 테스트
- `tests/securitiesTax.test.ts`: DB 값 우선, 덮어쓰기 우선, null이면 이름 규칙으로 판정하는지 본다. 코어 프로필 7종이 모두 기대한 분류가 되는지도 확인한다.
- 불변 테스트: `PROFILE_ETFS`·`recommended_etfs.json`의 모든 코드가 이름 규칙만으로도 마이그레이션 시드와 같은 분류가 되는지 본다. DB가 비어 있을 때 갈라지지 않게 하려는 것이다.
- Python 순수 함수 테스트는 분류 매핑과 "목록이 비면 쓰지 않음"을 본다.

## 정하지 못한 것 (확인 필요)

1. **국내 커버드콜 ETF 과세**: KODEX 200타겟위클리커버드콜은 tab 2(국내업종)인데, RISE 200위클리커버드콜은 tab 3(국내파생)이다. 같은 성격인데 분류가 갈린다. 운용사 공시의 과세 유형을 확인해서 덮어쓰기 목록에 넣어야 한다. 실계좌 인컴 계좌 리포트에 영향이 있다.
2. **ETN**: 국내주식 지수 ETN은 비과세이고 그 외는 배당소득 과세다. 이번 범위에서는 빼고, `product_type='etn'`만 기록한다.
3. **과세표준 근사**: 실제 과세표준은 min(매매차익, 과표기준가 증가분)이다. 지금처럼 매매차익으로 근사하면 해외주식형은 세금을 조금 크게 잡는다(보수적).
4. **ISA·연금 계좌**: 리포트의 `taxAdvantaged` 분기는 지금처럼 둔다. 가상 계좌는 일반 계좌로 가정한다.

## 순서와 커밋
1. 마이그레이션 SQL (이 문서와 함께) → 사용자가 실행
2. 배치 수집 + Python 테스트 → `--dryRun` 확인 후 운영 실행
3. `securitiesTax.ts` 판정 함수 + 테스트
4. 호출처 배선 (서버) → 5. 웹 사본 → 6. 유니버스 제외(별도)

각 커밋은 따로 빌드할 수 있게 한다. 3·4는 DB 컬럼이 비어 있어도 지금과 같은 결과가 나와야 한다. 매매 규칙이 아니라 비용 계산 결함을 고치는 일이므로 11/23 관문 대상이 아니다.
