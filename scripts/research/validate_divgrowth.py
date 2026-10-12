# -*- coding: utf-8 -*-
"""
H41: 국내 배당성장 ETF 2종이 코스피200보다 총수익이 낫고 큰 하락 구간에서 덜 빠지는가 (2026-10-12).
판정 기준은 docs/hypothesis-ledger.md H41에 결과 보기 전 고정. 네이버 수정주가(분배금 반영)라 총수익 근사.
하락 구간 정의·기준은 validate_highdiv_drawdown.py(H39)와 같다.

실행: python scripts/research/validate_divgrowth.py
"""
import json, os, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", ".research-cache")
TH = -0.15
MAIN = {"211560": "TIGER 배당성장", "211900": "KODEX 배당성장"}
REF = {"161510": "PLUS고배당주", "104530": "KIWOOM고배당", "210780": "TIGER코스피고배당"}
EXTRA = {"237370": "KODEX 배당성장채권혼합(제외·기술만)", "476850": "KoAct 배당성장액티브(제외·기술만)"}


def load(code):
    for sub in ("dividend_etfs", ""):
        p = os.path.join(ROOT, sub, f"px_{code}.json")
        if os.path.exists(p):
            return {d: float(c) for d, c in json.load(open(p, encoding="utf-8"))}
    raise FileNotFoundError(code)


idx = load("069500")
dates = sorted(idx)
ALL = {**MAIN, **REF, **EXTRA}
px = {c: load(c) for c in ALL}

# ---- ② 하락 구간 (H39와 동일)
episodes = []
peak_i, i = 0, 1
while i < len(dates):
    c = idx[dates[i]]
    if c >= idx[dates[peak_i]]:
        peak_i = i
        i += 1
        continue
    if c / idx[dates[peak_i]] - 1 <= TH:
        trough_i, j = i, i
        while j < len(dates) and idx[dates[j]] < idx[dates[peak_i]]:
            if idx[dates[j]] < idx[dates[trough_i]]:
                trough_i = j
            j += 1
        episodes.append((peak_i, trough_i, j if j < len(dates) else None))
        if j >= len(dates):
            break
        peak_i, i = j, j + 1
        continue
    i += 1

res_dd = {c: [] for c in ALL}
print("=== ② 하락 구간 방어비 (지수 −15%↑ 구간, 상품이 전부 커버한 구간만) ===")
for pi, ti, _ in episodes:
    pd_, td = dates[pi], dates[ti]
    ir = idx[td] / idx[pd_] - 1
    cells = []
    for c, nm in ALL.items():
        if pd_ in px[c] and td in px[c]:
            r = px[c][td] / px[c][pd_] - 1
            res_dd[c].append(r / ir)
            cells.append(f"{nm.split('(')[0]} {r/ir:.2f}")
    if cells:
        print(f"[{pd_}→{td}] 지수 {ir*100:+.1f}% | " + ", ".join(cells))


def dd_verdict(r):
    n = len(r)
    if n < 3:
        return f"판정 불가(구간 {n})"
    ok = sum(1 for x in r if x <= 0.80)
    worse = sum(1 for x in r if x > 1.00)
    if ok / n >= 2 / 3 and not worse:
        return f"채택(구간 {n}, ≤0.80 {ok}/{n}, >1.00 0)"
    if worse or ok / n < 0.5:
        return f"기각(구간 {n}, ≤0.80 {ok}/{n}, >1.00 {worse}개)"
    return f"혼재(구간 {n}, ≤0.80 {ok}/{n})"


# ---- ① 총수익 다중 시작점
me = {}
for i2, d in enumerate(dates):
    me[d[:6]] = d  # 월말 거래일
months = sorted(me)


def multi(code):
    p = px[code]
    out = {}
    for H, lab in ((120, "10년"), (60, "5년")):
        rows = []
        for m in months:
            y, mm = int(m[:4]), int(m[4:])
            tm = f"{y + H // 12}{mm:02d}"
            if tm not in me:
                continue
            s_, e_ = me[m], me[tm]
            if s_ in p and e_ in p:
                rows.append((m, p[e_] / p[s_], idx[e_] / idx[s_]))
        out[H] = rows
    return out


print("\n=== ① 총수익: 같은 기간 코스피200 대비 (수정주가) ===")
tot = {}
for c, nm in {**MAIN, **REF, **EXTRA}.items():
    m = multi(c)
    H = 120 if len(m[120]) >= 24 else 60
    rows = m[H]
    if not rows:
        print(f"{nm}: 시작점 없음")
        continue
    win = np.array([r[1] >= r[2] for r in rows])
    half = len(rows) // 2
    ratio = np.array([r[1] / r[2] for r in rows])
    tot[c] = (H, len(rows), win.mean(), win[:half].mean(), win[half:].mean())
    print(f"{nm}: {'10년' if H == 120 else '5년(10년 시작점 24개 미만 대체)' if c in MAIN else '5년'} n={len(rows)} ({rows[0][0]}~{rows[-1][0]}) "
          f"지수 이상 {win.mean()*100:.0f}% (전반 {win[:half].mean()*100:.0f}% / 후반 {win[half:].mean()*100:.0f}%), "
          f"끝배수 상품 {np.median([r[1] for r in rows]):.2f} vs 지수 {np.median([r[2] for r in rows]):.2f}, 상품/지수 중앙값 {np.median(ratio):.2f}")

print("\n=== 판정 (사전 기준) ===")
v1 = []
for c, nm in MAIN.items():
    H, n, w, a, b = tot[c]
    if w < 0.5:
        v = "기각"
    elif w >= 0.6 and a >= 0.5 and b >= 0.5:
        v = "채택"
    else:
        v = "혼재"
    v1.append(v)
    print(f"① {nm}: 지수 이상 {w*100:.0f}%, 전반 {a*100:.0f}%, 후반 {b*100:.0f}% → {v}")
v2 = []
for c, nm in MAIN.items():
    t = dd_verdict(res_dd[c])
    v2.append(t.split("(")[0])
    print(f"② {nm}: {t}")
allv = v1 + v2
if all(x == "채택" for x in allv):
    print("종합: 채택")
elif any(x == "기각" for x in allv):
    print("종합: 기각")
else:
    print("종합: 혼재 또는 판정 불가 — 기술만")
