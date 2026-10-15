# -*- coding: utf-8 -*-
"""
H52(V2): 미국 저변동·퀄리티 팩터 ETF가 SPY보다 낙폭을 줄이면서 수익 손해가 작은가.
H53(V1): 코스피200 동일가중이 시가총액가중보다 수익·낙폭에서 나은가. (2026-10-15)
판정 기준은 hypothesis-ledger.md H52·H53에 결과 보기 전 고정(커밋 후 이 스크립트 작성).
데이터: .research-cache/factor_etfs/ (fetch_factor_etfs.py), allweather/us_SPY.json·kr_069500.json. 월말값.
  미국은 야후 수정종가(분배금 재투자), 한국은 네이버 수정주가(분배금 반영) — 둘 다 총수익에 가깝다.
출력: .research-cache/factor_etfs_out.txt
"""
import json, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
OUT = C + "factor_etfs_out.txt"
END = "202609"
lines = []


def say(s=""):
    print(s)
    lines.append(s)


def month_end(rows, col=1):
    m = {}
    for r in rows:
        m[r[0][:6]] = r[col]
    return m


def load_us(sym):
    path = C + ("allweather/us_SPY.json" if sym == "SPY" else f"factor_etfs/us_{sym}.json")
    return month_end(json.load(open(path)))


def load_kr(code):
    path = C + ("allweather/kr_069500.json" if code == "069500" else f"factor_etfs/kr_{code}.json")
    return month_end(json.load(open(path)))


def stats(vals, months):
    p = np.array([vals[m] for m in months], float)
    yrs = (len(p) - 1) / 12
    cagr = (p[-1] / p[0]) ** (1 / yrs) - 1
    mdd = (p / np.maximum.accumulate(p) - 1).min()
    return cagr, mdd


def compare(name, a, b, label_a, label_b, start_after=True):
    months = sorted(m for m in a if m in b and m <= END)
    if start_after:
        months = months[1:]  # 상장 첫 달은 월중 시작이라 뺀다
    half = len(months) // 2
    full_a, full_b = stats(a, months), stats(b, months)
    h1 = (stats(a, months[:half + 1]), stats(b, months[:half + 1]))
    h2 = (stats(a, months[half:]), stats(b, months[half:]))
    say(f"\n[{name}] {months[0]}~{months[-1]} ({len(months)}개월), 반으로 나눈 경계 {months[half]}")
    say(f"  전체: {label_a} CAGR {full_a[0]*100:.2f}% MDD {full_a[1]*100:.1f}% | {label_b} {full_b[0]*100:.2f}% {full_b[1]*100:.1f}%"
        f" → CAGR 차 {(full_a[0]-full_b[0])*100:+.2f}%p · MDD 차 {(full_a[1]-full_b[1])*100:+.1f}%p(양수 = 얕음)")
    for nm, (x, y) in (("앞 절반", h1), ("뒤 절반", h2)):
        say(f"  {nm}: CAGR 차 {(x[0]-y[0])*100:+.2f}%p · MDD {x[1]*100:.1f}% vs {y[1]*100:.1f}%")
    return full_a, full_b, h1, h2


# ── H52 ─────────────────────────────────────────────
say("=== H52 미국 팩터 ETF vs SPY (달러, 분배금 재투자) ===")
spy = load_us("SPY")
verdict52 = {}
for sym in ["USMV", "QUAL", "SPLV", "SPHQ", "MTUM", "VLUE", "RSP", "IWD", "IWF", "IWM"]:
    f = load_us(sym)
    fa, fb, h1, h2 = compare(sym + (" (주 판정)" if sym in ("USMV", "QUAL") else " (보조)"), f, spy, sym, "SPY")
    ok = (fa[1] - fb[1] >= 0.02) and (fa[0] - fb[0] >= -0.005) and (h1[0][0] - h1[1][0] >= -0.01) and (h2[0][0] - h2[1][0] >= -0.01)
    verdict52[sym] = ok
    if sym in ("USMV", "QUAL"):
        # 보조: SPY 50:50 혼합(매월 재조정)
        months = sorted(m for m in f if m in spy and m <= END)[1:]
        mix, v = {}, 1.0
        mix[months[0]] = v
        for p, q in zip(months, months[1:]):
            v *= 0.5 * f[q] / f[p] + 0.5 * spy[q] / spy[p]
            mix[q] = v
        c, d = stats(mix, months), stats(spy, months)
        say(f"  보조 SPY 50:50 혼합: CAGR 차 {(c[0]-d[0])*100:+.2f}%p · MDD {c[1]*100:.1f}% vs {d[1]*100:.1f}%")

say("\n[판정 — H52 사전 기준] (MDD 2%p 이상 얕음 + CAGR 손해 0.5%p 이내 + 두 절반 모두 CAGR 손해 1%p 이내)")
for sym in ("USMV", "QUAL"):
    say(f"  {sym}: {'통과' if verdict52[sym] else '기각'}")
if verdict52["USMV"] != verdict52["QUAL"]:
    say("  하나만 통과 → '약한 근거'")
say("  보조 ETF(판정 외) 기준 충족: " + (", ".join(s for s, ok in verdict52.items() if ok and s not in ("USMV", "QUAL")) or "없음"))

# ── H53 ─────────────────────────────────────────────
say("\n=== H53 코스피200 동일가중 vs KODEX 200 (원, 분배금 반영 수정주가) ===")
k200 = load_kr("069500")
res53 = {}
for code, nm in (("252650", "KODEX 200동일가중 (주 판정)"), ("252000", "TIGER 200동일가중 (보조)")):
    res53[code] = compare(nm, load_kr(code), k200, "동일가중", "KODEX 200")
fa, fb, h1, h2 = res53["252650"]
ok53 = (h1[0][0] - h1[1][0] >= 0.01) and (h2[0][0] - h2[1][0] >= 0.01) and (fa[1] >= fb[1])
say("\n[판정 — H53 사전 기준] (두 절반 모두 CAGR 1%p 이상 높음 + 전체 MDD 같거나 얕음)")
say(f"  KODEX 200동일가중: {'통과' if ok53 else '기각'}")
say("  한계: 미국 13~15년·한국 10년 표본, 큰 하락은 2020·2022 정도, 한국 뒤 절반은 반도체 대형주 쏠림 장세")

open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
