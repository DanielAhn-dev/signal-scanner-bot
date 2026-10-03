# -*- coding: utf-8 -*-
"""
미국 금리 환경별 자산 성과 (2026-10-03) — 금리가 오르거나 내릴 때, 단기금리와 장기금리가 각각 어떻게 영향을 줬나.
표본 3개:
  A) 1926~2023 (Shiller) — 장기금리(GS10) 12개월 변화/수준별 주식·10년채 월수익(명목). 단기금리 자료는 없음.
  B) 1962~2023 — 단기금리(^IRX 3개월물 야후)와 장기금리(GS10)를 함께: 현금성(IRX)·10년채·주식. 금리 인상기/인하기/횡보와 장단기 금리차(역전).
  C) 2010-10~2026-08 (mixData 원화 환산 + ^TNX) — 코스피200·S&P500·나스닥100·미국장기채·국채10년(한국)·금 — 장기금리가 오르는 구간/내리는 구간, 그리고 금리 변화 1%p당 월수익 민감도(β).
정의: 인상기 = 3개월물 12개월 변화 > +1.0%p, 인하기 < −1.0%p, 그 외 횡보. 장기금리 상승 = 10년물 12개월 변화 > +0.5%p, 하락 < −0.5%p.
한계: 겹치는 창이고, 금리 환경은 경기·물가와 겹쳐 있어 '금리 때문'이라고 인과로 읽으면 안 된다. 채권 수익은 10년 합성(validate_long_run.bond_returns).
"""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R, bond_returns  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def shiller():
    import xlrd
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    rows = {}
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float): continue
        y, m = int(v), int(round((v - int(v)) * 100))
        if not 1 <= m <= 12: continue
        vals = [sh.cell_value(r, c) for c in (1, 2, 6)]
        if all(isinstance(x, float) for x in vals):
            rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], gs10=vals[2])
    ms = sorted(rows)
    b10 = bond_returns({m: rows[m]["gs10"] for m in ms}, ms, 10)
    out = {}
    for i in range(1, len(ms)):
        m, pm = ms[i], ms[i - 1]
        out[m] = dict(stock=rows[m]["p"] / rows[pm]["p"] - 1 + rows[m]["d"] / 12 / rows[pm]["p"], bond=b10[m], gs10=rows[m]["gs10"])
    return out

def yh(fn):
    return dict(json.load(open(f".research-cache/yh_{fn}_me.json")))

def ann(r): return (np.prod(1 + r) ** (12 / len(r)) - 1) * 100 if len(r) else float('nan')
def report(title, arrs, mask_sets):
    print(f"\n--- {title} ---")
    print(f"{'환경':16s} {'개월':>5s} " + " ".join(f"{k:>12s}" for k in arrs))
    for name, mk in mask_sets:
        n = int(mk.sum())
        if n < 12: continue
        print(f"{name:16s} {n:>5d} " + " ".join(f"{ann(a[mk]):>11.1f}%" for a in arrs.values()))

# ===== A) 장기금리, 1926~2023
S = shiller(); ms = sorted(S)
st = np.array([S[m]["stock"] for m in ms]); bd = np.array([S[m]["bond"] for m in ms]); gs = np.array([S[m]["gs10"] for m in ms])
chg12 = np.full(len(ms), np.nan); chg12[12:] = gs[12:] - gs[:-12]
valid = ~np.isnan(chg12)
print(f"A) 미국 1926~2023 {ms[0]}~{ms[-1]} — 10년 금리 12개월 변화별 연환산 수익(명목)")
report("장기금리 12개월 변화", {"주식": st[valid], "10년채": bd[valid]},
       [("상승(>+0.5%p)", chg12[valid] > 0.5), ("횡보", np.abs(chg12[valid]) <= 0.5), ("하락(<−0.5%p)", chg12[valid] < -0.5), ("급등(>+1.5%p)", chg12[valid] > 1.5)])
q = np.quantile(gs, [0.25, 0.5, 0.75])
fw = lambda a, h: np.array([np.prod(1 + a[i:i + h]) ** (12 / h) - 1 for i in range(len(a) - h + 1)]) * 100
f5s, f5b = fw(st, 60), fw(bd, 60); gs0 = gs[:len(f5s)]
print("\n시작 시점 10년 금리 수준별, 이후 5년 연환산 수익(중앙값, 명목) — 채권은 시작 금리와 거의 같게 나온다")
for nm, lo, hi in (("하위 25%(금리 낮음)", -1, q[0]), ("25~50%", q[0], q[1]), ("50~75%", q[1], q[2]), ("상위 25%(금리 높음)", q[2], 99)):
    mk = (gs0 > lo) & (gs0 <= hi)
    print(f"{nm:20s} 금리 {gs0[mk].min():.1f}~{gs0[mk].max():.1f}%  시작수 {mk.sum():>4d}  주식 {np.median(f5s[mk]):5.1f}%  10년채 {np.median(f5b[mk]):5.1f}%  주식이 채권보다 나쁜 시작 {(f5s[mk] < f5b[mk]).mean()*100:3.0f}%")

