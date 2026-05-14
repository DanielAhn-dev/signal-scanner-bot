# signal-scanner-bot: 포트폴리오 혼합 지점 분석 보고서
**작성일**: 2026년 5월 14일

---

## 📊 Executive Summary

signal-scanner-bot은 **가상매매 포지션**과 **개인 보유 종목**을 동일 테이블(`virtual_positions`)에 저장하고 있습니다. 

**핵심 발견**:
- ✅ **웹 UI** (`handlers/ui/positions.ts`): 명시적 필터링으로 잘 분리됨
- ❌ **자동매매 서비스** (`virtualAutoTradeService.ts`): 계정 필터 부재로 **혼합 위험** 존재
- ⚠️ **거래 기록**: 메타 필드로 출처 추적 가능하지만, 쿼리에는 반영 안됨

---

## 📋 1. 테이블 스키마 구조

### 1.1 `virtual_positions` (포지션 저장소)

| 필드 | 타입 | 용도 | 마이그레이션 |
|------|------|------|-----------|
| `id` | bigint (PK) | 포지션 ID | 20260418 |
| `chat_id` | bigint | 사용자 ID (Telegram) | 20260418 |
| `code` | text | 종목코드 | 20260418 |
| `buy_price` | numeric | 매수가 | 20260418 |
| `buy_date` | date | 매수일 | 20260418 |
| `quantity` | integer | 보유수량 | 20260418 |
| `invested_amount` | numeric | 투자금액 (qty × price) | 20260418 |
| `status` | text | 'holding' \| 'interest' | 20260418 |
| `memo` | text | 전략정보 (JSON-like) | 20260418 |
| `broker_name` | text | 브로커명 (NULL=가상) | 20260512 ⭐ |
| `account_name` | text | 계좌명 (NULL=가상) | 20260512 ⭐ |
| `bucket` | text | 'LONG' \| 'SWING' | 20260423 |
| `created_at` | timestamptz | 생성시간 | 20260418 |
| `updated_at` | timestamptz | 수정시간 | 20260418 |

**제약조건**:
- `UNIQUE(chat_id, code)` - 종목당 최대 1개 포지션만 보유 가능

**호환성 뷰**:
```sql
CREATE VIEW watchlist AS
SELECT id, chat_id, code, buy_price, buy_date, memo, created_at, 
       updated_at, quantity, invested_amount, status, broker_name, account_name
FROM virtual_positions;
```

### 1.2 `virtual_trades` (거래 로그)

```sql
id, chat_id, code, side ('BUY'|'SELL'|'ADJUST'),
price, quantity, gross_amount, net_amount,
fee_amount, tax_amount, pnl_amount,
broker_name, account_name, memo, traded_at
```

**중요**: `broker_name`, `account_name` 필드 존재 → 거래 출처 추적 가능

### 1.3 `virtual_trade_lots` (로트 추적)

```sql
id, chat_id, code, 
position_id (FK → virtual_positions.id),
watchlist_id (구 FK, 호환성 유지),
acquired_price, acquired_quantity, remaining_quantity,
acquired_at, closed_at
```

---

## 🔀 2. 가상매매 vs 개인 보유 구분 메커니즘

### 2.1 구분 기준 정의

#### 📍 가상매매 (Virtual Trading)
```
broker_name IS NULL AND account_name IS NULL
```
- 자동매매 서비스에서만 발생
- 매수/매도가 모두 자동화됨

#### 📍 개인 보유 (Personal Account)
```
(broker_name IS NOT NULL) OR (account_name IS NOT NULL)
```
- 실계좌 폴더 개념 (증권사/계좌명)
- 웹 UI에서 수동으로 기록
- 예: `broker_name='삼성증권'`, `account_name='계좌#1234'`

---

## ✅ 2.2 명확하게 분리된 영역

### 📍 웹 UI: handlers/ui/positions.ts (L291)

```typescript
// 쿼리
const base = supabase
  .from('virtual_positions')
  .select('id, chat_id, code, ..., broker_name, account_name')
  .eq('chat_id', chatId)

// 선택적 필터
if (brokerName) base = base.eq('broker_name', brokerName)
if (accountName) base = base.eq('account_name', accountName)

// 응답에서 account_kind 계산 (L291)
account_kind: (!String(row.broker_name || '').trim() && 
              !String(row.account_name || '').trim()) ? 'virtual' : 'account'
```

