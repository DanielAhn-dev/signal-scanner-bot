# 신용/공매도 수동 입력 - 개발자 통합 가이드 (2026-05-12)

## 📋 개요

KRX API 차단으로 인해 자동 수집이 불가능하므로, **웹 UI에서 수동 입력 방식**으로 전환합니다.

### 생성된 파일
- **컴포넌트**: `web/src/components/CreditShortForm.tsx`
- **API**: `api/credit-short.ts`
- **가이드**: `docs/credit-short-manual-entry.md`

---

## 🔌 통합 방법

### Step 1: 컴포넌트 import

```typescript
import CreditShortForm from '@/components/CreditShortForm'
```

### Step 2: 상태 관리

```typescript
const [creditShortOpen, setCreditShortOpen] = useState(false)

const handleSaveCreditShort = async (data) => {
  const response = await fetch('/api/credit-short', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  
  if (!response.ok) {
    throw new Error('Failed to save')
  }
  
  return response.json()
}
```

### Step 3: UI에 추가

```tsx
<button 
  onClick={() => setCreditShortOpen(true)}
  className="px-4 py-2 bg-blue-600 text-white rounded"
>
  신용/공매도 데이터 입력
</button>

<CreditShortForm 
  open={creditShortOpen}
  onClose={() => setCreditShortOpen(false)}
  onSave={handleSaveCreditShort}
/>
```

---

## 📊 API 명세

### `POST /api/credit-short`

**Request Body:**
```json
{
  "date": "2026-05-10",
  "shortRatio": 4.5,
  "creditRatio": 3.2
}
```

**Response (200):**
```json
{
  "success": true,
  "saved": 150,
  "date": "2026-05-10",
  "shortRatio": 4.5,
  "creditRatio": 3.2
}
```

**Error Response (400/500):**
```json
{
  "error": "date is required"
}
```

---

## 💾 DB 저장 구조

### 저장되는 테이블
1. **stock_credit_short_daily** (일별 데이터)
   - `code`: 종목 코드
   - `date`: 거래일
   - `short_ratio`: 공매도비율
   - `credit_ratio`: 신용비율

2. **stocks** (최신값)
   - `short_ratio`: 최신 공매도비율
   - `credit_ratio`: 최신 신용비율

### 자동 처리
- 모든 active 종목 (core + extended universe)에 동일한 데이터 저장
- `onConflict: 'code,date'` → 중복 시 업데이트
- 최신값은 stocks 테이블에 즉시 반영

---

## 🎯 사용 시나리오

### 매주 금요일 17:30 (장 마감 후)

1. 사용자가 웹 앱 열기
2. "신용/공매도 데이터 입력" 버튼 클릭
3. 폼 작성:
   - 날짜: 오늘 (2026-05-10)
   - 공매도비율: Naver에서 조회 후 입력 (예: 4.5%)
   - 신용비율: 증권사 HTS에서 조회 후 입력 (예: 3.2%)
4. 저장 버튼 클릭
5. ✅ 모든 종목의 데이터 자동 저장
6. 📊 대시보드에서 즉시 차트 업데이트 확인

---

## 🔄 향후 자동화 복구

KRX API 또는 다른 소스에서 자동 수집이 가능해질 때:

1. `scripts/update_credit_short.py` 복구
2. `batch/sync_credit_short.bat` + Task Scheduler 재활성화
3. 웹 UI 폼은 그대로 유지 (매번 필요 시 수동 입력 가능)

---

## 📝 체크리스트

- [x] React 컴포넌트 생성 (`CreditShortForm.tsx`)
- [x] API 엔드포인트 생성 (`api/credit-short.ts`)
- [x] Supabase 테이블에 저장 로직 구현
- [ ] 웹 UI의 적절한 위치에 버튼 추가 필요
- [ ] 사용자 테스트 필요

---

## 🚀 다음 단계

1. **웹 UI 통합**: 대시보드 또는 설정 페이지에 버튼 추가
2. **사용자 교육**: 매주 입력 방법 공지
3. **향후 자동화**: KRX API 또는 증권사 API 복구 시 전환

