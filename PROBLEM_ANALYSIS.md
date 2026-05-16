# Signal Scanner Bot - 종합 문제 분석 보고서

**분석 일자**: 2026년 5월 16일  
**분석 범위**: 데이터 수집 → API 안정성 → 데이터 품질 → 성능 → 캐시/동시성

---

## 1. 데이터 수집 문제

### 1.1 ⚠️ investor_daily 데이터 수집 누락

**심각도**: 🔴 HIGH

**현재 상황**:
- **파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L1205-L1235)
- **문제**: 6단계 배치 프로세스 (OHLCV → 지표 → 섹터 → 섹터점수 → 종목점수 → 눌림목신호)에서 investor_daily 수집 완전 누락

**비교 분석 (daily_batch_old.py vs daily_batch.py)**:
```
daily_batch_old.py:
  [1/8] 종목 유니버스 & 펀더멘털 갱신
  [2/8] 당일 OHLCV 시세 수집
  [3/8] 투자자 수급 수집         ← 이것이 daily_batch.py에서 없음
  [4/8] 섹터 지수 & 등락률 수집
  [5/8] 기술적 지표 계산
  [6/8] 섹터 점수 계산
  [7/8] 종목 점수 계산
  [8/8] 오래된 데이터 정리

daily_batch.py:
  [1/6] OHLCV 수집
  [2/6] 기술적 지표 계산
  [3/6] 섹터 등락률 집계
  [3.5/6] sector_daily 시계열 생성
  [4/6] 섹터 점수 계산
  [5/7] 종목 점수 계산
  [6/7] 눌림목 매집 시그널 계산
```

**데이터 의존성**:
```
investor_daily 테이블 조회 위치 (handlers/ui):
  - stock-latest.ts:597-623    (7곳의 조인)
  - summary.ts                 (포지션 수급 신호)
  - scan-candidates.ts         (스캔 수급 필터)
  - positions.ts               (포트폴리오 수급)
```

**발생 가능한 버그 시나리오**:

1. **수급 신호 데이터 부재**:
   ```
   사용자가 /종목분석 삼성전자 입력
   → stock-latest.ts에서 investor_daily 조회 (line 597)
   → 데이터 없음 → NULL 반환
   → 외국인/기관 매매량 필드 공백 (사용자에게 혼동 유발)
   ```

2. **watchlistSignals.ts의 수급신호 계산 실패**:
   ```
   src/lib/watchlistSignals.ts:218
   .from("investor_daily") → 최신 데이터 없음
   → 수급 신호 점수 0점 (실제는 신호 없음)
   → 매매 신호 왜곡
   ```

3. **배치 실행 후 1~2일 경과 시**:
   - 배치 실행 안 됨 → investor_daily 최신 데이터 없음
   - 사용자가 5일 전 데이터를 "오늘" 데이터로 착각
   - 잘못된 매매 의사결정

**해결 필요 항목**:
- ✅ STEP 3 추가: investor_daily 수집 로직
- ✅ API 호출: `stock.get_market_net_purchases_of_equities_by_ticker()`
- ✅ 테이블 upsert: investor_daily (기관/외국인 순매수)

---

### 1.2 ⚠️ 섹터 데이터 동기화 일관성 문제

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L500-L600)

**문제 영역**:

#### 1.2.1 sector_id ↔ ticker 매핑 중복 위험

```python
# Line 502-507: stocks 테이블에서 sector_id 조회
stock_sector_map = {r["code"]: r["sector_id"] for r in (res_stocks.data or [])}

# Line 646: stock_daily에서 ticker 조회
for ticker in today_map:
    sid = stock_sector_map.get(ticker)
```

**잠재적 불일치**:
- `stocks.code` (6자리, e.g., "005930") ✓
- `stock_daily.ticker` (6자리, e.g., "005930") ✓
- 하지만 **데이터 로드 시점 차이**:
  1. `update_sector_data()` 시작 시 `stocks` 조회 (T 시점)
  2. `stock_daily` 저장 완료 (T+몇초)
  3. 그 사이 새 종목이 `stocks`에 추가되면?
  4. `stock_daily`의 그 종목은 `stock_sector_map`에 없음
  5. → `sid = None` → 섹터 집계에서 제외

**발생 시나리오**:
```python
# Line 541-552: 섹터별 평균 등락률 계산
for ticker in today_map:
    sid = stock_sector_map.get(ticker)  # None이 될 수 있음
    if not sid or ticker not in prev_map:
        continue  # 버려짐
```

**결과**:
- 일부 종목의 등락률이 섹터 평균에 반영 안 됨
- 섹터 점수 왜곡 (실제보다 높거나 낮아짐)

**검증 필요**:
```sql
-- 다음 쿼리로 불일치 확인
SELECT DISTINCT sd.ticker
FROM stock_daily sd
WHERE NOT EXISTS (
  SELECT 1 FROM stocks s WHERE s.code = sd.ticker
)
LIMIT 10;
```

---

### 1.3 ⚠️ 데이터 신선도 검증 미흡

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L250-280)

