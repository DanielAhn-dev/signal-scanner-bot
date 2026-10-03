// 자동 생성 — scripts/research/build_research_facts.py. 직접 고치지 말고 스크립트를 다시 돌린다.
export type FactMeta = { title: string; asOf: string; generated: string; script: string; sample: string; caveat: string }
export const MARKET_PICK = {"period": "2003-12~2026-08", "months": 272, "kCagr": 12.741350730787682, "uCagr": 11.568703759310361, "corr": 0.35809475332098684, "mdd": {"k": -45.52605183972973, "u": -22.20366048068031, "mix": -31.41765300624284}, "hold": [{"years": 5, "starts": 213, "kMed": 1.3608484538717098, "uMed": 1.91508293019771, "mixMed": 1.570325501122131, "kMin": 0.891548042704626, "uMin": 0.921514395366056, "mixMin": 1.1368669003299257, "usWinPct": 75.5868544600939, "kTaxMed": 1.3370552675978942, "uTaxMed": 1.7741601589472626, "kTaxMin": 0.8758543821440504, "uTaxMin": 0.921514395366056, "usWinTaxPct": 72.30046948356808}, {"years": 10, "starts": 153, "kMed": 1.6823113320269563, "uMed": 3.543987267609423, "mixMed": 2.496679419023659, "kMin": 1.2452193475815512, "uMin": 1.787680759493227, "mixMin": 1.965362669798356, "usWinPct": 85.62091503267973, "kTaxMed": 1.6239494837826567, "uTaxMed": 3.1522132283975717, "kTaxMin": 1.2019198379672262, "uTaxMin": 1.6663779225312698, "usWinTaxPct": 83.66013071895425}], "kospi2025Pct": 94.22217937594395, "fx": {"period": "2003-12~2026-08", "months": 272, "krwCagr": 11.6, "usdCagr": 10.9, "fxCagr": 0.6, "usdOnlyWinPct": 83, "corrFxUsd": -0.51, "worstUsdAvg": -9.7, "worstFxAvg": 5.5, "worstKrwAvg": -4.7}} as const
export const TOLERANCE_TABLE = [{"stock": 0, "bad10": 11.1, "worst": 23.0}, {"stock": 20, "bad10": 11.9, "worst": 21.7}, {"stock": 40, "bad10": 17.1, "worst": 44.3}, {"stock": 60, "bad10": 27.0, "worst": 61.0}, {"stock": 80, "bad10": 38.9, "worst": 73.1}, {"stock": 100, "bad10": 47.7, "worst": 81.8}] as const
export const SPLIT_TABLE = [{"months": 1, "label": "한 번에", "avgCostPct": 0.0, "firstYearLowBad10": 0.81, "firstYearLowWorst": 0.36}, {"months": 3, "label": "3개월 분할", "avgCostPct": 0.5, "firstYearLowBad10": 0.83, "firstYearLowWorst": 0.37}, {"months": 6, "label": "6개월 분할", "avgCostPct": 1.2, "firstYearLowBad10": 0.84, "firstYearLowWorst": 0.43}, {"months": 12, "label": "12개월 분할", "avgCostPct": 2.4, "firstYearLowBad10": 0.9, "firstYearLowWorst": 0.56}] as const
export const CHECKING_TABLE = [{"label": "매일", "kospi": 173, "sp500": 70}, {"label": "주 1회", "kospi": 35, "sp500": 14}, {"label": "월 1회", "kospi": 8, "sp500": 3}, {"label": "분기 1회", "kospi": 3, "sp500": 1}] as const
export const WITHDRAWAL_TABLE = [{"ratePct": 3.33, "fail25": 0, "fail30": 0}, {"ratePct": 4.0, "fail25": 0, "fail30": 5}, {"ratePct": 4.67, "fail25": 10, "fail30": 16}, {"ratePct": 5.33, "fail25": 20, "fail30": 31}, {"ratePct": 6.67, "fail25": 43, "fail30": 53}] as const
export const INCOME_YIELD = {"cc": {"period": "2023-04~2026-10", "months": 43, "min": 7.4, "p25": 8.1, "median": 8.4, "p75": 8.6, "max": 9.9, "last": 8.2}, "cc2": {"period": "2026-01~2026-10", "months": 10, "min": 11.5, "p25": 12.5, "median": 14.1, "p75": 17.0, "max": 17.9, "last": 16.7}, "cc3": {"period": "2025-11~2026-10", "months": 12, "min": 13.4, "p25": 14.2, "median": 14.7, "p75": 15.3, "max": 16.4, "last": 14.9}, "hd": {"period": "2016-04~2026-10", "months": 127, "min": 2.6, "p25": 3.4, "median": 4.4, "p75": 5.3, "max": 7.3, "last": 4.4}} as const
export const RATES_REGIMES = {"period": "1962-01~2023-06", "hiking": {"months": 168, "stock": 5.4, "bond": 3.0, "cash": 7.1}, "flat": {"months": 401, "stock": 12.2, "bond": 4.3, "cash": 3.4}, "cutting": {"months": 157, "stock": 11.0, "bond": 14.0, "cash": 4.6}, "inverted": {"months": 75, "stock": 2.0, "bond": 9.2, "cash": 8.4}, "normal": {"months": 467, "stock": 10.8, "bond": 5.7, "cash": 3.7}} as const
export const RATES_LONG = {"period": "2011-10~2026-08", "rising": {"months": 41, "kospi200": -6.5, "sp500": 8.1, "usbond20": -20.5, "kbond10": -4.5, "gold": -9.0}, "flat": {"months": 111, "kospi200": 20.2, "sp500": 19.1, "usbond20": 5.3, "kbond10": 3.5, "gold": 4.9}, "falling": {"months": 20, "kospi200": 11.2, "sp500": 17.0, "usbond20": 38.3, "kbond10": 9.7, "gold": 39.8}} as const
export const START_YIELD = {"period": "1961-02~2023-06", "tiers": [{"label": "\ub0ae\uc74c", "minYield": 3.7, "maxYield": 4.2, "starts": 44, "fail40": 16, "fail45": 77}, {"label": "\uc911\uac04", "minYield": 4.2, "maxYield": 7.0, "starts": 109, "fail40": 34, "fail45": 68}, {"label": "\ub192\uc74c", "minYield": 7.0, "maxYield": 15.3, "starts": 237, "fail40": 0, "fail45": 0}]} as const
export const RATES_NOW = {"asOf": "2026-10", "short": 3.99, "long": 5.28, "spread": 1.28, "shortChg12": 0.28, "longChg12": 1.18} as const
export const SLEEVE_COST_DATA = [{"weight": 0, "endVsIndexPct": 100}, {"weight": 20, "endVsIndexPct": 91}, {"weight": 40, "endVsIndexPct": 80}, {"weight": 60, "endVsIndexPct": 69}, {"weight": 100, "endVsIndexPct": 48}] as const
export const FACT_META: Record<string, FactMeta> = {
  "market": {
    "title": "코스피200 대 S&P500",
    "asOf": "2026-08",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py",
    "sample": "2003-12~2026-08 272개월, 원화 환산·분배금 반영",
    "caveat": "2025년 한국 급등 포함, 표본 짧음"
  },
  "income": {
    "title": "인컴 상품 12개월 분배율",
    "asOf": "2026-08",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py",
    "sample": "1세대 한국 2023-04~2026-10 / 2세대 한국 위클리 2026-01~2026-10 / 3세대 미국 데일리 2025-11~2026-10 / 고배당 2016-04~2026-10, 실제 분배금 이력과 역산 실제 가격",
    "caveat": "신형은 이력 2년 안팎(12개월 분배율 표본 10~12개, 범위가 실제보다 좁게 나옴), 한국 강세장, 분배율은 시장 변동성에 따라 크게 변함"
  },
  "rates": {
    "title": "금리 환경별 성과",
    "asOf": "2026-10",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py (validate_rates_regimes.py와 같은 정의)",
    "sample": "미국 1962-01~2023-06, 주식(S&P500 총수익)·10년 합성 국채·3개월물 현금성, 명목",
    "caveat": "겹치는 창, 금리 변화는 경기·물가와 겹쳐 있어 인과가 아님, 인상기 168개월·역전 75개월로 표본 짧음"
  },
  "ratesLong": {
    "title": "장기금리 방향별 자산 성과",
    "asOf": "2026-08",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py (validate_rates_regimes.py C)",
    "sample": "2011-10~2026-08 원화 환산, ^TNX 6개월 변화 기준",
    "caveat": "상승 41개월·하락 20개월로 짧음, 금리 변화는 인과가 아님"
  },
  "startYield": {
    "title": "시작 금리별 인출 실패율",
    "asOf": "2023-06",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py (validate_rates_rules.py와 같은 정의)",
    "sample": "미국 1961-02~2023-06 시작, 60/40 실질, 30년 비례 인출",
    "caveat": "중간 구간은 1966~82년 스태그플레이션 시작이 대부분이라 독립 표본이 2~3개, 겹치는 창"
  },
  "sleeve": {
    "title": "인컴(커버드콜) 몫 비용",
    "asOf": "2026-08",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py",
    "sample": "한국 커버드콜 2종 202204~202610 / 202112~202610",
    "caveat": "1세대형(전체 월물 커버) 기준 — 주간·데일리·OTM 최신 구조는 상승 참여가 훨씬 높음(docs 부록 4), 한국 강세장 4~5년, 방향만 참고"
  },
  "tolerance": {
    "title": "감내 낙폭 표",
    "asOf": "2023-06",
    "generated": "2026-10-03",
    "script": "scripts/research/validate_lump_vs_split_tolerance.py",
    "sample": "미국 1926~2023, 주식+합성 10년 국채, 시작 후 5년",
    "caveat": "월 평균 가격이라 낙폭이 약간 얕음, 시작 시대에 따라 크게 다름"
  },
  "split": {
    "title": "일시금 대 분할",
    "asOf": "2023-06",
    "generated": "2026-10-03",
    "script": "scripts/research/validate_lump_vs_split_tolerance.py",
    "sample": "미국 1926~2023 주식 100%, 시작 후 5년",
    "caveat": "겹치는 창"
  },
  "checking": {
    "title": "확인 빈도",
    "asOf": "2026-09",
    "generated": "2026-10-03",
    "script": "scripts/research/validate_checking_frequency.py",
    "sample": "코스피·S&P500 3년 보유 창",
    "caveat": "일시금 보유만 본 값"
  },
  "saving": {
    "title": "필요 월 적립",
    "asOf": "2023-06",
    "generated": "화면에서 계산",
    "script": "web/src/lib/planGuide.ts",
    "sample": "미국 주식 100% 실질 1926~2023",
    "caveat": "세금·수수료·임금 상승 제외, 시작 시대 편차 큼"
  },
  "withdrawal": {
    "title": "인출 실패율",
    "asOf": "2023-06",
    "generated": "2026-10-03",
    "script": "scripts/research/validate_retirement_withdrawal.py",
    "sample": "미국 60/40 실질 1926~2023, 25·30년",
    "caveat": "부트스트랩으로 보면 더 나쁨, 건보 재산 점수 근사"
  }
}
