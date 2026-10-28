// 자동 생성: scripts/research/build_panic_day_stats.py — 직접 고치지 말 것
export const PANIC_DAY_META = {"generated": "2026-10-28", "source": "가설 장부 H84 ⓔ · scripts/research/validate_avoid_scan.py", "method": "월말마다 거래대금 상위 300 종목을 '최근 20거래일 안 일 −7%↓·거래대금 20일 평균 3배↑ 날이 있음/없음'으로 나눠 이후 60거래일 −20%↓ 비율을 비교(영업적자 4분기 연속 종목 제외)"} as const
export const PANIC_DAY_STATS = {
  "on": 30.6,
  "off": 20.9,
  "ctrl": 3.7,
  "months": 111,
  "first": "20170428",
  "last": "20260630",
  "tv20Top300": 11549693821
} as const