**현재 로직**:
```python
# Line 252-273: 수집 범위 결정
latest_res = supabase.table("stock_daily") \
    .select("date").order("date", desc=True).limit(1).execute()
latest_date = latest_res.data[0]["date"] if latest_res.data else "2025-01-01"

# 데이터 신선도 검증 (BUT 미흡)
days_gap = (trading_dt - latest_dt).days
if days_gap > 30:
    print(f"⚠️ 경고: DB 데이터가 {days_gap}일 오래됨")
    # → 경고만 하고 계속 진행 (강제성 없음)
```

**문제점**:

1. **조건부 강제 초기화의 한계**:
   - 30일 이상 차이 나면 경고 + 초기화
   - 하지만 15~30일 차이는?
   - → 조용히 진행되어 부실한 데이터 누적 가능

2. **수집된 데이터의 최종 검증 부재**:
   ```python
   # Line 287-300: 수집 후 검증
   if freshness_gap > 5:
       print(f"⚠️ 경고: 수집된 최신 데이터({max_date})가 기준일({trading_date})보다 {freshness_gap}일 오래됨")
       return False  # ← 조기 반환하지만,
   
   # → 만약 일부 종목만 신선도 낮으면?
   # → 혼합 데이터 반환
   ```

3. **종목별 신선도 편차 미추적**:
   ```python
   # 현재: 전체 date_range_found로만 검증
   min_date = min(date_range_found)  # e.g., 2026-05-14
   max_date = max(date_range_found)  # e.g., 2026-05-15
   
   # 문제: 종목 A는 5개 봉, 종목 B는 10개 봉 수집
   # → 종목 B의 지표는 신뢰도 높지만 종목 A는?
   ```

**버그 시나리오**:
```
배치 실행: 2026-05-16 18:00 (KST)
- 삼성전자: 2026-05-01 ~ 2026-05-15 (수집됨, 13봉)
- SK하이닉스: 2026-05-01 ~ 2026-05-08 (API 실패, 8봉)

결과:
- freshness_gap = 1일 ← OK로 판단
- 하지만 SK하이닉스는 7일 오래된 데이터 포함
- 지표 계산(RSI, SMA200) 불신뢰
```

---

### 1.4 ⚠️ null/NaN 처리 로직의 부분적 보호

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L55-75)

**현재 구현**:
```python
def safe_float(x, default=0.0):
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except:
        return default

def safe_int(x, default=0):
    try:
        v = float(x)
        if np.isnan(v) or np.isinf(v):
            return default
        return int(v)
    except:
        return default
```

**보호 범위**:
- ✅ OHLCV 데이터 (line 228): `safe_int(row.get("거래량", 0))`
- ✅ 지표 계산 (line 413-414): `n()`, `n_int()` 함수
- ❌ 섹터 등락률 (line 530-535): **직접 float() 호출**
  ```python
  t_price, p_price = today_map[ticker], prev_map[ticker]
  if p_price > 0:
      change = (t_price - p_price) / p_price * 100  # ← NaN 검증 없음
  ```
- ❌ 섹터 점수 (line 781-795): **계산식에서 NaN 전파 가능**
  ```python
  avg_change = sum(agg["changes"]) / len(agg["changes"])  # 0 나누기 방어 있지만
  ret_5d = (closes[-1] - closes[-5]) / closes[-5]  # ← None 체크 없음
  ```

**발생 가능한 버그**:

1. **섹터 평균 등락률이 inf/nan이 되는 경우**:
   ```python
   # Line 530-535
   changes = sector_changes.get(sid, [])
   avg_change = sum(changes) / len(changes) if changes else 0.0
   
   # 하지만 changes 리스트에 inf 또는 nan이 포함되면?
   changes = [0.05, np.inf, -0.02]
   avg_change = np.inf  # ← 섹터점수에 inf 저장됨
   ```

2. **점수 계산에서 inf 값 전파**:
   ```python
   # Line 1049-1050
   momentum_score = min(100, max(0, int(momentum_score)))
   # int(np.inf) → overflow
   ```

**필요한 수정**:
```python
# Line 530-535 수정
avg_change = None
if changes:
    clean_changes = [c for c in changes if np.isfinite(c)]
    if clean_changes:
        avg_change = sum(clean_changes) / len(clean_changes)
    else:
        avg_change = 0.0
else:
    avg_change = 0.0
```

---

## 2. API 및 네트워크 안정성 문제

### 2.1 🔴 fetchRealtimePriceBatch의 silent failure 위험

**심각도**: 🔴 HIGH