**분리 수준**: ⭐⭐⭐⭐⭐ (매우 명확)

### 📍 거래 기록: handlers/ui/virtual-trade.ts (L37~150)

#### BUY 거래 처리
```typescript
if (!brokerName && !accountName) {
  // broker/account 명시 없으면, 해당 종목의 가장 큰 qty 포지션에서 추출
  const { data: posRows } = await supabase
    .from('virtual_positions')
    .select('broker_name, account_name, quantity')
    .eq('chat_id', chatId)
    .eq('code', String(code))
    .order('quantity', { ascending: false })
    .limit(1)
  brokerName = String((pos as any)?.broker_name || '').trim() || null
  accountName = String((pos as any)?.account_name || '').trim() || null
}

// virtual_positions 업데이트 (L108~130)
.from('virtual_positions')
.update({
  quantity: nextQty,
  invested_amount: nextInvested,
  broker_name: brokerName || positionRow?.broker_name || null,
  account_name: accountName || positionRow?.account_name || null
})
.eq('id', positionRow.id)
```

#### SELL 거래 처리 (중요!)
```typescript
// 계정 범위 필터 정의 (L65~72)
const applyAccountScope = <T>(query: T) => {
  let scoped: any = query
  if (brokerName) scoped = scoped.eq('broker_name', brokerName)
  else scoped = scoped.is('broker_name', null)
  if (accountName) scoped = scoped.eq('account_name', accountName)
  else scoped = scoped.is('account_name', null)
  return scoped
}

// SELL 시 해당 계정의 포지션만 매칭
const scopedPosQuery = applyAccountScope(positionSelectBase)
const { data: scopedPosRows } = await scopedPosQuery.limit(200)

// 로트도 해당 포지션 ID들로만 필터
if (scopedPositionIds.length > 0) {
  const { data } = await lotsQuery
    .in('position_id', scopedPositionIds)
    .order('acquired_at', { ascending: true })
}
```

**분리 수준**: ⭐⭐⭐⭐⭐ (SELL도 계정별 로트 매칭)

### 📍 위치 유지보수: handlers/ui/positions-maintenance.ts

```typescript
// 전체 매도 (L155~200)
const { data: holdings, error: holdErr } = await supabase
  .from('virtual_positions')
  .select('id, code, quantity, buy_price, status, broker_name, account_name')
  .eq('chat_id', chatId)
  .gt('quantity', 0)

// 각 포지션의 broker/account 메타 유지하며 거래 로그 기록
trades = rows.map((row: any) => ({
  chat_id: chatId,
  code: String(row.code),
  broker_name: String(row?.broker_name || '').trim() || null,
  account_name: String(row?.account_name || '').trim() || null,
  ...
}))
```

**분리 수준**: ⭐⭐⭐⭐ (메타 필드 유지)

---

## ⚠️ 3. 혼합 위험 지점 (Critical Issues)

### 🔴 HIGH PRIORITY: 자동매매 서비스의 범위 문제

#### Issue #1: watchlist 조회의 모호성

**파일**: `src/services/virtualAutoTradeService.ts`

**L2958 (runDailyReviewForUser)**:
```typescript
const { data: postHoldings, error: postHoldingsError } = await supabase
  .from(PORTFOLIO_TABLES.positionsLegacy)  // = 'watchlist' view
  .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo")
  .eq("chat_id", chatId)  // ❌ broker_name, account_name 필터 없음!
```

**문제**:
- `PORTFOLIO_TABLES.positionsLegacy`는 `watchlist` 뷰 → 실제로는 `virtual_positions` 조회
- `.eq("chat_id", chatId)` 단 하나의 필터로 **모든 포지션 조회** (가상매매 + 개인 보유 섞임)
- `broker_name`, `account_name` 필드를 선택하지 않아 메타정보 손실

