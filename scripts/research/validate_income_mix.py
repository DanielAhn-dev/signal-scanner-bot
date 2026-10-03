# -*- coding: utf-8 -*-
"""
인컴 계좌 내부 구성 점검 (2026-10-03) — 고배당 ETF와 커버드콜 ETF를 섞는 비율에 따라 분배율·총수익·낙폭이 어떻게 달라지나.
데이터: 수정주가(분배금 반영) + 실제 분배금 이력(validate_income_then_growth.reconstruct로 분배율 역산). 고배당 PLUS(161510) / KIWOOM(104530) / TIGER(210780), 커버드콜 TIGER200CC(289480) / RISE ATM(290080), 지수 KODEX200.
공통 구간(분배금 이력이 있는 2022-04~2026-09, 약 54개월)만 쓴다. 한국 강세장 위주라 방향만 본다. 세금·수수료 제외.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly, reconstruct  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PX = {"161510": ".research-cache/px_161510.json", "104530": ".research-cache/dividend_etfs/px_104530.json", "210780": ".research-cache/dividend_etfs/px_210780.json",
      "289480": ".research-cache/dividend_etfs/px_289480.json", "290080": ".research-cache/dividend_etfs/px_290080.json"}
idx = monthly(".research-cache/index_etfs/px_069500.json")
data = {}
for c, p in PX.items():
    adj = monthly(p)
    divs = json.load(open(f".research-cache/div_{c}.json", encoding="utf-8"))
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
    data[c] = (adj, divs, first)
start = max(v[2] for v in data.values())
ms = [m for m in sorted(idx) if m >= start and all(m in v[0] for v in data.values())]
tr, yl = {}, {}
for c, (adj, divs, _) in data.items():
    sub = {m: adj[m] for m in sorted(adj) if m >= start and m in idx}
    mm, real, y = reconstruct(sub, divs)
    tr[c] = np.array([sub[mm[i]] / sub[mm[i-1]] - 1 for i in range(1, len(mm))])
    yl[c] = np.array([y[mm[i]] for i in range(1, len(mm))])
n = min(len(v) for v in tr.values())
ri = np.array([idx[ms[i]] / idx[ms[i-1]] - 1 for i in range(1, len(ms))])[-n:]
tr = {c: v[-n:] for c, v in tr.items()}; yl = {c: v[-n:] for c, v in yl.items()}
print(f"공통 {ms[-n-1]}~{ms[-1]} ({n}개월)")

def stats(r, y):
    p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]
    return (p[-1] - 1) * 100, (p / pk - 1).min() * 100, y.mean() * 12 * 100, r.std() * 100

print(f"{'구성':28s} {'총수익':>7s} {'최대낙폭':>8s} {'평균 분배율(연)':>14s} {'월 변동성':>8s}")
rows = [("지수 KODEX200", ri, np.full(n, 0.023 / 12))]
for c, nm in (("161510", "고배당 PLUS"), ("104530", "고배당 KIWOOM"), ("210780", "고배당 TIGER"), ("289480", "커버드콜 TIGER200"), ("290080", "커버드콜 RISE ATM")):
    rows.append((nm, tr[c], yl[c]))
hd = (tr["161510"] + tr["104530"] + tr["210780"]) / 3; hdy = (yl["161510"] + yl["104530"] + yl["210780"]) / 3
cc = (tr["289480"] + tr["290080"]) / 2; ccy = (yl["289480"] + yl["290080"]) / 2
rows.append(("고배당 3종 균등", hd, hdy)); rows.append(("커버드콜 2종 균등", cc, ccy))
for w in (25, 50, 75):
    rows.append((f"고배당 {100-w}% + 커버드콜 {w}%", (1 - w/100) * hd + w/100 * cc, (1 - w/100) * hdy + w/100 * ccy))
for w in (50,):
    rows.append((f"인컴(50:50) 70% + 지수 30%", 0.7 * (0.5*hd+0.5*cc) + 0.3 * ri, 0.7 * (0.5*hdy+0.5*ccy) + 0.3 * 0.023/12))
for name, r, y in rows:
    t, d, yy, sd = stats(r, y)
    print(f"{name:28s} {t:+6.0f}% {d:7.1f}% {yy:13.1f}% {sd:7.1f}%")