**파일**: [src/utils/fetchRealtimePrice.ts](src/utils/fetchRealtimePrice.ts#L115-160)

**코드 분석**:
```typescript
export async function fetchRealtimePriceBatch(
  codes: string[]
): Promise<Record<string, RealtimeStockData>> {
  const result: Record<string, RealtimeStockData> = {};
  const uniqueCodes = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  const chunkSize = 20;
  
  for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
    const chunk = uniqueCodes.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(
      chunk.map(async (code) => {
        const data = await fetchRealtimeStockData(code);
        if (data) result[code] = data;  // ← 조용히 무시
      })
    );

    for (const item of settled) {
      if (item.status === "rejected") {
        console.error("실시간 배치 조회 실패:", item.reason);  // ← 로그만 남김
      }
    }
  }
  return result;  // ← 부분 성공도 전체 성공으로 반환
}
```

**문제점**:

1. **타임아웃 무시**:
   ```typescript
   // src/utils/fetchRealtimePrice.ts:50-70
   const FETCH_TIMEOUT_MS = 2500;
   
   async function fetchRealtimeStockData(code: string): Promise<RealtimeStockData | null> {
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
     
     try {
       const response = await fetch(...);
       // timeout 시 AbortError 발생 → catch에서 null 반환
       return null;  // ← 조용하게 null
     } catch (e) {
       console.error(...);  // ← 로그만 남김
       return null;
     }
   }
   ```
   
   **결과**:
   - 10개 종목 조회 중 1개 타임아웃 → 9개만 반환
   - 호출 측에서 알 수 없음 (캐시처럼 저장될 수 있음)

2. **재시도 로직 부재**:
   - 첫 시도 실패 = 최종 실패
   - 네트워크 지연(예: 2.3초)으로 타임아웃 가능

3. **부분 데이터의 사용**:
   ```typescript
   // handlers/ui/positions.ts:147
   const realtimePriceMap = codes.length > 0
     ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, RealtimeStockData>))
     : {}
   
   // 10개 코드 요청, 7개만 반환되었는데:
   // "7개는 실시간 가격, 3개는 close 데이터" → 혼합 사용
   ```

**발생 가능한 버그 시나리오**:

```
시간: 2026-05-16 15:00 (장 중)
사용자 액션: /보유 명령 (포트폴리오 조회)
- 요청 코드: [005930, 000660, 035720, 017670, 069500] (5개)
- API 상태: Naver m.stock.naver.com API 느림 (평균 응답 3초)
- fetchRealtimePriceBatch 동작:
  1. 005930 → 2.1초 ✓ (반환)
  2. 000660 → 2.8초 ✗ (TIMEOUT 2.5초 초과, null)
  3. 035720 → 2.2초 ✓ (반환)
  4. 017670 → 3.1초 ✗ (TIMEOUT, null)
  5. 069500 → 2.0초 ✓ (반환)

결과:
- realtimePriceMap = {005930: {...}, 035720: {...}, 069500: {...}}
- handlers/ui/positions.ts에서 손익 계산:
  - 005930: 실시간가 (현재 가격)
  - 000660: 실시간가 없음 → DB close (어제 종가?) 사용
  - 035720: 실시간가 (현재 가격)
  - 017670: DB close (어제 종가?) 사용  ← 손익 계산 오류!
  - 069500: 실시간가 (현재 가격)

사용자가 보는 화면:
  손익률: [+2.3%, -1.5%, +0.8%, +5.2%, -0.3%] (혼합 데이터)
  실제로는:
  손익률: [+2.3%, -0.2%, +0.8%, +1.8%, -0.3%] (실시간 기준)
```

---

### 2.2 🟠 API 응답 검증 부재

**심각도**: 🟠 MEDIUM

**파일**: [src/utils/fetchMarketData.ts](src/utils/fetchMarketData.ts#L100-160)

**코드 분석**:
```typescript
async function fetchYahoo(
  symbol: string,
  label: string
): Promise<MarketIndex | null> {
  const fetchedAt = new Date().toISOString();
  const enc = encodeURIComponent(symbol);
  const body = await fetchJsonWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=1d&interval=1d`
  );
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice || 0;        // ← 0이 유효한 값인가?
  const prev = meta.chartPreviousClose || meta.previousClose || price;
  return {
    name: label,
    price,                                            // ← 0일 수 있음
    change: +(price - prev).toFixed(2),
    changeRate: prev
      ? +(((price - prev) / prev) * 100).toFixed(2)
      : 0,
    source: "yahoo",
    fetchedAt,
  };
}
```

**문제점**:

1. **0이 유효한 값인지 검증 안 함**:
   ```typescript
   const price = meta.regularMarketPrice || 0;
   // 만약 API가 "{regularMarketPrice: null}" 반환?
   // → price = 0으로 처리
   ```

2. **필수 필드 부재 검증**:
   ```typescript
   const meta = body?.chart?.result?.[0]?.meta;
   if (!meta) return null;  // ← 구조 없으면 null
   
   // 하지만 meta.regularMarketPrice가 없으면?
   // → 조용히 0으로 처리 (valid price처럼)
   ```

3. **부분 API 응답 처리**:
   ```typescript
   // handlers/ui/market-overview.ts
   export async function fetchAllMarketData(): Promise<MarketOverview> {
     const [kospi, kosdaq, usdkrw, vix, ...] = await Promise.all([...]);
     
     return withOverviewMeta({
       kospi: kospi ?? undefined,  // ← null이면 undefined
       ...
     });
   }
   
   // 결과: 14개 지수 중 5개만 조회 성공해도 반환
   // meta.isPartial = true로 표시하지만, 호출 측이 무시할 수 있음
   ```

**발생 가능한 버그**:

```
시간: 2026-05-16 09:00 (NYSE 오픈 전)
fetchVIX() 호출:
- Yahoo API: "{...regularMarketPrice: null, ...}"
- fetchYahoo() 반환: {name: "VIX", price: 0, change: 0, changeRate: 0, ...}

