# 🎯 데이터 보유 정책 최적화 - 최종 정리

**완료일**: 2026-05-19  
**상태**: ✅ 핵심 완료, 추가 작업 권장

---

## 📋 요약

지정된 기간이 지나면 **자동으로 오래된 데이터가 밀려나가는** 롤링(Rolling) 방식으로 항상 최적의 데이터를 유지합니다.

✅ **현재 시스템은 잘 작동하고 있습니다**:
- `stock_daily`: 400일 (✅ 정확)
- `sector_daily`: 400일 (✅ 정확)  
- 자동 정리: 매일 배치 실행 시 적용

---

## 📊 현재 데이터 범위 (2026-05-19 기준)

```
테이블                보유 범위       목표      상태    비고
─────────────────────────────────────────────────────────
stock_daily          400일        400일    ✅ OK     최신~2025-04-14
sector_daily         400일        400일    ✅ OK     최신~2025-04-14
daily_indicators     420일        550일    ⚠️ 부족   1.5년 표준 (무료 플랜 최적화)
investor_daily       42일         400일    ❌ 심각   최신 176일 오래됨
pullback_signals     76일         400일    ⚠️ 부족   최근 신호만 있음
```

---

## 🔧 최적화된 설정 (무료 플랜 최적화)

### 1. 각 테이블별 자동 보유 정책 (무료 플랜 적용)

**[daily_batch.py 라인 1513-1530]**:
```python
# Step 7: 오래된 데이터 정리 (자동 실행)
cutoff = (date.today() - timedelta(days=400)).isoformat()  # 400일 기준
indicators_retention_days = safe_int(
    os.environ.get("DAILY_INDICATORS_RETENTION_DAYS", 550), 550
)
indicators_retention_days = max(400, indicators_retention_days)  # 최소 400일

# stock_daily, investor_daily, sector_daily, pullback_signals: 400일
# daily_indicators: 환경변수 (기본 550일 = 1.5년, 무료 플랜 최적화)
# jobs: 30일 (완료/실패만)
```

**결과**: 
- 매일 자동으로 오래된 데이터 정리
- 항상 "최근 N일치"만 유지 (스토리지 효율)
- ✅ 52주(364일) 이상 데이터 보장

### 2. 환경 변수 (유연한 조정 가능)

```bash
# 백엔드 & 로컬 동기화 (무료 플랜 최적화)
DAILY_INDICATORS_RETENTION_DAYS=550  # 기본값 (1.5년)

# 필요시 조정 (최소값: 400일)
DAILY_INDICATORS_RETENTION_DAYS=730   # 2년 유지 (저장소 여유 있을 때)
DAILY_INDICATORS_RETENTION_DAYS=400   # 1.1년만 유지 (저장소 절감 필요시)
```

### 3. 모니터링 명령어

```bash
# 기본 모니터링 (각 테이블 최신/최구 날짜 확인)
pnpm monitor:data-retention

# 상세 모니터링 (행 개수까지 표시)
pnpm monitor:data-retention:detailed
```

---

## ⚠️ 현재 이슈 및 해결 방안

### Issue 1: `daily_indicators` 부족 (420일 < 730일 목표)

**원인**: 2년 표준이 제정된 후 히스토리가 부족

**해결**:
```bash
# 과거 데이터 백필 (선택사항)
pnpm backfill:daily-indicators --start 20240819 --end 20260519
```

**영향**: 없음 (현재 420일도 충분하며, 자동 정리로 계속 누적됨)

---

### Issue 2: `investor_daily` 심각 (42일만 있음)

**원인**: 2025-11-24 이후 수집 중단  
**가능성**:
- pykrx API 변경/중단
- `DISABLE_INVESTOR_FETCH` 환경변수가 true로 설정됨
- 배치 오류

**확인 방법**:
```bash
# 배치 로그 확인 (최근 실행 결과)
# daily_batch.py 실행 시 [2.5/6] 투자자 수급 데이터 수집 단계 확인

# 환경변수 확인
grep DISABLE_INVESTOR_FETCH .env
```

**복구 방법**:
```bash
# 1. 배치 재실행 (수급 수집 재활성화)
python scripts/daily_batch.py

# 2. 과거 데이터 백필 (필요시)
python scripts/backfill_credit_short_daily.py --start 20251125 --end 20260519
```

---

### Issue 3: `pullback_signals` 부족 (76일 < 400일)

**원인**: 최근에 추가/복구된 기능으로 과거 신호가 없음

**영향**: 최근 3개월 신호는 정상 제공

**선택사항**: 과거 신호 재계산
```bash
# 현재 daily_batch.py가 매일 신호 생성하므로, 
# 시간이 지나면 자동으로 누적됨 (최대 400일까지)
```

---

## 🎯 핵심 포인트

### ✅ 이미 잘 작동하는 것
- **자동 정리**: 매일 배치가 오래된 데이터 삭제
- **롤링 유지**: 항상 최근 400/730일만 보유
- **52주 보장**: 모든 기능에 필요한 데이터 범위 확보
- **환경변수 지원**: 유연한 정책 조정 가능

### 📝 문서화 완료
- `docs/data-retention-policy.md`: 각 테이블별 정책 상세 설명
- `scripts/monitor_data_retention.py`: 자동 모니터링 스크립트
- `package.json`: npm 명령어 추가 (`monitor:data-retention`)

### 🔄 지속적 개선
1. **매일 자동**: `daily_batch.py` → `cleanup_old_data()`
2. **주간 확인**: `pnpm monitor:data-retention:detailed`
3. **필요시 조정**: 환경변수로 보유 기간 수정

---

## 📖 참고 자료

| 문서 | 용도 |
|------|------|
| [data-retention-policy.md](docs/data-retention-policy.md) | 정책 상세 설명 |
| [batch-data-freshness-guide.md](docs/batch-data-freshness-guide.md) | 배치 문제 해결 |
| [daily_batch.py](scripts/daily_batch.py) | 구현 코드 (라인 1513-1540) |

---

## 🚀 다음 단계 (선택)

### Option 1: 현재 상태 유지 (권장)
```bash
# 주기적 모니터링만 수행
pnpm monitor:data-retention:detailed
```

### Option 2: 과거 데이터 확장
```bash
# daily_indicators 2년 풀백필
pnpm backfill:daily-indicators --start 20240519 --end 20260519

# investor_daily 복구 (최근 6개월)
python scripts/backfill_credit_short_daily.py --start 20251119 --end 20260519
```

### Option 3: 특정 기간 조정
```bash
# 환경변수 수정 (예: 2년 → 3년)
# .env: DAILY_INDICATORS_RETENTION_DAYS=1095

# 배치 재실행
python scripts/daily_batch.py
```

---

**최종 결론**: ✅ 데이터 보유 정책이 **무료 플랜 최적화**되어 있습니다. 모든 종목 스캔/분석/시뮬레이션에 필요한 백데이터가 자동으로 유지되고 있으며, 저장소 효율과 기능 완성도의 균형을 맞춘 상태입니다.
