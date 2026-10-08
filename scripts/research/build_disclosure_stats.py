# -*- coding: utf-8 -*-
"""validate_disclosure_events.py 결과(.research-cache/disclosure_events_summary.json) → web/src/data/disclosureStats.ts.
화면 '이 종목 공시 점검'의 참고 수치. 손으로 고치지 말고 검증을 다시 돌린 뒤 이 스크립트로 만든다.
수치는 전체 종목 범위(사용자가 어떤 종목이든 물을 수 있으므로), 60거래일 기준."""
import json

S = json.load(open(".research-cache/disclosure_events_summary.json", encoding="utf-8"))
out = {}
for cat, v in S["cats"].items():
    a = v.get("all", {}).get("60")
    t = v.get("top300", {}).get("60")
    if not a:
        continue
    out[cat] = {
        "n": a["n"],
        "mean60": round(a["mean"] * 100, 1),
        "median60": round(a["median"] * 100, 1),
        "tail30": round(a.get("tail30", 0) * 100, 1),
        "tail30Base": round(a.get("tail30_base", 0) * 100, 1),
        "nTop300": t["n"] if t else 0,
        "verdict": v.get("verdict", ""),
    }
meta = {"generated": S["generated"], "period": S["period"], "method": S["method"],
        "source": "가설 장부 C42~C44 · scripts/research/validate_disclosure_events.py"}
ts = ("// 자동 생성: scripts/research/build_disclosure_stats.py — 직접 고치지 말 것\n"
      f"export const DISCLOSURE_STATS_META = {json.dumps(meta, ensure_ascii=False)} as const\n"
      f"export const DISCLOSURE_STATS: Record<string, {{ n: number; mean60: number; median60: number; tail30: number; tail30Base: number; nTop300: number; verdict: string }}> = {json.dumps(out, ensure_ascii=False, indent=2)}\n")
open("web/src/data/disclosureStats.ts", "w", encoding="utf-8").write(ts)
print("web/src/data/disclosureStats.ts", len(out), "범주")