결과:
- marketOverview.vix = {price: 0, ...}
- briefingService에서 사용:
  if (vix.price > 25) { /* 공포 모드 */ }  ← 0 < 25이므로 공포 모드 미작동
- 사용자가 받는 브리핑이 시장 공포를 반영 못함
```

---

### 2.3 🟠 DB upsert 실패 시 재시도 로직의 한계

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L310-330)

**코드 분석**:
```python
def _flush_stock_daily(rows: list):
    for i in range(0, len(rows), 500):
        try:
            supabase.table("stock_daily").upsert(rows[i:i+500]).execute()
        except Exception as e:
            print(f"    ⚠️ stock_daily upsert 에러: {e}")
            # 재시도? NO!
            chunk = rows[i:i+500]
            for j in range(0, len(chunk), 50):
                try:
                    supabase.table("stock_daily").upsert(chunk[j:j+50]).execute()
                except:
                    pass  # ← 조용히 무시
```

**문제점**:

1. **지수 백오프 없음**:
   - 500개 배치 실패 → 즉시 50개 재시도
   - DB 락(lock) 상태면 50개도 실패
   - → 데이터 손실 가능

2. **재시도 횟수 제한 없음**:
   ```python
   for j in range(0, len(chunk), 50):
       try:
           supabase.table("stock_daily").upsert(chunk[j:j+50]).execute()
       except:
           pass  # ← 1회 재시도만 하고 실패 무시
   ```

3. **실패 원인 분류 부재**:
   - 네트워크 에러? → 재시도 가능
   - 스키마 에러? → 재시도 불가
   - 서버 과부하? → 백오프 필요
   - → 모두 동일하게 처리

4. **누적 실패 추적 부재**:
   ```python
   fail = 0
   ...
   if fail <= 5:
       print(f"    ⚠️ {code} ({name}): {e}")  # ← 처음 5개만 로그
   
   # 만약 200개 종목 중 150개가 upsert 실패?
   # → 처음 5개만 로그, 나머지는 침묵
   ```

**발생 가능한 버그 시나리오**:

```
배치 실행: 2026-05-16 18:30
대상: stock_daily 1,500개 행 (200개 종목 × 7.5일 = 1,500 rows)

상황: Supabase 연결 풀 고갈
- 대기: 1.2초
- FETCH_TIMEOUT_MS = 3000ms → 타임아웃 직전에 연결 반환

결과:
- 500행 배치 1: 1.2초 + 2.8초 처리 = 4초 (TIMEOUT 아슬아슬)
- 500행 배치 2: TIMEOUT 발생 → except 블록
  - 50행씩 재시도 (10회)
  - 즉시 재시도 (백오프 없음) → 대기 늘어남
  - 3번째 50행부터 모두 실패
  - → 150행 손실

최종 결과:
- stock_daily: 1,350행 저장 (150행 손실)
- 누락된 종목들이 지표 계산 단계에서 제외
- 점수 계산에서 빠짐
```

---

## 3. 데이터 품질 문제

### 3.1 🟠 지표 계산에서 NaN/Inf 값 처리 미흡

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L350-450)

**코드 분석**:
```python
def calculate_indicators(trading_date: str):
    ...
    def n(v):
        try:
            fv = float(v)
            return None if (pd.isna(fv) or np.isinf(fv)) else round(fv, 4)
        except:
            return None
    
    for ticker in target_tickers:
        df = pd.DataFrame(h_res.data)
        df["close"] = df["close"].astype(float)
        
        # RSI 계산
        df["rsi14"] = calculate_rsi(close, 14)  # ← NaN이 될 수 있음
        
        # ROC 계산
        df["roc14"] = close.pct_change(14) * 100  # ← nan이 될 수 있음
        
        # SMA 계산
        df["sma20"] = close.rolling(20).mean()  # ← NaN이 될 수 있음
        
        # AVWAP 계산
        avwap_val = calculate_avwap(...)  # ← try/except는 있지만
        
        last = df.iloc[-1]
        upsert_buffer.append({
            "code": ticker,
            "rsi14": n(last.get("rsi14")),  # ← n() 함수로 검증
            "roc14": n(last.get("roc14")),
            "sma20": n(last.get("sma20")),
            "avwap_breakout": n(avwap_val) if avwap_val else None,  # ← None 처리
        })
