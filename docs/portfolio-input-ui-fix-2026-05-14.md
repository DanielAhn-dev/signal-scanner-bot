# 보유종목 수정 UI 입력 버그 수정 완료 (2026-05-14)

## 🎯 문제점 (사용자 보고)

| 문제 | 증상 | 원인 |
|------|------|------|
| **포커스 자동 해제** | 주식수/매입가 입력 중 숫자 하나만 입력하면 포커스가 자동으로 닫힘 | Input.tsx의 Enter 키에서 blur() 호출 |
| **드래그 불가** | 전체 숫자를 드래그로 선택하려 하면 일부 영역이 넘어가면서 모달이 닫힘 | Modal의 backdrop 클릭 이벤트 전파 미처리 |
| **연속 입력 불가** | 포커스가 자주 해제되어 연속 입력이 불가능 | stopPropagation() 누락 |

---

## ✅ 해결 방법 (3가지 수정)

### 1️⃣ Input 컴포넌트: Enter 키 blur() 제거

**파일**: `web/src/components/ui/Input.tsx`

**변경 전**:
```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (type === 'number' && ['Enter', 'Tab'].includes(e.key)) {
    if (e.key === 'Enter') {
      e.currentTarget.blur()  // ← 문제: 포커스 자동 해제
    }
  }
  onKeyDown?.(e)
}
```

**변경 후**:
```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  // 기본 동작만 수행, blur()는 호출하지 않음
  // (수정 중 포커스가 자동 해제되는 것을 방지)
  onKeyDown?.(e)
}
```

**효과**: 포커스가 자동으로 해제되지 않아 연속 입력 가능

---

### 2️⃣ Modal 컴포넌트: stopPropagation() 추가

**파일**: `web/src/components/Modal.tsx`

**변경 전**:
```tsx
<div
  className="modal-overlay"
  ref={overlayRef}
  onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
>
```

**변경 후**:
```tsx
<div
  className="modal-overlay"
  ref={overlayRef}
  onClick={(e) => {
    // backdrop 클릭 시만 닫기 (내부 요소 클릭은 무시)
    if (e.target === overlayRef.current) {
      e.stopPropagation()  // ← 추가: 이벤트 전파 방지
      onClose()
    }
  }}
>
```

**효과**: 드래그할 때 모달이 의도치 않게 닫히지 않음

---

### 3️⃣ Portfolio Input 필드: stopPropagation() 추가

**파일**: `web/src/features/portfolio/index.tsx` (holdingedit 모드)

**변경 대상 필드들**:
- 종목코드 (StockSearchInput)
- 보유 수량
- 최초 매수일
- 평균 매수가
- 증권사, 계좌명

**변경 전**:
```tsx
<Input 
  label="보유 수량" 
  type="number" 
  value={String(maintQty)} 
  onChange={(e: any) => setMaintQty(...)}
/>
```

**변경 후**:
```tsx
<Input 
  label="보유 수량" 
  type="number" 
  value={String(maintQty)} 
  onChange={(e: any) => setMaintQty(...)}
  onMouseDown={(e) => e.stopPropagation()}  // ← 추가
/>
```

**효과**: 마우스 드래그/조작 시 이벤트가 backdrop까지 전파되지 않음

---

## 📋 수정된 파일 목록

| 파일 | 라인 | 변경 내용 |
|------|------|---------|
| `web/src/components/ui/Input.tsx` | 13-18 | blur() 제거 |
| `web/src/components/Modal.tsx` | 73-83 | stopPropagation() 추가 |
| `web/src/features/portfolio/index.tsx` | 1968-2001 | holdingedit 모드의 모든 input에 onMouseDown 추가 |
| `web/src/features/portfolio/index.tsx` | 2076-2093 | holdingrestore 모드의 input에 onMouseDown 추가 |

---

## 🧪 테스트 방법

1. **포트폴리오 페이지** → 보유 항목 선택 → **보유수정** 클릭
2. **주식수 필드**에 포커스 이동 (클릭)
3. **숫자 여러 개 연속 입력** (예: 1, 2, 3, 4, 5)
   - ✅ 포커스가 유지되며 연속 입력 가능
   - ❌ 포커스가 해제되거나 모달이 닫히지 않음
4. **전체 선택** (드래그 또는 Ctrl+A)
5. **새 숫자 입력**
   - ✅ 드래그 후에도 모달이 닫히지 않음
   - ❌ 드래그 영역 초과로 모달이 닫히지 않음

---

## 🎯 개선 효과

| 지표 | 변경 전 | 변경 후 |
|------|--------|--------|
| **포커스 유지** | ❌ 계속 해제됨 | ✅ 유지됨 |
| **연속 입력** | ❌ 불가능 | ✅ 가능 |
| **드래그 선택** | ❌ 모달이 닫힘 | ✅ 유지됨 |
| **사용성** | 😠 매우 불편 | 😊 편함 |

---

## 💡 핵심 원인 분석

```
사용자 입력
    ↓
Input.tsx의 handleKeyDown
    ↓
if (type === 'number' && e.key === 'Enter')
    e.currentTarget.blur()  ← ⚠️ 포커스 강제 해제
    ↓
포커스가 다른 곳으로 이동
    ↓
모달이 닫힐 수 있는 상태 발생
    ↓
드래그 시 backdrop까지 이벤트 전파 → 모달 닫힘
```

**근본 원인**:
- Enter 키 자동 blur() → 포커스 불안정
- stopPropagation() 미처리 → 이벤트 체이닝

**해결책**:
- blur() 제거 → 포커스 자동 유지
- stopPropagation() 추가 → 이벤트 격리

---

## 📝 주의사항

- 다른 number input이 있는 페이지는 영향 없음 (Input.tsx 수정이 전역 적용)
- Modal의 변경은 모든 모달에 적용됨 (긍정적 효과)
- portfolio의 변경은 해당 모달에만 적용됨

---

## 🔄 향후 개선 사항

1. **Input 컴포넌트 리팩토링**: 타입별로 blur 동작을 옵션화
   ```tsx
   <Input 
     type="number" 
     allowBluronEnter={false}  // 기본값 false
   />
   ```

2. **Modal 일관성**: 모든 모달의 backdrop 클릭 로직 통일

3. **드래그 UX**: number input의 드래그 선택 개선 (필드 전체 선택 버튼 추가)