**영향**:
1. ❌ 자동매매는 개인 보유 종목도 "활성 보유"로 간주
2. ❌ 추가매수(add-on) 후보에 개인 보유 종목 포함
3. ❌ 현금 계산 시 개인 보유 invested_amount 포함
4. ❌ 슬롯 결정 시 개인 보유 수를 활성 포지션으로 계산

**예시 시나리오**:
```
가상매매: AAPL 1주 (broker_name=null)
개인보유: AAPL 1주 (broker_name='삼성증권')

runDailyReviewForUser():
  → postHoldings = 2개 행 반환 (둘 다 code='AAPL')
  → activeHoldings에 2개 모두 포함
  → heldCodes.add('AAPL') → 1번만 추가되지만

selectDailyAddOnCandidates():
  → AAPL은 "2주 보유 중"으로 인식
  → 추가매수 시 개인보유 주까지 고려하여 투자금 계산
```

---

#### Issue #2: Monday Buy 슬롯 계산 오류

**L1545 (runMondayBuyForUser)**:
```typescript
const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
const activeCount = (holdings ?? []).filter(
  (row) => Number(row.quantity || 0) > 0
).length;

const slotsLeft = Math.max(
  0,
  Math.min(
    toPositiveInt(payload.setting.monday_buy_slots, 2),
    maxPositions - activeCount  // ❌ 개인보유 포함됨
  )
);
```

**문제**:
- `holdings`는 모든 포지션 (가상매매 + 개인보유)
- `activeCount`가 개인보유 수로 부풀려짐
- → `slotsLeft`가 과소 계산 → 신규 매수 기회 감소

**예시**:
```
설정: max_positions=8, monday_buy_slots=2

현실:
  - 가상매매: 2개
  - 개인보유: 5개
  - 합계: 7개

자동매매 인식:
  activeCount = 7
  slotsLeft = min(2, 8-7) = 1 ← 과소
  
정상 인식:
  activeCount = 2 (가상만)
  slotsLeft = min(2, 8-2) = 2 ← 정상
```

---

### 🟡 MEDIUM PRIORITY: 포트폴리오 동기화 범위

**파일**: `src/services/portfolioService.ts`

**syncVirtualPortfolio() (L208~)**:
```typescript
export async function syncVirtualPortfolio(
  chatId: number,
  tgId: number
): Promise<SyncedPortfolioState> {
  const prefs = await getUserInvestmentPrefs(tgId);
  const { data, error } = await supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, quantity, buy_price, invested_amount, status")
    .eq("chat_id", chatId);  // ❌ 필터 없음

  const normalized = rows.map(row => normalizeWatchlistHolding({...}))
  
  // ... 정규화 로직 ...
  
  const synced = deriveSyncedPortfolioState({ prefs, holdings: normalized });
  // holdings에 모든 포지션 포함
  
  return synced;
}
```

**함수**: `deriveSyncedPortfolioState()` (L179~195)
```typescript
const investedTotal = roundKrw(
  input.holdings.reduce((sum, row) => {
    if (row.status !== "holding") return sum;
    return sum + toFiniteNumber(row.investedAmount, 0);  // ❌ 모든 invested_amount 합산
  }, 0)
);

const cashBalance = roundKrw(
  seedCapital + realizedPnl - investedTotal  // ❌ 개인보유 차감됨
);
```

**영향**:
1. ❌ 개인보유 invested_amount가 가상매매 현금에서 차감
2. ❌ cashBalance가 과소 계산 → 자동매매 구매력 감소
3. ❌ 사용자 설정된 virtual_cash가 덮어쓰기됨

**예시**:
```
virtual_seed_capital = 100,000,000 (1억)

포지션:
  - 가상매매: AAPL 1주 @ 150,000 = 150,000
  - 개인보유: GOOG 1주 @ 140,000 = 140,000

현재 계산:
  investedTotal = 150,000 + 140,000 = 290,000
  cashBalance = 100,000,000 + 0 - 290,000 = 99,710,000 ✅

문제: 개인보유 140,000도 차감되어 
실제 가상자산은 99,710,000이지만, 
정상 계산은 99,850,000이어야 함
```

---

### 🟠 LOW-MEDIUM PRIORITY: 거래 기록의 계정 미식별