```

**보호 수준**: ✅ 지표 저장 단계에서 n()/n_int()로 검증

**하지만 문제**:

1. **중간 계산 단계의 NaN 전파**:
   ```python
   # Line 410: RSI 계산
   df["rsi14"] = calculate_rsi(close, 14)
   
   # 만약 close에 0이나 음수가 포함?
   # calculate_rsi 내부에서 NaN 생성 가능
   # → df["rsi14"] = [nan, nan, ..., 45.3] (처음 13개는 nan)
   ```

2. **점수 계산에서의 NaN 처리 부실**:
   ```python
   # scripts/daily_batch.py:1018-1022
   rsi = safe_float(ind.get("rsi14"), 50)  # ← default=50
   
   # 문제: rsi14가 None이면 50점 자동 부여
   # 실제로는 계산 불가이므로 제외해야 함
   ```

3. **ROC 음수 처리 미흡**:
   ```python
   # Line 1047-1050
   if roc14 > 0:
       momentum_score += min(15, roc14 * 3)
   
   # 만약 roc14 = nan?
   # → safe_float() = 0 (default)
   # → 모멘텀 스코어에 영향 없음 (의도한 건가?)
   ```

---

### 3.2 🟠 점수 계산에서 outlier 처리 부재

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L1000-1080)

**코드 분석**:
```python
def calculate_stock_scores(trading_date: str):
    ...
    for s in all_stocks:
        value_score = 50  # ← 기본값
        if s.get("universe_level") == "core":
            value_score += 15  # ← 65점
        
        rsi = safe_float(ind.get("rsi14"), 50)  # ← 50~100 정도
        roc14 = safe_float(ind.get("roc14"))     # ← -200%부터 +200%?
        roc21 = safe_float(ind.get("roc21"))     # ← 같음
        
        # 모멘텀 점수
        momentum_score = 30
        if 45 <= rsi <= 65:
            momentum_score += 20
        elif 35 <= rsi <= 70:
            momentum_score += 10
        
        # ROC 추가 점수
        if roc14 > 0:
            momentum_score += min(15, roc14 * 3)  # ← roc14 = 150%면? 450점?
        
        # 최종 합산
        total_score = min(100, max(0, int(round(
            value_score * 0.3 + momentum_score * 0.45 + liquidity_score * 0.25
        ))))
```

**문제점**:

1. **ROC 값의 극단값 미보호**:
   ```python
   if roc14 > 0:
       momentum_score += min(15, roc14 * 3)
   
   # 만약 roc14 = 1000% (급등주)?
   # → momentum_score += min(15, 3000) = 15
   # → OK (min으로 제한)
   
   # 만약 momentum_score = 80이고:
   # → 0.3*65 + 0.45*80 + 0.25*90 = 77.5점
   # 
   # 하지만 계산에 min()이 없으면?
   # → overflow 가능
   ```

2. **거래대금 급등/급락 미처리**:
   ```python
   # Line 1065-1072
   liquidity_score = 30
   if value_traded > 50_000_000_000:
       liquidity_score = 90
   elif value_traded > 10_000_000_000:
       liquidity_score = 70
   
   # 문제: 1일 거래대금이 급락한 경우?
   # 만약 value_traded = 1_000_000 (아주 적음)
   # → liquidity_score = 30 (기본값)
   # 
   # 실제로는 거래 중단되거나 상장폐지 위험?
   # → 점수를 낮춰야 함
   ```

3. **가격 급락/급등 후 신호 문제**:
   ```python
   # 예: 종목이 전날 대비 -50% 급락
   # roc14 = -50%
   # momentum_score 계산:
   # if roc14 > 0: momentum_score += ...
   # else: (음수이므로 추가 점수 없음)
   # 
   # 결과: momentum_score = 30 (기본값)
   # → 점수가 낮지만, 급락의 심각성 반영 안 됨
   ```

**발생 가능한 버그**:

```
2026-05-16 배치 실행
종목: 카카오 (039130)

당일 데이터:
- close: 67,000원 (어제 80,000원)
- roc14: -16.25%
- rsi14: 28 (과매도)
- value_traded: 850억원 (정상)

점수 계산:
- value_score: 65 (core 종목)
- momentum_score:
  - 기본: 30
  - rsi 28 < 35: +0 (조건 미만족)
  - roc14 < 0: +0
  - 결과: 30점
- liquidity_score: 90 (거래대금 큼)

total_score = 0.3*65 + 0.45*30 + 0.25*90 = 19.5 + 13.5 + 22.5 = 55.5 ≈ 56점 (HOLD)

