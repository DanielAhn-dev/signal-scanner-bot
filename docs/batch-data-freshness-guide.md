# 📊 배치 데이터 신선도 관리 가이드

**문제**: 거래대금 데이터가 2025년 11월로 오래된 경우가 발생
**해결**: 자동 감시 및 복구 메커니즘 추가

---

## 1. 자동 데이터 신선도 검증 (개선됨)

### `get_last_trading_date()` 함수
- ✅ **60일까지 역추적** (이전: 8일)
- ✅ **4개 종목으로 검증** (이전: 1개)
  - 삼성전자(005930), NAVER(035420), 카카오(035720), SK하이닉스(000660)
- ✅ **최소 2개 이상 종목 거래 확인 시** 거래일로 판단

### `fetch_ohlcv_per_ticker()` 함수
- ✅ **자동 오래된 데이터 감지**
  - DB 최신 데이터가 기준일로부터 **30일 이상 차이** → 경고 + 자동 복구
  - 복구 방법: `stock_daily` 테이블 초기화 → 최근 180일 재수집
- ✅ **수집 완료 후 데이터 신선도 검증**
  - 실제 수집된 데이터 날짜 범위 확인
  - 최신 데이터가 기준일로부터 5일 이내인지 확인

---

## 2. 배치 실행 옵션

### 정상 실행
```bash
python scripts/daily_batch.py
```
- 최근 거래일 자동 감지
- DB 최신 데이터 확인
- 필요하면 자동 복구

### 특정 거래일 지정
```bash
python scripts/daily_batch.py --date 20260515
```
- 예: 2026년 5월 15일 기준으로 배치 실행
- 이전 부분 수집 데이터가 있어도 해당 날짜부터 시작

### 강제 DB 초기화 및 재수집 ⚠️
```bash
python scripts/daily_batch.py --reset-stock-data --date 20260515
```
- `stock_daily` 테이블 전체 삭제
- 최근 180일 데이터부터 재수집
- **긴 시간 소요** (400개 종목 × 180일)
- 사용 시기: 오래된 데이터가 쌓여있을 때, API 문제로 데이터가 손상되었을 때

### OHLCV 수집 스킵
```bash
python scripts/daily_batch.py --skip-ohlcv
```
- OHLCV 수집 생략
- 이미 수집된 데이터 기반으로 지표 계산부터 시작
- 사용 시기: 수집이 이미 완료되었거나, 계산만 재실행하고 싶을 때

---

## 3. 데이터 신선도 문제 해결

### 증상: "거래대금 데이터가 2025년 11월로 나온다"

**원인 분석**:
1. **pykrx API 응답 지연** → 오래된 데이터만 반환
2. **DB에 오래된 데이터가 있음** → 그것을 기준으로 계속 쌓임
3. **거래일 감지 실패** → 잘못된 날짜에서 시작

**해결 순서**:

#### Step 1: 현재 상태 확인
```bash
# DB의 stock_daily 최신 날짜 확인
python -c "
from supabase import create_client
import os
os.environ.get('SUPABASE_URL')
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
res = supabase.table('stock_daily').select('date').order('date', desc=True).limit(1).execute()
print(f'DB 최신: {res.data[0][\"date\"]}')
"
```

#### Step 2: 강제 초기화 (대시보드에서 수동 확인 후)
```bash
python scripts/daily_batch.py --reset-stock-data --date 20260516
```
⚠️ **주의**: 실행 중 1-3시간 소요, API 호출 4만+ 건

#### Step 3: 실행 후 검증
```bash
# 수집 완료 후 stock_daily 데이터 확인
python -c "
from supabase import create_client
import os
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
res = supabase.table('stock_daily').select('date').order('date', desc=True).limit(1).execute()
print(f'업데이트 후 DB 최신: {res.data[0][\"date\"]}')
"
```

---

## 4. 자동 배치 설정 (GitHub Actions)

### `.github/workflows/daily-batch.yml`
```yaml
name: Daily Batch
on:
  schedule:
    - cron: '0 15 * * 1-5'  # 평일 오후 3시 (UTC+9)
  
jobs:
  batch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install deps
        run: |
          pip install -r requirements.txt
      
      - name: Run Daily Batch
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          python scripts/daily_batch.py
          
      # 실패 시 알림
      - name: Notify on failure
        if: failure()
        run: |
          echo "배치 실행 실패"
          # Telegram 등으로 알림 추가 가능
```

---

## 5. 모니터링 및 유지보수

### 주간 체크리스트
- [ ] stock_daily 최신 날짜 확인 (5일 이내여야 함)
- [ ] 배치 실행 로그 확인 (에러 없는지)
- [ ] 지표 및 점수가 정상 범위인지 확인

### 월간 유지보수
- [ ] pykrx 업데이트 확인 (`pip list | grep pykrx`)
- [ ] 400일 이상 오래된 데이터 자동 정리 확인
- [ ] 데이터 품질 샘플 검증

### 분기별 전체 점검
- [ ] DB 성능 (stock_daily 인덱스 최적화)
- [ ] API 응답 속도 모니터링
- [ ] 필요시 `--reset-stock-data` 실행

---

## 6. 트러블슈팅

### "OHLCV 수집 실패" 에러

**원인**: pykrx API 응답 지연 또는 차단

**해결**:
```bash
# 1단계: 기준일을 명시적으로 지정
python scripts/daily_batch.py --date 20260515

# 2단계: DB 초기화 후 재시작 (1-3시간 소요)
python scripts/daily_batch.py --reset-stock-data --date 20260516

# 3단계: 개발자 확인
# - pykrx GitHub issues 확인
# - 네이버 금융 등 차단 여부 확인
```

### "데이터 신선도 양호" 경고

**의미**: 수집된 최신 데이터가 기준일보다 5일 이상 오래됨

**해결**:
```bash
# 다음 거래일에 다시 시도
python scripts/daily_batch.py --date 20260516
```

### "종목 데이터 불일치"

**의미**: 지표 계산 시 일부 종목 데이터가 없음

**영향**: 해당 종목 점수는 스킵 (정상 작동)

---

## 7. 데이터 품질 검증 스크립트

### 거래대금(value) 필드 검증
```python
import pandas as pd
from supabase import create_client
import os

supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# 최근 100개 데이터 확인
res = supabase.table('stock_daily').select('ticker, date, volume, close, value').order('date', desc=True).limit(100).execute()
df = pd.DataFrame(res.data)

# 거래대금이 0이거나 null인 경우 확인
print(f"총 {len(df)}개 데이터")
print(f"거래대금 0 또는 null: {(df['value'].isna() | (df['value'] == 0)).sum()}개")

# 계산된 거래대금(volume * close)과 비교
df['calculated_value'] = df['volume'] * df['close']
df['value_numeric'] = pd.to_numeric(df['value'], errors='coerce')
mismatch = (df['value_numeric'] != df['calculated_value']).sum()
print(f"계산값과 불일치: {mismatch}개")
```

---

## 📌 정리

| 구분 | 이전 | 개선됨 |
|------|------|--------|
| 거래일 감지 | 8일, 1종목 | **60일, 4종목** |
| 오래된 데이터 감지 | ❌ | ✅ 30일 이상 차이 |
| 자동 복구 | ❌ | ✅ stock_daily 초기화 |
| 데이터 신선도 검증 | ❌ | ✅ 수집 후 검증 |
| 배치 옵션 | 2개 | **4개** |
| 에러 메시지 | 모호함 | ✅ 구체적 + 해결책 |

---

**다음**: 앞으로는 배치 실행 시 항상 최신 데이터로 모든 정보가 업데이트됩니다! 🎉