**파일들**: 
- `api/ui/stop-loss-take-profit.ts` (L76~100)
- `handlers/ui/operations.ts` (L396~)

```typescript
// operations.ts - getAutoSellCandidates()
const { data, error } = await supabase
  .from('virtual_positions')
  .select('id,code,quantity,buy_price,status,stock:stocks(code,name,close)')
  .eq('chat_id', chatId)
  .eq('status', 'holding')
  .gt('quantity', 0)
  // ❌ broker_name, account_name 조회 안함
```

**영향**:
- 거래 기록은 correct하지만, 자동 손절/익절 판단 시 모든 포지션 고려

---

## 📈 4. 각 핸들러별 종합 평가

| 핸들러 | 테이블 | 필터링 | 혼합 위험 | 특이사항 |
|--------|--------|--------|----------|---------|
| `handlers/ui/positions.ts` | virtual_positions | ✅ broker, account | ⭐ 낮음 | 웹 UI의 명시적 필터 |
| `handlers/ui/virtual-trade.ts` | positions, trades, lots | ✅ applyAccountScope | ⭐ 낮음 | SELL도 계정별 매칭 |
| `handlers/ui/positions-maintenance.ts` | positions, trades | ✅ 메타 필드 유지 | ⭐⭐ 낮음 | 거래 기록은 정확함 |
| `handlers/ui/watchlist.ts` | virtual_positions | ❌ 필터 없음 | ⭐⭐⭐⭐ 높음 | 가상/개인 미분리 |
| `handlers/ui/operations.ts` | virtual_positions | ❌ 필터 없음 | ⭐⭐⭐⭐ 높음 | 자동손절/익절 혼합 |
| `src/services/portfolioService.ts` | watchlist | ❌ 필터 없음 | ⭐⭐⭐ 중간 | 현금 계산 오류 가능 |
| `src/services/virtualAutoTradeService.ts` | watchlist | ❌ 필터 없음 | ⭐⭐⭐⭐⭐ 극도로 높음 | **핵심 문제** |
| `web/portfolio/index.tsx` | 웹 응답 | ✅ account_kind | ⭐ 낮음 | UI는 정확함 |

---

## 🔍 5. virtualAutoTradeService 상세 분석

### 5.1 포지션 조회 지점 (3곳)

#### ① runDailyReviewForUser (L2950~)
```typescript
const { data: postHoldings } = await supabase
  .from(PORTFOLIO_TABLES.positionsLegacy)
  .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo")
  .eq("chat_id", chatId)
  
const activeHoldings = (postHoldings ?? []).filter(
  row => (row.status ?? "holding") !== "closed"
);
const heldCodes = new Set(activeHoldings.map(row => String(row.code)));
```

**문제**: 모든 포지션 조회 + 계정별 분리 안함

#### ② selectDailyAddOnCandidates (L1670~)
```typescript
const codes = payload.holdings.map(holding => holding.code)
const { rows } = await fetchLatestRankedRows({
  supabase,
  limit: Math.max(payload.limit * 5, codes.length || 1),
  codes  // ❌ 개인보유 코드도 포함
})
```

**문제**: 모든 종목에 대해 점수 조회 + 추가매수 신호 검토

#### ③ selectMondayBuy (L1520~)
```typescript
// holdings: 모든 포지션 (개인보유 포함)
const codes = payload.holdings.map(h => h.code)
const heldAndCooldownCodes = new Set([...payload.heldCodes, ...cooldownCodes])

// 신규 매수 후보 선정 시 held codes 제외
const candidates = rankedRows.filter(row => !heldAndCooldownCodes.has(row.code))
```

**부분 안함**: 이미 보유한 종목은 제외하지만, 
개인보유/가상매매 구분 없이 모든 보유를 고려

---

### 5.2 자동매매 실행 흐름

