# -*- coding: utf-8 -*-
"""validate_avoid_scan.py 결과(.research-cache/avoid_scan_summary.json, H84 ⓔ 투매일) → web/src/data/panicDayStats.ts.
화면 '최근 급락 흔적'의 참고 수치. 손으로 고치지 말고 검증을 다시 돌린 뒤 이 스크립트로 만든다."""
import json

H = json.load(open(".research-cache/avoid_scan_summary.json", encoding="utf-8"))
e = H["cands"]["e"]
stats = {
    "on": round(e["on"] * 100, 1),          # 투매일 있음: 이후 60거래일 −20%↓ 비율
    "off": round(e["off"] * 100, 1),        # 없음
    "ctrl": round(e["cd"] * 100, 1),        # 변동성 3분위 통제 후 차이(%p)
    "months": e["n"],
    "first": e["first"],
    "last": e["last"],
    "tv20Top300": round(H["tv20Top300"]),   # 거래대금 상위 300위의 20일 평균 거래대금(원)
}
meta = {"generated": H["generated"], "source": "가설 장부 H84 ⓔ · scripts/research/validate_avoid_scan.py",
        "method": "월말마다 거래대금 상위 300 종목을 '최근 20거래일 안 일 −7%↓·거래대금 20일 평균 3배↑ 날이 있음/없음'으로 나눠 이후 60거래일 −20%↓ 비율을 비교(영업적자 4분기 연속 종목 제외)"}
ts = ("// 자동 생성: scripts/research/build_panic_day_stats.py — 직접 고치지 말 것\n"
      f"export const PANIC_DAY_META = {json.dumps(meta, ensure_ascii=False)} as const\n"
      f"export const PANIC_DAY_STATS = {json.dumps(stats, ensure_ascii=False, indent=2)} as const\n")
open("web/src/data/panicDayStats.ts", "w", encoding="utf-8").write(ts)
print("web/src/data/panicDayStats.ts")
