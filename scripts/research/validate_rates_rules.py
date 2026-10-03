# -*- coding: utf-8 -*-
"""
금리 환경과 안전자산 규칙 / 시작 금리와 인출 (2026-10-03).
규칙은 결과를 보기 전에 하나로 고정한다(튜닝 없음):
  R1 "금리 방어": 주식 60% + 안전자산 40%. 안전자산은 평소 10년 국채, 단 (10년 금리 12개월 변화 > +0.5%p) 또는 (장단기 역전)이면 그 달은 현금성(3개월물)으로 둔다. 매월 판단(직전 월말 정보).
  기준: 정적 60/40(10년 국채), 정적 60/40(현금성), 주식 100.
데이터: Shiller 1962~2023 월별(주식 총수익·합성 10년채·GS10) + 야후 ^IRX 월말(.research-cache/yh_IRX_me.json). 명목, 세금·비용 없음.
검증 1: 규칙 vs 정적 — 연환산, 최대낙폭, 최악 12개월, 시대별(1962~1981, 1982~2001, 2002~2023) 연환산.
검증 2: 인출 — 시작 시점 10년 금리 수준(3분위)별 60/40 30년 안전 인출률(실패율 0%·≤5%)과, R1 구성에서의 인출 실패율. validate_retirement_withdrawal.simulate는 실질 수익률 기준이라 CPI로 실질화한 월 수익률을 쓴다.
한계: 규칙은 사후에 만든 것이 아니라 단일 사양이지만 금리 정의(±0.5%p)는 앞선 점검에서 정한 값이다. 인상기·역전기 표본이 짧고, 과거 평균이 미래를 보장하지 않는다.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R, bond_returns  # noqa: E402
from validate_retirement_withdrawal import simulate  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import xlrd
sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
rows = {}
for r in range(8, sh.nrows):
    v = sh.cell_value(r, 0)
    if not isinstance(v, float): continue
    y, m = int(v), int(round((v - int(v)) * 100))
    if not 1 <= m <= 12: continue
    vals = [sh.cell_value(r, c) for c in (1, 2, 4, 6)]
    if all(isinstance(x, float) for x in vals):
        rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], cpi=vals[2], gs10=vals[3])
irx = json.load(open(".research-cache/yh_IRX_me.json"))
ms_all = sorted(rows)
b10 = bond_returns({m: rows[m]["gs10"] for m in ms_all}, ms_all, 10)
ms = [m for m in ms_all if m >= "196101" and m in irx]
stock, bond, cash, cpi, gs, ir = [], [], [], [], [], []
for i in range(1, len(ms)):
    m, pm = ms[i], ms[i - 1]
    stock.append(rows[m]["p"] / rows[pm]["p"] - 1 + rows[m]["d"] / 12 / rows[pm]["p"])
    bond.append(b10[m]); cash.append(irx[pm] / 100 / 12)  # 전월말 금리로 한 달 이자
    cpi.append(rows[m]["cpi"] / rows[pm]["cpi"] - 1)
    gs.append(rows[m]["gs10"]); ir.append(irx[m])
mm = ms[1:]
stock, bond, cash, cpi, gs, ir = map(np.array, (stock, bond, cash, cpi, gs, ir))
n = len(mm)
chg12 = np.full(n, np.nan); chg12[12:] = gs[12:] - gs[:-12]
slope = gs - ir
# R1: 직전 월말 정보로 이번 달 안전자산 결정
flag = np.zeros(n, bool)  # True이면 현금성
for t in range(1, n):
    flag[t] = (not np.isnan(chg12[t - 1]) and chg12[t - 1] > 0.5) or slope[t - 1] < 0
safe_r1 = np.where(flag, cash, bond)
print(f"표본 {mm[0]}~{mm[-1]} ({n}개월). 규칙이 현금성을 택한 달 {flag.sum()}개({flag.mean()*100:.0f}%)")

def stats(r, lo=None, hi=None):
    sel = np.ones(n, bool)
    if lo: sel &= np.array(mm) >= lo
    if hi: sel &= np.array(mm) <= hi
    x = r[sel]; p = np.cumprod(1 + x); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]
    r12 = np.array([np.prod(1 + x[i:i + 12]) - 1 for i in range(len(x) - 11)])
    return (p[-1] ** (12 / len(x)) - 1) * 100, ((p / pk - 1).min()) * 100, r12.min() * 100
cands = {"주식 100%": stock, "정적 60/40(국채)": 0.6 * stock + 0.4 * bond, "정적 60/40(현금성)": 0.6 * stock + 0.4 * cash, "R1 금리 방어 60/40": 0.6 * stock + 0.4 * safe_r1}
print("\n=== 검증 1: 규칙 vs 정적 (명목) ===")
print(f"{'구성':20s} {'연환산':>7s} {'최대낙폭':>8s} {'최악12개월':>9s} | 1961~1981 | 1982~2001 | 2002~2023 (연환산/최대낙폭)")
for nm, r in cands.items():
    a = stats(r)
    e = [stats(r, lo, hi) for lo, hi in (("196101", "198112"), ("198201", "200112"), ("200201", "202312"))]
    print(f"{nm:20s} {a[0]:6.1f}% {a[1]:7.1f}% {a[2]:8.1f}% | " + " | ".join(f"{x[0]:4.1f}/{x[1]:5.0f}%" for x in e))

# 검증 2: 인출(실질). 월 실질 수익률
def real(x): return (1 + x) / (1 + cpi) - 1
rs = real(stock)
rb_s = {"정적 60/40(국채)": real(bond), "R1 금리 방어": real(safe_r1)}
print("\n=== 검증 2: 30년 인출 실패율(%) — 연 인출률별 (실질, 비례 인출, 연 리밸런싱) ===")
rates = [3.5, 4.0, 4.5, 5.0, 6.0]
months = 360
print(f"{'구성':20s}" + "".join(f"{r:>7.1f}%" for r in rates))
for nm, rb in rb_s.items():
    line = f"{nm:20s}"
    for rt in rates:
        f = 0; tot = 0
        for s0 in range(0, n - months + 1):
            dep, *_ = simulate(rs[s0:s0 + months], rb[s0:s0 + months], 0.6, rt, months, "prop"); f += dep is not None; tot += 1
        line += f"{f / tot * 100:>8.0f}"
    print(line + f"   (시작 {tot}개월)")
print("\n시작 시점 10년 금리 3분위별 정적 60/40(국채) 30년 실패율(%)")
gq = np.quantile(gs, [1 / 3, 2 / 3])
print(f"{'시작 금리':20s}" + "".join(f"{r:>7.1f}%" for r in rates))
for nm, lo, hi in (("낮음", -1, gq[0]), ("중간", gq[0], gq[1]), ("높음", gq[1], 99)):
    idx = [s0 for s0 in range(0, n - months + 1) if lo < gs[s0] <= hi]
    line = f"{nm}({gs[idx].min():.1f}~{gs[idx].max():.1f}%) "[:20].ljust(20)
    for rt in rates:
        f = sum(simulate(rs[s0:s0 + months], rb_s["정적 60/40(국채)"][s0:s0 + months], 0.6, rt, months, "prop")[0] is not None for s0 in idx)
        line += f"{f / len(idx) * 100:>8.0f}"
    print(line + f"   (시작 {len(idx)}개월)")
