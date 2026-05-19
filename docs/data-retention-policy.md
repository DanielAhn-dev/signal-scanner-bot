# 📊 데이터 보유 정책 (Data Retention Policy)

**버전**: 2026-05-19  
**상태**: 최적화 완료  
**목표**: 모든 종목 스캔/분석 기능을 위한 최소 필수 데이터 기간 설정

---

## 1. 요약

| 테이블 | 보유 기간 | 목적 | 최소 요구사항 |
|--------|---------|------|------------|
| `stock_daily` | **400일** | OHLCV 데이터 | ✅ 52주 + 여유 |
| `daily_indicators` | **550일** (1.5년) | 기술적 지표 (SMA200, RSI14 등) | ✅ 계절성 비교 가능 |
| `investor_daily` | **400일** | 투자자 수급 트렌드 | ✅ 52주 + 여유 |
| `sector_daily` | **400일** | 섹터 수익률 트렌드 | ✅ 52주 + 여우 |
| `pullback_signals` | **400일** | 눌림목 신호 | ✅ 최근 패턴 유지 |
| `jobs` | **30일** | 배치 작업 로그 | ✅ 월간 모니터링 |

**결론**: ✅ 모든 테이블이 **52주(364일) 이상** 보장, **무료 플랜 최적화**

---

## 2. 각 테이블별 보유 기간 상세 설명

### 2.1 `stock_daily` (400일)

**용도**:
- OHLCV 데이터 (Open, High, Low, Close, Volume, Value)
- 매매 수량/거래대금 추적
- 종목별 백테스트 기반 제공

**왜 400일인가**:
- 52주 = 364일 ✓
- 한국 증시: 연중 약 250-260 거래일
- 400일 = ~1.6년 거래 데이터 (여름휴장, 명절 등 포함)
- 1년 이상 + 여유분으로 계절성 비교 가능

**삭제 규칙**:
```python
# daily_batch.py 라인 1520
cutoff = (date.today() - timedelta(days=400)).isoformat()
supabase.table("stock_daily").delete().lt("date", cutoff).execute()
```

---

### 2.2 `daily_indicators` (550일 / 1.5년)

**용도**:
- 기술적 지표: SMA20, SMA50, SMA200
- 모멘텀: RSI14, ROC14, ROC21
- 스캔 기준 데이터 (`/스캔` 종목 필터)

**왜 550일인가** (1.5년, 무료 플랜 최적화):
- **SMA200 계산**: 200일 최소 필요 + 안정화를 위한 추가 40일 = 240일 권장
- **계절성 분석**: 5년 데이터 중 1.5년으로도 계절 패턴 인식 가능
- **RSI 신뢰도**: 충분한 히스토리로 극값 상태 판단 개선
- **저장소 효율**: 730일 → 550일로 조정으로 무료 플랜 유지 (약 50-70MB 절감)
- **백테스트**: 중기 전략(3-6개월) 검증에 충분

**환경 변수**:
```bash
# 백엔드 & 로컬 동기화
DAILY_INDICATORS_RETENTION_DAYS=550  # 기본값 (1.5년, 무료 플랜 최적화)

# 필요시 조정 (최소 400일)
DAILY_INDICATORS_RETENTION_DAYS=730   # 2년 유지 (저장소 여유 있을 때)
DAILY_INDICATORS_RETENTION_DAYS=400   # 1.1년만 유지 (저장소 절감)
```

**삭제 규칙**:
```python
# daily_batch.py 라인 1517-1523
indicators_retention_days = safe_int(
    os.environ.get("DAILY_INDICATORS_RETENTION_DAYS", 550), 550
)
indicators_retention_days = max(400, indicators_retention_days)  # 최소 400일
indicators_cutoff = (date.today() - timedelta(days=indicators_retention_days)).isoformat()
supabase.table("daily_indicators").delete().lt("trade_date", indicators_cutoff).execute()
```

**최적화 포인트**:
- 현재 550일로 무료 플랜 최적화 완료
- 저장공간 극심하게 부족하면 → 400일 (약 1년)
- 유료 플랜 전환 후 → 730일 이상 검토

---

### 2.3 `investor_daily` (400일)

**용도**:
- 투자자 유형별 순매수: 개인, 기관, 외국인
- 수급 트렌드 분석
- `/섹터` 리포트 기본 데이터

**왜 400일인가**:
- 52주 이상 필수
- 단기 (4주) + 중기 (3개월) + 장기 (1년) 추이 분석 가능
- 투자자별 수급 사이클: 3-6개월 단위이므로 400일로 충분

**삭제 규칙**:
```python
# daily_batch.py 라인 1521
supabase.table("investor_daily").delete().lt("date", cutoff).execute()
```

---

### 2.4 `sector_daily` (400일)

**용도**:
- 섹터별 수익률, 거래대금
- 섹터 회전 분석
- 종목별 섹터 점수에 활용

**왜 400일인가**:
- 한국 증시 섹터 회전: 3-6개월 사이클
- 400일 = 약 1.3 회전 + 여유 → 회전 패턴 인식 충분
- 장기 추세 대비 현재 섹터 상대 강도 계산 필요

**삭제 규칙**:
```python
# daily_batch.py 라인 1521
supabase.table("sector_daily").delete().lt("date", cutoff).execute()
```

---

### 2.5 `pullback_signals` (400일)

