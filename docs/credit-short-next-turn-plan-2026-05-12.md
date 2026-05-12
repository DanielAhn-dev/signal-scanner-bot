# 공매도 잔고(주)·신용비율 다음 턴 작업 메모 (2026-05-12)

## 현재 상태
- 공매도 잔고비율(`shortRatio`)은 UI 반영 정상 확인.
- `creditShort.source`가 `db`일 때는 DB 기반 값 사용.
- 현재 업로드 CSV에는 `creditRatio`가 비어 있어 신용비율은 `null`로 표시됨.
- 현재 업로드 CSV에는 `shortBalance` 컬럼이 없어 공매도 잔고(주)는 `null`로 표시됨.

## 다음 턴 목표
1. 공매도 잔고(주) 입력/업로드 경로 확장
2. 신용비율 데이터 입력/업로드 전략 확정
3. UI 표기 기준(없을 때 `-`, 기준일 힌트) 정리

## 구현 후보
1. 업로드 스키마 확장
- `api/credit-short.ts`에 `shortBalance` 허용
- `stock_credit_short_daily.short_balance` upsert
- `stocks.short_balance` 최신값 업데이트

2. 폼 확장
- `web/src/components/CreditShortForm.tsx`에 5번째 컬럼(`shortBalance`) 파싱 지원
- 형식: `code,date,shortRatio,creditRatio,shortBalance`

3. 신용비율 운영안
- 수동 업로드 유지: `creditRatio`는 비어 있지 않으면 저장
- 자동 수집 복구 전까지 수동 입력 우선

## 검증 체크리스트
- `code=000270` 기준 `creditShort.shortBalance` 노출 확인
- `creditRatio` 업로드 행 1건 테스트 후 UI 반영 확인
- `source=db` 유지 여부 확인
