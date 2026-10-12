// 자동 생성 — scripts/research/build_drop_day_facts.py. 직접 고치지 말고 스크립트를 다시 돌린다.
import type { FactMeta } from './researchFacts'
export const DROP_DAY_FACTS = {"period": "1996-12~2026-09", "buckets": [{"threshold": -1.5, "perYear": 30.3, "events": 82, "h60": {"n": 82, "medianPct": 2.6, "upPct": 62}, "h250": {"n": 78, "medianPct": 4.3, "upPct": 64}, "further60": {"down5Pct": 49, "down10Pct": 17}}, {"threshold": -2, "perYear": 19.7, "events": 76, "h60": {"n": 76, "medianPct": 3.6, "upPct": 66}, "h250": {"n": 72, "medianPct": 7.6, "upPct": 65}, "further60": {"down5Pct": 46, "down10Pct": 22}}, {"threshold": -3, "perYear": 9.9, "events": 53, "h60": {"n": 53, "medianPct": 6.5, "upPct": 62}, "h250": {"n": 50, "medianPct": 12.2, "upPct": 66}, "further60": {"down5Pct": 51, "down10Pct": 34}}, {"threshold": -5, "perYear": 2.8, "events": 30, "h60": {"n": 30, "medianPct": 7.5, "upPct": 60}, "h250": {"n": 28, "medianPct": 18.1, "upPct": 64}, "further60": {"down5Pct": 63, "down10Pct": 40}}], "baseFurther60": {"down5Pct": 49, "down10Pct": 27}, "rally": {"surge": {"threshold": 3, "perYear": 8.7, "events": 45, "further60": {"down5Pct": 56, "down10Pct": 42}, "h250": {"n": 42, "medianPct": 2.8, "upPct": 55}}, "newHigh": {"perYear": 18.2, "events": 45, "further60": {"down5Pct": 40, "down10Pct": 18}, "h250": {"n": 43, "medianPct": 12.0, "upPct": 70}}, "baseH250": {"medianPct": 6.4, "upPct": 63}}, "us": {"period": "2016-01~2026-09", "beta": 0.4, "r2Pct": 9}} as const
export const DROP_DAY_META: FactMeta = {
  "title": "코스피 큰 하락·급등일 빈도·이후 흐름",
  "asOf": "2026-09",
  "generated": "2026-10-12",
  "script": "scripts/research/build_drop_day_facts.py",
  "sample": "코스피 종가 1996-12~2026-09(배당 제외), 큰 하락·급등·신고가 뒤 수익은 20거래일 안에 다시 난 같은 날을 한 번으로 센 독립 사건",
  "caveat": "과거 평균일 뿐 이번에도 같다는 뜻이 아님. 약 3번 중 1번은 1년 뒤에도 마이너스. 미국 몫은 간밤 S&P500 하나로만 본 근사(장중 선물·아시아 시장은 반영 안 됨). 추가 하락 비율은 평소 아무 날과 큰 차이가 없고(−3% 이하만 다소 높음), 2016년 이후로는 그 차이도 없음. +3% 급등일은 뒤에 흔들림이 평소보다 컸고(급등은 변동성이 큰 시기의 신호), 52주 신고가 날은 평소보다 나빴던 적이 없음 — 오를 때 몰아 사는 근거도, 고점이라 피하는 근거도 없음. 1997~98 외환위기 반등을 빼면 급등일 1년 뒤 수치는 더 좋아짐(표본 민감)"
}