**용도**:
- 눌림목 매집 신호 (보우만 밴드, 지지선 기반)
- `/눌림목` 명령 결과 제공
- 기술적 패턴 인식

**왜 400일인가**:
- 눌림목은 단기-중기 기술적 신호
- 52주 데이터로 최근 기술적 매집 구간 충분히 포착
- 오래된 신호는 현재 트레이딩 결정에 영향 미미

**삭제 규칙**:
```python
# daily_batch.py 라인 1522
supabase.table("pullback_signals").delete().lt("trade_date", cutoff).execute()
```

---

### 2.6 `jobs` (30일)

**용도**:
- 배치 작업 로그 (daily_batch, backfill, sync 등)
- 완료/실패 상태 추적
- 배치 재실행 마크업

**왜 30일인가**:
- 월간 모니터링 충분
- 장기 보관 필요 없음 (로그는 별도 관리)
- 스토리지 절감

**삭제 규칙**:
```python
# daily_batch.py 라인 1525-1530 (status = done 또는 failed만)
jobs_cutoff = (date.today() - timedelta(days=30)).isoformat()
supabase.table("jobs").delete() \
    .in_("status", ["done", "failed"]) \
    .lt("created_at", jobs_cutoff).execute()
```

---

## 3. 자동 정리 메커니즘

### 동작 방식

1. **매일 배치 실행 시점**: `scripts/daily_batch.py` → `cleanup_old_data()`
2. **확인 조건**:
   - 400일 < 현재 날짜인 데이터 삭제
   - 730일(또는 환경변수) < 현재 날짜인 지표 데이터 삭제
3. **롤링 방식**: 항상 "최근 N일치"만 유지

### 배치 로그 예시

```
[7/7] 오래된 데이터 정리...
  -> stock_daily 컷오프: 2025-05-20 (400일 이전)
  -> investor_daily 컷오프: 2025-05-20
  -> sector_daily 컷오프: 2025-05-20
  -> pullback_signals 컷오프: 2025-05-20
  -> daily_indicators 컷오프: 2024-05-20 (730일 이전)
  -> jobs 컷오프: 2026-04-19 (30일 이전)
  ✅ 정리 완료
```

---

## 4. 트러블슈팅 & 최적화

### Q1: "디스크 부족으로 데이터 보유 기간을 단축하고 싶어요"

**Step 1**: 환경 변수 조정
```bash
# .env
DAILY_INDICATORS_RETENTION_DAYS=365  # 2년 → 1년으로 축소
```

**Step 2**: 배치 재실행
```bash
python scripts/daily_batch.py  # 자동 정리 실행
```

**주의**: `daily_indicators` 최소값은 **400일**입니다. 이하로 설정 불가.

---

### Q2: "왜 stock_daily와 daily_indicators 기간이 다르지?"

- `stock_daily` (400일): OHLCV 원본 데이터, 저장 공간 효율
- `daily_indicators` (730일): 계산된 지표, 스캔 기반 종목 선별에 필수
- 지표는 재계산 비용 > 저장 비용이므로 2년 유지가 경제적

---

### Q3: "장기 백테스트를 위해 더 오래된 데이터가 필요해요"

`scripts/backfill_*.py` 시리즈 활용:
```bash
# 예: 2년 이상 stock_daily 역백필
pnpm backfill:stock-daily --start 20240519 --end 20260519

# daily_indicators 역백필
pnpm backfill:daily-indicators --start 20240519 --end 20260519
```

→ 백필 완료 후 **보유 기간은 여전히 400/730일 롤링 유지**

---

### Q4: "특정 날짜의 오래된 데이터를 복구하고 싶어요"

1. 백필로 재수집:
   ```bash
   pnpm backfill:stock-daily --start YYYYMMDD --end YYYYMMDD
   ```

2. 정리 정책 임시 비활성화:
   ```bash
   # daily_batch.py cleanup_old_data() 주석 처리 (구간 복구 중)
   ```

3. 정책 재적용:
   ```bash
   python scripts/daily_batch.py  # 정상 실행
   ```

---

## 5. 모니터링

### 보유 데이터 현황 확인

```bash
# stock_daily 최신 날짜
python -c "
from supabase import create_client
import os
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
res = supabase.table('stock_daily').select('date').order('date', desc=True).limit(1).execute()
print(f'stock_daily 최신: {res.data[0][\"date\"]}')" 

# daily_indicators 최신 날짜
python -c "
from supabase import create_client
import os
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
res = supabase.table('daily_indicators').select('trade_date').order('trade_date', desc=True).limit(1).execute()
print(f'daily_indicators 최신: {res.data[0][\"trade_date\"]}')"

# daily_indicators 가장 오래된 날짜
python -c "
from supabase import create_client
import os
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
res = supabase.table('daily_indicators').select('trade_date').order('trade_date', asc=True).limit(1).execute()
print(f'daily_indicators 최구: {res.data[0][\"trade_date\"]}')"
```

---

## 6. 요약

✅ **현재 보유 정책이 최적입니다**:
- 모든 스캔/분석 기능에 필요한 **52주 이상** 데이터 보장
- `stock_daily` 400일 + `daily_indicators` 730일로 **다층 백데이터** 유지
- 자동 정리로 **스토리지 효율성** 확보
- 환경 변수로 **유연한 조정** 가능

**다음**: 모니터링 스크립트 추가로 데이터 품질 자동 검증