# ===== B) 1985~2023 단기금리 포함
irx = yh("IRX")
mB = [m for m in ms if m >= "196201" and m in irx]
stB = np.array([S[m]["stock"] for m in mB]); bdB = np.array([S[m]["bond"] for m in mB]); gsB = np.array([S[m]["gs10"] for m in mB])
ir = np.array([irx[m] for m in mB]); cash = ir / 100 / 12
d12 = np.full(len(mB), np.nan); d12[12:] = ir[12:] - ir[:-12]
v = ~np.isnan(d12); slope = gsB - ir
print(f"\nB) 단기금리 포함 {mB[0]}~{mB[-1]} ({len(mB)}개월) — 3개월물 12개월 변화별 연환산(명목)")
report("단기금리(3개월물) 변화", {"주식": stB[v], "10년채": bdB[v], "현금성": cash[v]},
       [("인상기(>+1%p)", d12[v] > 1.0), ("횡보", np.abs(d12[v]) <= 1.0), ("인하기(<−1%p)", d12[v] < -1.0)])
report("장단기 금리차(10년−3개월)", {"주식": stB, "10년채": bdB, "현금성": cash},
       [("역전(<0)", slope < 0), ("평탄(0~1%p)", (slope >= 0) & (slope < 1)), ("정상(≥1%p)", slope >= 1)])
print("\n다음 12개월 수익(시작 시점 환경별, 중앙값 %): 주식 / 10년채 / 현금성")
for nm, mk in (("인상기", d12 > 1.0), ("인하기", d12 < -1.0), ("역전", slope < 0), ("정상", slope >= 1)):
    idx = [i for i in range(len(mB) - 12) if mk[i] and not np.isnan(d12[i])]
    if len(idx) < 12: continue
    f = lambda a: np.median([np.prod(1 + a[i + 1:i + 13]) - 1 for i in idx]) * 100
    print(f"{nm:8s} 시작 {len(idx):>3d}개월  주식 {f(stB):5.1f}  10년채 {f(bdB):5.1f}  현금성 {f(cash):5.1f}")

# ===== C) 2010~2026 원화 환산 자산 + ^TNX
tnx = yh("TNX"); txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
mix = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(txt[txt.index("= [{") + 2: txt.rindex("]") + 1])}
ids = ["kospi200", "sp500", "nasdaq100", "usbond20", "kbond10", "gold"]
nm_kr = {"kospi200": "코스피200", "sp500": "S&P500", "nasdaq100": "나스닥100", "usbond20": "미국장기채", "kbond10": "국채10년", "gold": "금"}
mC = [m for m in sorted(mix["kospi200"]) if m >= "201010" and all(m in mix[i] for i in ids) and m in tnx]
rC = {i: np.array([mix[i][mC[k]] / mix[i][mC[k - 1]] - 1 for k in range(1, len(mC))]) for i in ids}
t10 = np.array([tnx[m] for m in mC])[1:]; dt = np.diff(np.array([tnx[m] for m in mC]))
c6 = np.full(len(t10), np.nan); c6[6:] = t10[6:] - t10[:-6]
vv = ~np.isnan(c6)
print(f"\nC) 2010-10~2026-08 원화 환산 {len(mC)-1}개월 — 10년 금리(^TNX) 6개월 변화별 연환산")
report("장기금리 6개월 변화", {nm_kr[i]: rC[i][vv] for i in ids}, [("상승(>+0.5%p)", c6[vv] > 0.5), ("횡보", np.abs(c6[vv]) <= 0.5), ("하락(<−0.5%p)", c6[vv] < -0.5)])
print("\n월 금리 변화 1%p당 월수익 민감도(β, %p): 양수=금리 오를 때 오름, 음수=금리 오를 때 내림")
print(f"{'자산':10s} {'전체':>8s} {'2022년':>8s} {'2025~':>8s}")
mm = np.array(mC[1:])
for i in ids:
    out = []
    for sel in (np.ones(len(dt), bool), (mm >= "202201") & (mm <= "202212"), mm >= "202501"):
        if sel.sum() < 6: out.append(float('nan')); continue
        b = np.polyfit(dt[sel], rC[i][sel] * 100, 1)[0]; out.append(b)
    print(f"{nm_kr[i]:10s} {out[0]:8.2f} {out[1]:8.2f} {out[2]:8.2f}")
print(f"\n참고: ^TNX 최근 {mC[-1]} {tnx[mC[-1]]:.2f}%, ^IRX {irx.get(mC[-1], float('nan')):.2f}% , 10년−3개월 {tnx[mC[-1]] - irx.get(mC[-1], np.nan):+.2f}%p")
