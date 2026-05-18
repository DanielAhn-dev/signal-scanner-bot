# 🤖 배치 자동 실행 설정 (GitHub Actions)

## 현재 상황
- ✅ 로컬 배치 실행: 정상 작동 중
- ✅ 데이터 신선도: 자동 검증 추가됨
- 📋 다음: GitHub Actions 자동화

---

## GitHub Actions 워크플로우 설정

### 파일: `.github/workflows/daily-batch.yml`

```yaml
name: Daily Batch - OHLCV & Indicators Update

on:
  schedule:
    # 평일 오후 3시 30분 (KST, UTC+9)
    # KRX 장 종료: 오후 3시 30분
    - cron: '30 6 * * 1-5'  # UTC 기준 오전 6시 30분 = KST 오후 3시 30분
  
  # 수동 트리거 (Workflow dispatch)
  workflow_dispatch:
    inputs:
      trading_date:
        description: '기준 거래일 (YYYYMMDD, 선택사항)'
        required: false
      reset_data:
        description: 'DB 초기화 후 재수집?'
        required: false
        default: 'false'
        type: choice
        options:
          - 'false'
          - 'true'

jobs:
  batch:
    name: Daily Batch Execution
    runs-on: ubuntu-latest
    timeout-minutes: 180  # 3시간
    
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      TZ: 'Asia/Seoul'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
      
      - name: Run Daily Batch (Normal)
        if: github.event.inputs.reset_data != 'true'
        run: |
          if [ -n "${{ github.event.inputs.trading_date }}" ]; then
            echo "📅 기준 거래일 지정: ${{ github.event.inputs.trading_date }}"
            python scripts/daily_batch.py --date ${{ github.event.inputs.trading_date }}
          else
            echo "📅 기준 거래일 자동 감지"
            python scripts/daily_batch.py
          fi
      
      - name: Run Daily Batch (Reset DB)
        if: github.event.inputs.reset_data == 'true'
        run: |
          if [ -n "${{ github.event.inputs.trading_date }}" ]; then
            echo "🔄 DB 초기화 + 기준 거래일: ${{ github.event.inputs.trading_date }}"
            python scripts/daily_batch.py --reset-stock-data --date ${{ github.event.inputs.trading_date }}
          else
            echo "🔄 DB 초기화 + 기준 거래일 자동 감지"
            python scripts/daily_batch.py --reset-stock-data
          fi
      
      - name: Upload logs to artifacts
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: batch-logs
          path: |
            *.log
            batch-*.txt
          retention-days: 7
      
      - name: Notify success
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            console.log('✅ 배치 정상 완료');
      
      - name: Notify failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            console.log('❌ 배치 실행 실패');
            console.log('보러가기: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}');
```

### 파일: `.github/workflows/daily-batch-with-telegram.yml` (선택사항)

```yaml
name: Daily Batch + Telegram Notify

on:
  schedule:
    - cron: '30 6 * * 1-5'  # 평일 오후 3시 30분

jobs:
  batch:
    runs-on: ubuntu-latest
    timeout-minutes: 180
    
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      TZ: 'Asia/Seoul'
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: pip install -r requirements.txt
      
      - name: Run batch
        id: batch
        run: |
          python scripts/daily_batch.py 2>&1 | tee batch.log
          echo "status=$?" >> $GITHUB_OUTPUT
      
      - name: Send Telegram (Success)
        if: steps.batch.outputs.status == '0'
        uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_CHAT_ID }}
          token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          message: |
            ✅ 일일 배치 완료
            
            📅 시간: $(date '+%Y-%m-%d %H:%M:%S')
            📊 상태: 성공
            🔗 로그: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}
      
      - name: Send Telegram (Failure)
        if: failure()
        uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_CHAT_ID }}
          token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          message: |
            ❌ 일일 배치 실패
            
            📅 시간: $(date '+%Y-%m-%d %H:%M:%S')
            📊 상태: 실패
            🔗 로그: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

---

## 필수 Secrets 설정

### GitHub Settings → Secrets and variables → Actions

| Secret | 값 | 예시 |
|--------|-----|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 역할 API 키 | `eyJhbGc...` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (선택사항) | `123456:ABCdef...` |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID (선택사항) | `-1001234567890` |

### 설정 방법
1. Repository → Settings → Secrets and variables → Actions
2. New repository secret 클릭
3. Name: `SUPABASE_URL`, Value: 실제 URL 입력
4. 반복

---

## 스케줄 설정

### Cron 표현식
```
┌───────────── 분 (0 - 59)
│ ┌───────────── 시 (0 - 23)
│ │ ┌───────────── 일 (1 - 31)
│ │ │ ┌───────────── 월 (1 - 12)
│ │ │ │ ┌───────────── 요일 (0 - 6) (0 = 일요일, 6 = 토요일)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

