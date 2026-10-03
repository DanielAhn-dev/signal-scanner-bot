// 자동 생성 — scripts/research/build_research_facts.py. 직접 고치지 말고 스크립트를 다시 돌린다.
export type FactMeta = { title: string; asOf: string; generated: string; script: string; sample: string; caveat: string }
export const MARKET_PICK = {"period": "2003-12~2026-08", "months": 272, "kCagr": 12.741350730787682, "uCagr": 11.568703759310361, "corr": 0.35809475332098684, "mdd": {"k": -45.52605183972973, "u": -22.20366048068031, "mix": -31.41765300624284}, "hold": [{"years": 5, "starts": 213, "kMed": 1.3608484538717098, "uMed": 1.91508293019771, "mixMed": 1.570325501122131, "kMin": 0.891548042704626, "uMin": 0.921514395366056, "mixMin": 1.1368669003299257, "usWinPct": 75.5868544600939}, {"years": 10, "starts": 153, "kMed": 1.6823113320269563, "uMed": 3.543987267609423, "mixMed": 2.496679419023659, "kMin": 1.2452193475815512, "uMin": 1.787680759493227, "mixMin": 1.965362669798356, "usWinPct": 85.62091503267973}], "kospi2025Pct": 94.22217937594395} as const
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
  "sleeve": {
    "title": "인컴(커버드콜) 몫 비용",
    "asOf": "2026-08",
    "generated": "2026-10-03",
    "script": "scripts/research/build_research_facts.py",
    "sample": "한국 커버드콜 2종 202204~202610 / 202112~202610",
    "caveat": "한국 강세장 4~5년, 방향만 참고"
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