⚠️ 문제:
- RSI 28은 과매도 신호인데 추가 점수 없음
- 사실은 단기 반등 기회인데 HOLD 신호만 줌
- 급락의 원인(악재?) 분석 없음
```

---

### 3.3 🔴 데이터 정규화(Normalization) 완전 부재

**심각도**: 🔴 HIGH

**파일**: 해당 없음 (구현 없음)

**현재 상황**:

1. **지표별 스케일 다양함**:
   ```python
   # scripts/daily_batch.py에서:
   rsi14: 0~100
   roc14: -200% ~ +200% (또는 -20000 ~ +20000 범위?)
   sma20, sma50, sma200: 절대가격 (종목마다 다름)
   volume: 절대값 (종목마다 크게 다름)
   ```

2. **점수 계산에서의 불공정성**:
   ```python
   # Line 1047-1050
   if roc14 > 0:
       momentum_score += min(15, roc14 * 3)
   
   # 예 1: 저가주 (1,000원)
   # - 당일 1% 상승: roc14 = 1%
   # - 추가점수: min(15, 1*3) = 3점
   
   # 예 2: 고가주 (100,000원)
   # - 당일 1% 상승: roc14 = 1% (같음)
   # - 추가점수: min(15, 1*3) = 3점 (같음)
   
   # ✅ ROC는 %이므로 공정
   # 하지만 다른 지표는?
   ```

3. **섹터별 점수의 비교 불가**:
   ```python
   # scripts/daily_batch.py:750-800
   flow_score = min(30, max(0, flow_total * 0.5))
   momentum_score = min(40, max(0, (change_rate + 3) * 6.67))
   
   # 문제: change_rate가 -10%라면?
   # momentum_score = min(40, max(0, (-10 + 3) * 6.67))
   #                = min(40, max(0, -46.7))
   #                = min(40, 0) = 0
   
   # 하지만 change_rate가 +3%라면?
   # momentum_score = min(40, max(0, (3 + 3) * 6.67))
   #                = min(40, 40) = 40
   
   # → 6.67의 계수는 임의적 (왜 6.67? 근거 없음)
   ```

4. **시장 환경별 스케일 조정 부재**:
   ```python
   # 강세장: 모든 종목의 ROC > 0
   # 약세장: 모든 종목의 ROC < 0
   
   # 현재 점수 공식은 절대값 기준이므로:
   # - 강세장: 모든 종목이 고점수
   # - 약세장: 모든 종목이 저점수
   
   # → 상대적 순위가 아닌 절대 점수를 제시
   # → 시장 국면별 해석이 어려움
   ```

---

## 4. 성능 및 타이밍 문제

### 4.1 🟠 배치 전체 실행 시간 추적 부재

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L1200-1240)

**코드 분석**:
```python
if __name__ == "__main__":
    print(f"🚀 Daily Batch Start: {datetime.now().isoformat()}")
    # → 시작 시각만 출력
    
    ...
    
    print(f"\n🏁 Daily Batch End: {datetime.now().isoformat()}")
    # → 종료 시각만 출력
```

**현재 상황**:
- ✅ 시작/종료 시각은 로그에 기록
- ❌ 단계별 실행 시간 계산 없음
- ❌ 각 단계의 지연 감지 불가
- ❌ 성능 저하 원인 파악 어려움

**필요한 정보**:
```
🚀 Daily Batch Start: 2026-05-16T18:30:00
  [1/6] OHLCV 수집... (시작 18:30:05)
  [1/6] OHLCV 수집 완료: 200개 종목, 1,500행 저장 (끝 18:35:45) ← 5분 40초
  
  [2/6] 기술적 지표 계산... (시작 18:35:50)
  [2/6] 지표 계산 완료: 200개 종목 (끝 18:38:10) ← 2분 20초
  
  [3/6] 섹터 등락률 집계... (시작 18:38:15)
  [3/6] 섹터 데이터 완료 (끝 18:38:25) ← 10초
  
  [3.5/6] sector_daily 시계열... (시작 18:38:30)
  [3.5/6] sector_daily 완료 (끝 18:40:15) ← 1분 45초
  
  [4/6] 섹터 점수 계산... (시작 18:40:20)
  [4/6] 섹터 점수 완료 (끝 18:40:35) ← 15초
  
  [5/7] 종목 점수 계산... (시작 18:40:40)
  [5/7] 종목 점수 완료 (끝 18:45:20) ← 4분 40초
  
  [6/7] 눌림목 신호 계산... (시작 18:45:25)
  [6/7] 신호 계산 완료 (끝 18:48:30) ← 3분 5초
  
🏁 Daily Batch End: 2026-05-16T18:48:35
⏱️ 총 소요 시간: 18분 35초
  - OHLCV: 5분 40초 (30%)
  - 지표: 2분 20초 (13%)
  - 섹터데이터: 10초 (1%)
  - sector_daily: 1분 45초 (9%)
  - 섹터점수: 15초 (1%)
  - 종목점수: 4분 40초 (25%)
  - 신호: 3분 5초 (17%)
  - 정리: 5초 (0%)
```

**문제의 영향**:
1. **SLA 위반 감지 못함**:
   - 배치가 18:00~21:00에 완료되어야 한다면?
   - 현재 18분 걸리면 → 21:00까지 40분 여유
   - 만약 DB 느려서 45분 걸리면? → 초과 통보 안 됨

2. **병목 구간 분석 불가**:
   - OHLCV 수집이 느린가? 지표 계산이 느린가?
   - → 로그만으로 확인 불가 (시작/종료만 있음)

3. **점진적 성능 저하 감지 못함**:
   - 1달 전: 12분 소요
   - 현재: 18분 소요
   - → 6분 악화 (50% 증가)
   - → 로그 분석으로도 모름

---

### 4.2 🟠 개별 단계별 성능 로깅 미흡

**심각도**: 🟠 MEDIUM

**파일**: [scripts/daily_batch.py](scripts/daily_batch.py#L200-350)

**현재 로깅 수준**:

```python
# Line 235
print(f"\n[1/6] OHLCV 수집 (개별 종목 API, 기준일: {trading_date})...")

