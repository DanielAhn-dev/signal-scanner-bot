// 자동 생성: scripts/research/build_disclosure_stats.py — 직접 고치지 말 것
export const DISCLOSURE_STATS_META = {"generated": "2026-10-08", "period": "20140102~20261006", "method": "접수일 다음 거래일 시가 진입, KODEX 200 대비 초과, 비용 미반영, 같은 종목·범주 60거래일 안 반복 1건", "source": "가설 장부 C42~C44 · scripts/research/validate_disclosure_events.py"} as const
export const DISCLOSURE_STATS: Record<string, { n: number; mean60: number; median60: number; tail30: number; tail30Base: number; nTop300: number; verdict: string }> = {
  "dilution": {
    "n": 6561,
    "mean60": -6.0,
    "median60": -11.5,
    "tail30": 21.3,
    "tail30Base": 10.0,
    "nTop300": 1340,
    "verdict": "기각/판정 미달"
  },
  "buyback": {
    "n": 1191,
    "mean60": 1.7,
    "median60": -0.6,
    "tail30": 6.9,
    "tail30Base": 10.0,
    "nTop300": 266,
    "verdict": "기각"
  },
  "admin": {
    "n": 194,
    "mean60": 5.5,
    "median60": -0.6,
    "tail30": 16.0,
    "tail30Base": 6.6,
    "nTop300": 39,
    "verdict": "기각/판정 미달"
  },
  "admin_warn": {
    "n": 119,
    "mean60": -2.5,
    "median60": -12.9,
    "tail30": 26.9,
    "tail30Base": 10.7,
    "nTop300": 21,
    "verdict": "기각/판정 미달"
  },
  "review": {
    "n": 186,
    "mean60": -0.4,
    "median60": -7.0,
    "tail30": 19.4,
    "tail30Base": 9.7,
    "nTop300": 36,
    "verdict": "기각/판정 미달"
  },
  "unfaithful": {
    "n": 1024,
    "mean60": -7.3,
    "median60": -11.0,
    "tail30": 19.4,
    "tail30Base": 10.7,
    "nTop300": 242,
    "verdict": "기각/판정 미달"
  },
  "capital_cut": {
    "n": 326,
    "mean60": -12.7,
    "median60": -10.3,
    "tail30": 30.1,
    "tail30Base": 24.5,
    "nTop300": 65,
    "verdict": "기각/판정 미달"
  },
  "audit": {
    "n": 14,
    "mean60": -15.5,
    "median60": -8.0,
    "tail30": 21.4,
    "tail30Base": 18.8,
    "nTop300": 2,
    "verdict": "기각/판정 미달"
  }
}