### KRX 장 시간 기준
- **KRX 장 종료**: 오후 3시 30분 (KST, UTC+9)
- **GitHub Actions Cron**: UTC 기준
- **변환**: KST - 9시간 = UTC

```
KST 오후 3시 30분 (15:30) → UTC 오전 6시 30분 (06:30)
```

#### 예시
```yaml
# 평일 오후 3시 30분 실행
- cron: '30 6 * * 1-5'

# 매일 자정 실행
- cron: '0 15 * * *'  # KST 오전 0시

# 주 1회 (월요일 오후 3시 30분)
- cron: '30 6 * * 1'
```

---

## 수동 실행 방법

### GitHub UI에서
1. Repository → Actions
2. "Daily Batch" 워크플로우 선택
3. "Run workflow" 클릭
4. (선택사항) `trading_date`, `reset_data` 입력
5. "Run workflow" 확인

### gh CLI 사용
```bash
# 기본 실행
gh workflow run daily-batch.yml

# 파라미터 지정
gh workflow run daily-batch.yml \
  -f trading_date=20260515 \
  -f reset_data=true
```

---

## 로그 확인

### GitHub UI
1. Actions → 해당 워크플로우 실행
2. 각 Step 클릭하여 로그 확인

### 다운로드
```bash
# 아티팩트 다운로드 (최근 7일)
gh run download <run-id> -n batch-logs
```

---

## 문제 해결

### "Cron 실행이 안 됨"
- ❌ Repository가 private이고 60일 이상 비활성 → Actions 자동 중지
- ✅ 해결: Repository 활성화 또는 수동 실행

### "API 권한 부족"
- ✅ `SUPABASE_SERVICE_ROLE_KEY` 확인 (anon key 아님)

### "시간대 문제"
- ✅ `.github/workflows/daily-batch.yml`에서 `TZ: 'Asia/Seoul'` 설정

---

## 모니터링

### 배치 실행 상태 확인
```bash
# 최근 5개 실행 보기
gh run list --workflow=daily-batch.yml --limit 5

# 상세 정보
gh run view <run-id>
```

### 데이터 업데이트 확인
```python
from supabase import create_client
import os

supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# 최신 데이터 날짜
res = supabase.table('stock_daily').select('date').order('date', desc=True).limit(1).execute()
print(f"최신: {res.data[0]['date']}")

# 데이터 개수
res = supabase.table('stock_daily').select('count', count='exact').execute()
print(f"총 데이터: {res.count}")
```

---

## 체크리스트

- [ ] `.github/workflows/daily-batch.yml` 파일 생성
- [ ] Secrets 설정 완료 (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] 로컬에서 배치 테스트 (`python scripts/daily_batch.py`)
- [ ] GitHub에 push
- [ ] Actions 탭에서 워크플로우 활성화 확인
- [ ] "Run workflow" 수동 실행 테스트
- [ ] 로그 확인
- [ ] Cron 시간대 재확인

---

✅ **완료**: 이제 매일 자동으로 최신 데이터가 업데이트됩니다! 🎉