```
runVirtualAutoTradingForChat()
  ↓
  ├─ runMondayBuyForUser()
  │   └─ holdings = watchlist 조회 (모든 포지션) ❌
  │   └─ activeCount 산정 (개인보유 포함) ❌
  │   └─ slotsLeft 과소 계산 ❌
  │
  ├─ runDailyReviewForUser()
  │   └─ postHoldings 조회 (모든 포지션) ❌
  │   └─ SELL 신호 검토 (개인보유도) ❌
  │   └─ addOn 후보 선정 (개인보유 종목) ❌
  │
  └─ 거래 실행
      └─ handlers/ui/virtual-trade.ts
          └─ 여기선 broker_name=null, account_name=null로 처리 ✅
              (자동매매 특성상 이 값들은 항상 null)
```

---

## 💼 6. 웹 포트폴리오 뷰 분석

### 6.1 portfolio/index.tsx

```typescript
// L73-74
function isVirtualPositionRow(row: any): boolean {
  return String(row?.account_kind || '').toLowerCase() === 'virtual'
}

// account_kind는 handlers/ui/positions.ts에서 계산됨 (L291)
account_kind: (!String(row.broker_name || '').trim() && 
              !String(row.account_name || '').trim()) ? 'virtual' : 'account'
```

**현황**:
- ✅ 웹 UI에서는 정확하게 필터링됨
- ✅ 사용자가 보는 포트폴리오는 가상/개인 분리됨
- ❌ 하지만 백엔드 자동매매는 이를 무시

---

## 🎯 7. 현재 보호 메커니즘

### ✅ 있는 것들

1. **Dry-Run 모드** (`prefs.virtual_shadow_mode`)
   - 활성화 시 실제 거래 차단
   - 테스트 후 활성화

2. **거래 로그의 메타정보**
   - `virtual_trades`에 `broker_name`, `account_name` 저장
   - 거래 감사(audit) 가능
   - 하지만 자동화 과정에서 이 값이 올바르게 설정되지 않을 수 있음

3. **Unique 제약**
   - `UNIQUE(chat_id, code)` → 종목당 1개 포지션만 보유
   - 실제로는 가상매매 1개 + 개인보유 1개 불가능
   - **이게 바로 문제!** 가상과 개인을 분리할 수 없음

4. **Lot Matching의 FIFO**
   - SELL 시 FIFO 기반 로트 매칭
   - 특정 로트만 처리
   - 하지만 로트 조회 시 account scope 필터 미적용

### ❌ 없는 것들

1. 자동매매 실행 전 "가상-개인 분리 검증"
2. 슬롯 계산 시 가상매매만 고려하는 로직
3. 추가매수 후보에서 개인보유 종목 필터링
4. 손절/익절 대상의 명시적 계정 확인

---

## 🔧 8. 권장 개선 우선순위

### 🔴 Priority 1: virtualAutoTradeService 필터 추가

**파일**: `src/services/virtualAutoTradeService.ts`

**L2958 수정**:
```typescript
// 기존
const { data: postHoldings } = await supabase
  .from(PORTFOLIO_TABLES.positionsLegacy)
  .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo")
  .eq("chat_id", chatId)

// 개선
const { data: postHoldings } = await supabase
  .from(PORTFOLIO_TABLES.positionsLegacy)
  .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo, broker_name, account_name")
  .eq("chat_id", chatId)
  .is("broker_name", null)     // ⭐ 가상매매만
  .is("account_name", null)    // ⭐ 가상매매만
```

**영향**: 
- ✅ 자동매매가 개인보유 종목 무시
- ✅ 슬롯 계산 정확화
- ✅ 추가매수 후보 정확화

---

### 🔴 Priority 2: selectMondayBuy 의존성 확인

**파일**: `src/services/virtualAutoTradeService.ts` (L1520~)

```typescript
// runMondayBuyForUser에 전달되는 holdings도 필터링 확인
const holdings = postHoldings.filter(
  row => !row.broker_name && !row.account_name
)
```

---

### 🟠 Priority 3: portfolioService 스코핑

**파일**: `src/services/portfolioService.ts` (L208~)

**선택사항 A**: 가상매매만 계산
```typescript
const { data } = await supabase
  .from(PORTFOLIO_TABLES.positionsLegacy)
  .select("...")
  .eq("chat_id", chatId)
  .is("broker_name", null)
  .is("account_name", null)
```