# 대상 종목 수만 출력
print(f"  대상: {len(tickers)}개 종목")

# 진행률 표시
if idx % 50 == 0 and idx > 0:
    print(f"  -> 진행: {idx}/{len(tickers)} (성공: {success}, 실패: {fail})")

# 완료 로그
print(f"  ✅ OHLCV 수집 완료: {success}개 성공, {fail}개 실패")
```

**부족한 정보**:
- ❌ 각 단계의 정확한 시간 (시작/종료 시각)
- ❌ 종목당 평균 조회 시간
- ❌ API 호출 횟수 vs 실제 저장 행 수
- ❌ 메모리 사용량
- ❌ DB upsert 병목

**필요한 메트릭**:
```python
import time
start_time = time.time()

# 단계별 추적
print(f"[1/6] OHLCV 수집 (시작: {datetime.now().strftime('%H:%M:%S')})")

# 진행률과 함께 ETA 표시
if idx % 50 == 0 and idx > 0:
    elapsed = time.time() - step_start_time
    per_item = elapsed / idx
    remaining = (len(tickers) - idx) * per_item
    eta = datetime.now() + timedelta(seconds=remaining)
    print(f"  -> 진행: {idx}/{len(tickers)} ({elapsed:.1f}초, ETA: {eta.strftime('%H:%M:%S')})")

elapsed = time.time() - start_time
print(f"  ✅ OHLCV 수집 완료: {success}개 성공, {fail}개 실패 ({elapsed:.1f}초)")
```

---

## 5. 캐시 및 동시성 문제

### 5.1 🟠 포지션 UI의 실시간 가격 캐시와 DB close 데이터 sync 문제

**심각도**: 🟠 MEDIUM

**파일**: [handlers/ui/positions.ts](handlers/ui/positions.ts#L140-160)

**코드 분석**:
```typescript
// Line 105: 포지션 데이터 조회
const { data, error, count } = await base.range(from, to)

// Line 147-148: 실시간 가격 일괄 조회
const realtimePriceMap = codes.length > 0
  ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, RealtimeStockData>))
  : {}

// Line 150+: close 데이터 조회
const { data: latestScoreRows } = await supabase
  .from('scores')
  .select('asof')
  .order('asof', { ascending: false })
  .limit(1)

const { data: scoreRows } = await supabase
  .from('scores')
  .select('code, total_score, signal')
  .eq('asof', latestAsof)
  .in('code', codes)

// Line 200+: 손익 계산
// realtimePriceMap[code].price vs data[i].stock.close
```

**문제점**:

1. **데이터 시간 기준 불일치**:
   ```typescript
   // scores.asof = 2026-05-15 (어제 종가 기준)
   // realtimePrice = 2026-05-16 15:00 (오늘 장 중)
   
   // 손익 계산:
   // pnl% = (실시간가 - 매수가) / 매수가
   // = (현재가 - 어제 종가) / 매수가  ← 실시간가 기준인가 어제 종가 기준인가?
   ```

2. **실시간 데이터 부분 실패 시**:
   ```typescript
   // 5개 종목 요청: [A, B, C, D, E]
   // 실시간가 조회 성공: [A, C, E]
   // 실패: [B, D]
   
   // 손익 계산:
   // A: 실시간가 (현재)
   // B: scores.close (어제) ← 혼합!
   // C: 실시간가 (현재)
   // D: scores.close (어제) ← 혼합!
   // E: 실시간가 (현재)
   ```

3. **캐시 TTL과의 불일치**:
   ```typescript
   // Line 6
   const POSITIONS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_POSITIONS_CACHE_TTL_MS || 8_000))
   
   // 8초 캐시
   // 만약 포트폴리오 캐시는 8초인데, 실시간가 조회 타임아웃은 2.5초?
   // → 캐시 된 응답은 5초 오래된 close 데이터 + 2초 오래된 가격
   ```

**발생 가능한 버그 시나리오**:

```
사용자: /보유 명령
시간: 2026-05-16 15:00 (장 중)

포지션:
- 삼성전자 (005930): 매수가 70,000원, 수량 10주
- SK하이닉스 (000660): 매수가 100,000원, 수량 5주
- 현대자동차 (005380): 매수가 180,000원, 수량 3주

실행:
1. positions 조회:
   - 005930: close = 69,500 (어제 종가, scores.asof = 2026-05-15)
   - 000660: close = 100,000 (어제 종가)
   - 005380: close = 180,000 (어제 종가)

2. 실시간가 조회 (fetchRealtimePriceBatch):
   - 005930: 가격 71,200원 (현재, 1초 전) ✓
   - 000660: 조회 실패 (타임아웃)
   - 005380: 가격 182,000원 (현재, 0.5초 전) ✓

