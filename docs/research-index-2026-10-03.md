# 연구 인덱스 (2026-10-03) — 재개용

새 세션에서 이 문서만 읽으면 어디까지 했고 무엇이 남았는지 알 수 있게 정리한다.

## 문서
| 문서 | 내용 |
|---|---|
| `research-retirement-and-starting-2026-10-03.md` | 은퇴 인출·세금·건보료, 일시금 대 분할, 감내 낙폭, 필요 월 적립, 확인 빈도, 강건성(시대·부트스트랩) |
| `research-income-then-growth-2026-10-03.md` | 선 인컴 후 성장, 인컴 비중 비용, 미국 커버드콜, 코스피 대 미국, 인컴 계좌 구성, 세후·원금 잠식, 커버드콜 세대별, 합성 점검, 분배금 안정성 |
| `plan-child-gift-account-2026-10-03.md` | 자녀 증여 계좌 기획(1단계 구현, 2단계 설계) |
| `research-weight-caution-2026-10-05.md` | 비중 조절 경고: 종목 과열·변동성(채택), 시장 외국인 수급 F3(안내 채택), 금리·환율·VKOSPI·종목 수급(미채택) |

## 스크립트 (`scripts/research/`)
- 은퇴·시작: `validate_retirement_withdrawal.py`, `validate_lump_vs_split_tolerance.py`, `validate_required_saving.py`, `validate_checking_frequency.py`, `validate_robustness_eras.py`, `validate_tolerance_horizon_eras.py`
- 인컴: `validate_income_then_growth.py`, `validate_satellite_mix.py`, `validate_us_covered_call.py`, `validate_kospi_vs_us.py`, `validate_income_mix.py`, `validate_income_erosion.py`, `validate_cc_generations.py`, `validate_cc_synthetic.py`, `validate_distribution_stability.py`
- 금리: `validate_kr_rates_fx.py`(한국 CD91·원/달러 환경별, 부록 16, `/plan` 금리 환경 탭), `validate_rates_regimes.py`(금리 데이터는 `.research-cache/yh_IRX_me.json`·`yh_TNX_me.json` 월말값, 야후 일봉을 4~5년씩 나눠 받아 만든다 — 월봉은 분기 간격이라 쓰면 안 됨)
- 비중 조절 경고: `validate_weight_caution.py`, `validate_market_flow_caution.py`, `validate_stock_flow_caution.py`, 수집 `fetch_kospi_investor_flow.py`·`fetch_stock_investor_flow.py`
- 화면 데이터 생성: `build_research_facts.py` → `web/src/data/researchFacts.ts`(화면이 읽는 모든 연구 숫자), `build_child_data.py` → `web/src/data/childLongRunData.ts`
- 실행은 저장소 루트에서 (`python scripts/research/<이름>.py`). 캐시는 `.research-cache/`(private repo 동기화).

## 화면
- `/plan` 계획 점검(`web/src/features/plan-check/`, 계산 `web/src/lib/planGuide.ts`): 처음 넣는 법 / 필요 월 적립 / 인컴 점검 / 금리 환경 / 은퇴 인출, 관리자는 원자료 카드 추가
- `/child` 자녀 계좌(1단계), `/start` 시작 마법사(목표 선택)
- 표마다 `FACT_META`(`researchFacts.ts`)의 기준 기간·한계·생성일을 표시, 180일이 지나면 "다시 확인 필요"

## 분기 재검증 때 할 일 (11/20경)
1. 최신 가격·분배금 캐시를 받은 뒤 `build_research_facts.py` 재실행 → 커밋
2. `validate_weight_caution.py`·`validate_market_flow_caution.py` 재실행 → 숫자가 바뀌면 `weightCautionSignal.ts`·`marketFlowCaution.ts` 근거 상수와 연구 문서 갱신
3. 시장 비교·인컴 분배율·재미 몫 비용의 변화를 `research-income-then-growth` 부록에 한 줄 추가
4. 신형 커버드콜 분배금이 들어오면 아래 "남은 일" 1번 수행

## 남은 일
1. **신형 커버드콜 분배금 이력**: 9종 변환·분석 완료(부록 11, `import_incoming_dividends.py`). 남은 것은 KODEX 금융고배당TOP10타겟위클리커버드콜(498410) 분배금(파일이 보유종목 표였음)과 신형 상품 하락장 이력(없음).
2. 한국 지수 옵션 변동성(VKOSPI): **측정 완료**(부록 14, `validate_vkospi_ratio.py`, 2003~2026 일별 → `.research-cache/vkospi.json`). VKOSPI÷실현 ≈1.25로 미국과 같음. 부록 15(`validate_kr_vkospi_synth.py`): 한국 상품은 시장 내재변동성의 약 75%(m 0.65~0.81)만 반영 → 합성은 VKOSPI×0.75. 남은 것은 [15011] 행사가별 내재변동성(스큐) 선택 과제.
3. 건보료 재산 점수표 중간 구간은 근사 → 공단 모의계산 1~2건 대조(사용자).
4. 자녀 계좌 2단계(계정 연결)는 미성년 개인정보 법률 확인 후.
5. 화면은 실제 로그인으로 서버 저장·기기 간 동기화(`childGifts`) 확인 필요.

6. 금리 환경별 안전자산 비중 규칙(현금성↔장기채) 사전 고정 검증, 은퇴 인출에서 시작 채권 금리의 영향.

## 주의 (읽는 사람에게)
- 대부분의 인컴·커버드콜 결과는 한국 강세장 4~5년 표본이고 1세대형 상품 중심이다. 긴 하락·박스권 경험이 없다.
- 합성 점검(부록 5)은 프리미엄 가정에 결과가 크게 좌우되므로 구조 비교용으로만 쓴다.
- 세금·건보 규칙은 여러 안내 자료가 일치하는 선까지만 확인했고 공식 원문은 확인하지 못했다.