**선택사항 B**: 모든 포트폴리오 계산 (별도 함수)
```typescript
// syncVirtualPortfolio() → 가상매매만
// syncTotalPortfolio() → 전체 (가상 + 개인)
```

---

### 🟠 Priority 4: 웹 UI 거래 핸들러 강화

**파일들**: 
- `handlers/ui/operations.ts`
- `api/ui/stop-loss-take-profit.ts`

```typescript
// 거래 기록에 broker_name, account_name 포함 선택
.select("..., broker_name, account_name")
```

---

## 📊 9. 현재 상태 요약표

### 테이블 데이터 정확성
| 항목 | 상태 | 설명 |
|------|------|------|
| virtual_positions 저장 | ✅ | broker_name, account_name 필드로 분리됨 |
| virtual_trades 저장 | ✅ | 거래 기록에 메타정보 저장 |
| virtual_trade_lots | ✅ | 로트별 출처 추적 가능 |

### 조회 정확성
| 영역 | 상태 | 설명 |
|------|------|------|
| 웹 UI (positions.ts) | ✅ | 명시적 필터링 |
| 웹 UI (virtual-trade.ts) | ✅ | applyAccountScope 사용 |
| 웹 UI (포트폴리오 표시) | ✅ | account_kind 정확함 |
| 자동매매 서비스 | ❌ | watchlist 조회, 필터 없음 |
| 포트폴리오 동기화 | ⚠️ | 현금 계산에 개인보유 포함 |

---

## 🎓 10. 최종 결론

### 핵심 문제
```
database: ✅ 분리 가능한 스키마
   ↓
web-ui:  ✅ 명시적 필터링으로 잘 분리됨
   ↓
api:     ✅ 거래별로 메타 유지
   ↓
서비스:  ❌ virtualAutoTradeService가 모든 포지션 조회
   ↓
결과:    ⚠️ 개인 보유 종목이 자동매매에 영향을 줄 수 있음
```

### 위험도 평가

**🔴 극도로 높음** (작업 필수):
- `virtualAutoTradeService`: watchlist 조회 필터 부재
- 영향: 자동매매 로직이 개인보유 종목을 활성 포지션으로 인식

**🟠 중간** (권장):
- `portfolioService.syncVirtualPortfolio()`: 현금 계산 오류 가능
- 영향: 자동매매 구매력 계산 부정확

**🟡 낮음** (개선 권장):
- 거래 기록에 account 메타 누락
- 영향: 감사 추적성 감소

---

## 📌 참고: 마이그레이션 타임라인

```
20260418: virtual_positions 생성 (watchlist → 정식화)
20260418: watchlist 뷰 생성 (호환성)
20260418: virtual_trade_lots FK 수정
20260423: bucket (LONG/SWING) 추가
20260512: broker_name, account_name 추가 ⭐
```

**결론**: 계정 구분 인프라는 이미 준비됨. 
이제 자동매매 서비스에서 이를 활용하기만 하면 됨.

---

## 📎 부록: 쿼리 가이드

### ✅ 가상매매만 조회
```typescript
supabase
  .from('virtual_positions')
  .select('*')
  .eq('chat_id', chatId)
  .is('broker_name', null)
  .is('account_name', null)
```

### ✅ 개인 보유만 조회
```typescript
supabase
  .from('virtual_positions')
  .select('*')
  .eq('chat_id', chatId)
  .or('broker_name.is.not.null,account_name.is.not.null')
```

### ✅ 특정 계정 조회
```typescript
supabase
  .from('virtual_positions')
  .select('*')
  .eq('chat_id', chatId)
  .eq('broker_name', brokerName)
  .eq('account_name', accountName)
```

### ✅ 모든 포지션 (거래 기록)
```typescript
// applyAccountScope 활용
const applyAccountScope = (query) => {
  if (brokerName) query = query.eq('broker_name', brokerName)
  else query = query.is('broker_name', null)
  
  if (accountName) query = query.eq('account_name', accountName)
  else query = query.is('account_name', null)
  
  return query
}
```

---

**작성자**: AI Assistant  
**검토 대상**: signal-scanner-bot 개발팀  
**다음 액션**: 우선순위 1 수정 적용 및 테스트
