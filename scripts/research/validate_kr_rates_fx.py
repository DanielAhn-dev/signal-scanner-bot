# -*- coding: utf-8 -*-
"""
한국 단기금리(CD91)·환율(원/달러) 환경별 자산 성과 (2026-10-04).
금리 환경: CD91 12개월 변화 > +0.75%p 인상기, < −0.75%p 인하기, 그 외 횡보(한국 금리는 변동 폭이 작아 미국 기준 1.0%p보다 낮게 잡음).
환율 환경: 원/달러 12개월 변화 > +7% 원화 약세, < −7% 원화 강세, 그 외 횡보.
자산(월말 기준 월수익): 코스피200(069500), 한국 국고채10년(148070), S&P500 원화 환산(SPY×환율), S&P500 달러(SPY), 금 원화 환산(GLD×환율), 현금(CD91÷12).
표본: 한국 채권 ETF가 2011-10부터라 2011-10~2026-09. 코스피200·SPY·금·현금만은 2004-12~(원/달러 시작)로 더 길게 따로 본다.
한계: 겹치는 12개월 변화 구간이라 독립 표본이 적고, 금리·환율은 경기와 같이 움직여 인과로 읽으면 안 된다. 가격은 수정주가(분배금 반영) 기준.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
A = ".research-cache/allweather/"

def me(fn, col=1):
    d = json.load(open(A + fn + ".json")); d.sort(key=lambda r: r[0]); o = {}
    for r in d: o[r[0][:6]] = float(r[col])
    return o

cd = me("cd91"); fx = me("us_KRW_X"); k200 = me("kr_069500"); bond = me("kr_148070")
spy = me("us_SPY", 2); gld = me("us_GLD", 2)  # 수정종가 열
ms_all = sorted(set(cd) & set(fx) & set(k200) & set(spy) & set(gld))
# 마지막 월이 불완전할 수 있어 환율 마지막 달(2026-09) 이내로 제한
ms_all = [m for m in ms_all if m <= max(fx)]

def build(ms):
    def idx(m, k): return ms.index(m) - k
    rows = []
    for i in range(12, len(ms)):
        m, p, q = ms[i], ms[i - 1], ms[i - 12]
        r = dict(m=m, dcd=cd[m] - cd[q], dfx=fx[m] / fx[q] - 1)
        r["kospi"] = k200[m] / k200[p] - 1
        r["spy_usd"] = spy[m] / spy[p] - 1
        r["spy_krw"] = (spy[m] * fx[m]) / (spy[p] * fx[p]) - 1
        r["gold_krw"] = (gld[m] * fx[m]) / (gld[p] * fx[p]) - 1
        r["cash"] = cd[p] / 100 / 12
        if m in bond and p in bond: r["bond"] = bond[m] / bond[p] - 1
        rows.append(r)
    return rows

def ann(xs): 
    xs = np.array(xs); return (np.prod(1 + xs) ** (12 / len(xs)) - 1) * 100

def table(rows, key, lo, hi, labels, cols):
    out = {}
    for lab, f in labels:
        s = [r for r in rows if f(r[key])]
        out[lab] = dict(months=len(s), **{c: round(float(ann([r[c] for r in s if c in r])), 1) for c in cols if any(c in r for r in s)})
    return out

cols = ["kospi", "bond", "spy_krw", "spy_usd", "gold_krw", "cash"]
def export():
    """화면용 데이터: 2005-11~2026-09 기준 금리·환율 환경별 연환산 수익(코스피200·S&P500 원화·금 원화·현금)"""
    rows = build(ms_all); c_ = ["kospi", "spy_krw", "gold_krw", "cash"]
    cdlab = [("hiking", lambda x: x > 0.75), ("flat", lambda x: -0.75 <= x <= 0.75), ("cutting", lambda x: x < -0.75)]
    fxlab = [("weak", lambda x: x > 0.07), ("flat", lambda x: -0.07 <= x <= 0.07), ("strong", lambda x: x < -0.07)]
    last = rows[-1]
    return dict(period=f"{rows[0]['m'][:4]}-{rows[0]['m'][4:]}~{rows[-1]['m'][:4]}-{rows[-1]['m'][4:]}",
                rate=table(rows, "dcd", 0, 0, cdlab, c_), fx=table(rows, "dfx", 0, 0, fxlab, c_),
                now=dict(cd91=round(float(cd[max(cd)]), 2), cdChg12=round(float(last["dcd"]), 2), fxChg12=round(float(last["dfx"] * 100), 1), asOf=last["m"][:4] + "-" + last["m"][4:]))


def report():
    now_cd = cd[max(cd)]; 
    for title, ms in (("2011-10~2026-09 (채권 ETF 포함)", [m for m in ms_all if m >= "201110"]), ("2004-12~2026-09 (채권 제외)", ms_all)):
        rows = build(ms)
        print(f"\n=== {title}, 월수익 {len(rows)}개 ({rows[0]['m']}~{rows[-1]['m']})")
        cdlab = [("인상기(CD91 +0.75%p 초과)", lambda x: x > 0.75), ("횡보", lambda x: -0.75 <= x <= 0.75), ("인하기(−0.75%p 미만)", lambda x: x < -0.75)]
        print("[금리 환경] 연환산 %")
        c_ = cols if "2011" in title else [c for c in cols if c != "bond"]
        for k, v in table(rows, "dcd", 0, 0, cdlab, c_).items(): print(f"  {k}: {v}")
        flag = [r["dcd"] > 0.75 for r in rows]; eps = sum(1 for i, f in enumerate(flag) if f and (i == 0 or not flag[i - 1]))
        print(f"  (인상기 연속 구간 수: {eps})")
        fxlab = [("원화 약세(+7% 초과)", lambda x: x > 0.07), ("횡보", lambda x: -0.07 <= x <= 0.07), ("원화 강세(−7% 미만)", lambda x: x < -0.07)]
        print("[환율 환경] 연환산 %")
        for k, v in table(rows, "dfx", 0, 0, fxlab, c_).items(): print(f"  {k}: {v}")
        # 교차: 금리 인상기에 환율?
        print("[상관] 월수익 상관 kospi~spy_krw %.2f" % np.corrcoef([r['kospi'] for r in rows], [r['spy_krw'] for r in rows])[0, 1])
    last = build([m for m in ms_all if m >= "201110"])[-1]
    print(f"\n현재: CD91 {now_cd}% (12개월 변화 {last['dcd']:+.2f}%p), 원/달러 12개월 변화 {last['dfx']*100:+.1f}% 기준월 {last['m']}")



if __name__ == "__main__":
    report()
