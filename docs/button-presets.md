# Telegram 버튼 프리셋 가이드

이 문서는 봇 명령어의 버튼 레이아웃을 일관되게 유지하기 위한 운영 기준입니다.

## 1) 기준 파일

- 프리셋 정의: `src/bot/messages/layout.ts`
- 사용 방식: `actionButtons(ACTIONS.xxx, cols)`

---

## 2) 프리셋 목록 (ACTIONS)

### 시장/거시 허브

- `ACTIONS.marketFlow`
  - 구성: 시장, 수급, 경제, 브리핑
  - 사용처: 거시/시장 컨텍스트에서 상호 이동이 필요할 때

- `ACTIONS.marketHub`
  - 구성: 경제, 수급, 섹터, 스캔
  - 사용처: 시장 분석 후 섹터/스캔 탐색으로 이어갈 때

### 브리핑/프롬프트 진입

- `ACTIONS.briefing`
  - 구성: 점수, 매수, 뉴스, 수급, 눌림목, 시장
  - 사용처: 장전 브리핑/요약 화면

- `ACTIONS.promptAnalyze`
  - 구성: 점수, 매수, 재무, 뉴스 (모두 `prompt:`)
  - 사용처: 종목이 확정되지 않은 스캔/후보 리스트 화면

- `ACTIONS.marketFlowWithPromptFlow`
  - 구성: 종목 수급(prompt) + 시장/수급/경제/브리핑
  - 사용처: 시장 수급 요약 화면에서 종목 수급 질의로 내려갈 때

- `ACTIONS.marketFlowWithPromptNews`
  - 구성: 종목 뉴스(prompt) + 시장/수급/경제/브리핑
  - 사용처: 시장 뉴스 화면에서 종목 뉴스 질의로 내려갈 때

### 종목 상세

- `ACTIONS.analyzeStock(code)`
  - 구성: 점수, 매수, 재무, 뉴스, 관심추가 (모두 종목 코드 고정)
  - 사용처: 특정 종목 상세 응답 하단

- `ACTIONS.analyzeStockWithRecalc(code)`
  - 구성: 재계산 + `analyzeStock(code)`
  - 사용처: 점수 화면처럼 동일 종목 재평가 버튼이 필요한 경우

---

## 3) 네이밍 규칙

- 고정 메뉴는 명사형: `marketHub`, `briefing`
- 프롬프트 진입 포함 시 `WithPromptXxx` 사용
- 종목 코드가 필요한 프리셋은 함수형: `analyzeStock(code)`
- 프리셋 이름만 보고 용도를 알 수 있게 작성

---

## 4) 선택 가이드 (빠른 매핑)

- 시장/거시 요약 화면 → `marketFlow` 또는 `marketHub`
- 브리핑 허브 화면 → `briefing`
- 종목 미확정 리스트(스캔/후보) → `promptAnalyze`
- 종목 상세 분석 화면 → `analyzeStock(code)`
- 점수 상세(재계산 필요) → `analyzeStockWithRecalc(code)`
- 시장 수급 요약 + 종목 수급 진입 → `marketFlowWithPromptFlow`
- 시장 뉴스 + 종목 뉴스 진입 → `marketFlowWithPromptNews`

---

## 5) 새 프리셋 추가 절차

1. `src/bot/messages/layout.ts`의 `ACTIONS`에 추가
2. 최소 1개 명령어에서 즉시 사용하도록 치환
3. 버튼 텍스트와 callback 접두사(`cmd:`, `prompt:`, `score:` 등) 일관성 확인
4. `npm run build`로 타입 검증
5. 이 문서의 목록/매핑 표 갱신

---

## 6) 금지/권장 규칙

### 금지

- 명령어 파일 안에 동일 버튼 배열을 반복 선언
- 동일 목적의 화면에서 서로 다른 버튼 순서 사용
- 종목 미확정 화면에 종목코드 고정 callback 사용

### 권장

- 가능한 `ACTIONS` 프리셋 재사용
- 예외가 필요한 경우 `ACTIONS`에 새 프리셋 추가 후 재사용
- `actionButtons(..., cols)`의 `cols`는 화면 성격별로 통일
  - 허브형: 2열
  - 종목 분석형: 3열