3. 손익 계산:
   - 005930: 71,200원 기준
     손익 = (71,200 - 70,000) × 10 = 12,000원 (+1.7%)
   
   - 000660: close 100,000원 기준 (실제 현재가는 101,500원?)
     손익 = (100,000 - 100,000) × 5 = 0원 (0%)
     ⚠️ 실제 손익은 +7,500원일 수 있음
   
   - 005380: 182,000원 기준
     손익 = (182,000 - 180,000) × 3 = 6,000원 (+1.1%)

사용자가 보는 포트폴리오:
  손익: +18,000원 (+0.9%)

실제 손익:
  +25,500원 (+1.2%)
  
⚠️ 왜곡된 수익률 표시 → 포트폴리오 모니터링 신뢰도 ↓
```

---

### 5.2 🟠 여러 요청에서 동시에 같은 데이터 조회 시 일관성 문제

**심각도**: 🟠 MEDIUM

**파일**: [handlers/ui/stock-latest.ts](handlers/ui/stock-latest.ts#L1-100)

**현재 상황**:

1. **DB 조회 시점의 차이**:
   ```typescript
   // 사용자 A: /종목분석 삼성전자
   // 시간: 2026-05-16 15:00:00
   // 조회된 close: 71,100원
   
   // 동시에
   // 사용자 B: /보유
   // 시간: 2026-05-16 15:00:01
   // 조회된 close: 71,200원 (1초 후 갱신)
   
   // → 같은 종목인데 다른 가격 표시!
   ```

2. **배치 갱신 중 조회**:
   ```typescript
   // 18:35 배치 시작: stock_daily 저장
   // 18:35:10: stocks.close 동기화 시작
   // 18:35:15: 사용자가 /보유 조회
   // → 일부는 새 close, 일부는 구 close
   ```

3. **스냅샷 격리 부재**:
   ```typescript
   // 현재: 각 조회가 독립적으로 진행
   // 
   // 더 나은 방식:
   // 1. 단일 타임스탠프(asof) 결정
   // 2. 모든 테이블 조회는 그 시점 기준
   // 3. 응답에 asof 포함
   ```

---

## 6. 정리 및 우선순위

### 6.1 시급성 순서

| 순위 | 문제 | 심각도 | 해결 시간 |
|------|------|--------|----------|
| 1 | investor_daily 수집 누락 | 🔴 | 2시간 |
| 2 | 데이터 정규화 부재 | 🔴 | 4시간 |
| 3 | fetchRealtimePriceBatch 재시도 로직 | 🔴 | 1시간 |
| 4 | 섹터 데이터 동기화 일관성 | 🟠 | 3시간 |
| 5 | NaN/Inf outlier 처리 | 🟠 | 2시간 |
| 6 | API 응답 검증 강화 | 🟠 | 1.5시간 |
| 7 | 배치 시간 추적 메트릭 | 🟠 | 1시간 |
| 8 | 캐시 및 동시성 개선 | 🟠 | 3시간 |

### 6.2 클러스터링

**CLUSTER A: 데이터 수집 (1일)**
- investor_daily 수집 추가
- 섹터 매핑 일관성 검증
- 신선도 검증 강화

**CLUSTER B: 데이터 품질 (반나절)**
- NaN/Inf/outlier 처리
- 정규화 구현 (Z-score 또는 MinMax)
- 점수 공식 재검토

**CLUSTER C: 안정성 (4시간)**
- 실시간가 재시도 + 백오프
- API 응답 검증
- DB upsert 지수 백오프

**CLUSTER D: 운영성 (2시간)**
- 배치 시간 추적
- 성능 메트릭 로깅
- 에러 누적 추적

---

## 7. 체크리스트

### 즉시 확인 항목
- [ ] `scripts/daily_batch.py` 배치 마지막 실행 로그 확인 (investor_daily 언급?)
- [ ] Supabase `investor_daily` 테이블 최신 데이터 날짜 확인
- [ ] `stock_daily` vs `sectors` 매핑 불일치 수 집계 (쿼리 실행)
- [ ] 최근 1주일 배치 실행 시간 분포 확인
- [ ] 실시간 가격 조회 성공률 모니터링

### 검증 필요 스크립트
```sql
-- investor_daily 최신 데이터 확인
SELECT MAX(date) as latest_date, COUNT(*) as row_count
FROM investor_daily;

-- sector_id와 ticker 불일치
SELECT DISTINCT sd.ticker
FROM stock_daily sd
WHERE NOT EXISTS (
  SELECT 1 FROM stocks s WHERE s.code = sd.ticker AND s.is_active = true
)
LIMIT 20;

-- close 데이터 신선도
SELECT code, MAX(close_date) as latest_close
FROM stocks
GROUP BY code
ORDER BY latest_close;
```

---

**최종 권고**: CLUSTER A 부터 순차적으로 처리. Cluster A 완료 후 테스트 -> Cluster B 진행
