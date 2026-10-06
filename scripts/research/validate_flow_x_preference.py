# -*- coding: utf-8 -*-
"""C27 선호 점수 × 외국인 수급. 기준은 hypothesis-ledger C27에 결과 보기 전 고정."""
import pickle, json, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_trader_paths as _  # noqa  (nw_t 용)
vt = _
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
C = ".research-cache/"
px = pickle.load(open(C + "px.pkl", "rb")); fh = json.load(open(C + "stock_flow_hist.json"))
SPLIT = "20220101"
data = {}
for code, rows in fh.items():
    v = px.get(code)
    if not v or len(rows) < 400:
        continue
    d = {r[0]: r for r in v}
    ds = [x for x in sorted(rows) if x in d and rows[x][2] is not None and rows[x][0]]
    if len(ds) < 400:
        continue
    cl = np.array([d[x][4] for x in ds], float); hi = np.array([d[x][2] for x in ds], float); vo = np.array([d[x][5] for x in ds], float)
    op = np.array([d[x][1] for x in ds], float)
    fval = np.array([rows[x][2] * rows[x][0] for x in ds], float)
    if (cl <= 0).any(): continue
    if (np.abs(np.diff(cl) / cl[:-1]) > 0.31).any(): continue
    data[code] = dict(ds=ds, c=cl, h=hi, o=op, tv=cl * vo, f=fval)
print("종목", len(data), flush=True)
alld = sorted({x for v in data.values() for x in v["ds"]})
rec = {"hi_hi": [], "hi_lo": [], "all_hi_lo": []}
for k in range(260, len(alld) - 21, 5):
    t = alld[k]; e_d = alld[k + 1]; x_d = alld[k + 20]
    rows = []
    for code, v in data.items():
        ds = v["ds"]
        try:
            i = ds.index(t); ie = ds.index(e_d); ix = ds.index(x_d)
        except ValueError:
            continue
        if i < 250: continue
        c = v["c"]
        r1 = c[i - 19:i + 1] / c[i - 20:i] - 1
        vol = r1.std(); near = c[i] / v["h"][i - 249:i + 1].max()
        flow = v["f"][i - 59:i + 1].sum() / max(v["tv"][i - 59:i + 1].sum(), 1)
        y = c[ix] / v["o"][ie] - 1
        rows.append((vol, near, flow, y))
    if len(rows) < 60: continue
    a = np.array(rows)
    a = a[np.isfinite(a).all(axis=1)]
    if len(a) < 60: continue
    rk = lambda x: np.argsort(np.argsort(x)) / (len(x) - 1)
    pref = (rk(-a[:, 0]) + rk(a[:, 1])) / 2
    fl = rk(a[:, 2]); ex = a[:, 3] - a[:, 3].mean()
    top = pref >= np.percentile(pref, 60)
    hh = top & (fl >= 0.6); hl = top & (fl <= 0.4)
    if hh.sum() >= 3 and hl.sum() >= 3:
        rec["hi_hi"].append((e_d, ex[hh].mean())); rec["hi_lo"].append((e_d, ex[hl].mean()))
        rec["all_hi_lo"].append((e_d, ex[fl >= 0.6].mean() - ex[fl <= 0.4].mean()))


def st(L):
    a = np.array([v for d, v in L if d < SPLIT]); b = np.array([v for d, v in L if d >= SPLIT])
    return a.mean(), vt.nw_t(a, 4), b.mean(), vt.nw_t(b, 4), len(a), len(b)


diff = [(d, a - b) for (d, a), (_, b) in zip(rec["hi_hi"], rec["hi_lo"])]
for name, L in (("선호 상위40%·수급 상위40%", rec["hi_hi"]), ("선호 상위40%·수급 하위40%", rec["hi_lo"]), ("차이(수급 상위−하위, 선호 상위 안)", diff), ("수급 상위−하위(전체 종목)", rec["all_hi_lo"])):
    a, at, b, bt, na, nb = st(L)
    print(f"{name:<30} 안 {a*100:+.2f}% (t {at:.1f}, n={na}) · 밖 {b*100:+.2f}% (t {bt:.1f}, n={nb})")
