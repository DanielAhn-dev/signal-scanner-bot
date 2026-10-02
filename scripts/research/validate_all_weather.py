# -*- coding: utf-8 -*-
"""
올웨더·자산배분 검증 (2026-10-02). 데이터: fetch_allweather_data.py → .research-cache/allweather/

A. 미국 원지수 ETF(SPY·TLT·IEF·TIP·GLD·DBC·VNQ·SHY, 야후 수정종가=총수익)를 원/달러로 환산한 원화 기준, 2006-02~ (DBC 상장 이후 약 20년).
   환노출(비헤지) 가정. 현금=CD91 금리. 월 리밸런싱, 비중 변화분에 0.1% 비용(연 1회 리밸런싱도 비교).
B. 한국 상장 ETF 실제 조합(네이버 수정주가)으로 가능한 구간(2020-08~) 교차 확인. 환헤지(H) 상품이 섞여 있어 A와 정확히 같지 않다.
주의: 올웨더 비중·구성은 후보이며 결과를 보고 고르는 것이 아니라 사전 정의된 고전 포트폴리오만 비교한다.
"""
import json
import sys
from datetime import datetime

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
D = ".research-cache/allweather/"
COST = 0.001


def load(path, col=1):
    return {r[0]: r[col] for r in json.load(open(D + path, encoding="utf-8"))}


def align(series_list, fx=None):
    """모든 시계열이 존재하는 날짜 교집합(미국 거래일 기준). 환율은 ffill."""
    dates = sorted(set.intersection(*[set(s) for s in series_list]))
    return dates


def stats(d, rc):
    eq = np.cumprod(1 + d)
    yrs = len(d) / 252
    cagr = (eq[-1] ** (1 / yrs) - 1) * 100
    mdd = (eq / np.maximum.accumulate(eq) - 1).min() * 100
    ex = d - rc
    sharpe = ex.mean() * 252 / (d.std() * np.sqrt(252))
    return cagr, mdd, sharpe


def run(R, w_target, rc, rebal="M", dates=None):
    """R: (T,N) 일수익, w_target: 목표 비중(합 1). 리밸런싱일에 목표로 되돌림, 사이엔 드리프트."""
    T, N = R.shape
    w = np.array(w_target, float)
    out = np.zeros(T)
    ym = [d[:6] for d in dates]
    yy = [d[:4] for d in dates]
    for i in range(1, T):
        g = w * (1 + R[i])
        r = g.sum() - 1
        out[i] = r
        w = g / g.sum()
        key = ym if rebal == "M" else yy
        if i == T - 1 or key[i] != key[i + 1]:
            turn = np.abs(np.array(w_target) - w).sum()
            out[i] -= turn * COST
            w = np.array(w_target, float)
    return out


def report(title, dates, rets, rc_daily, cuts):
    print(f"\n=== {title}  {dates[0]}~{dates[-1]} ({len(dates)}일) ===")
    hdr = f"{'전략':26s} | {'전체 CAGR':>8s} {'MDD':>7s} {'샤프':>5s}"
    for a, b in cuts:
        hdr += f" | {a[:4]}~{b[:4]} CAGR/MDD"
    print(hdr)
    for name, d in rets.items():
        s = stats(d[1:], rc_daily[1:])
        line = f"{name:26s} | {s[0]:8.1f} {s[1]:7.1f} {s[2]:5.2f}"
        for a, b in cuts:
            i0 = next(k for k, x in enumerate(dates) if x >= a)
            i1 = max(k for k, x in enumerate(dates) if x <= b)
            ss = stats(d[i0 + 1:i1 + 1], rc_daily[i0 + 1:i1 + 1])
            line += f" | {ss[0]:6.1f}/{ss[1]:6.1f}"
        print(line)


def year_returns(dates, d, years):
    out = []
    for y in years:
        idx = [i for i, x in enumerate(dates) if x[:4] == str(y)]
        if idx:
            out.append((np.prod(1 + d[idx]) - 1) * 100)
    return out


def main():
    cd = load("cd91.json")
    # ---------- A. 미국 ETF 원화 환산 ----------
    names = ["SPY", "TLT", "IEF", "TIP", "GLD", "DBC", "VNQ", "SHY"]
    us = {n: load(f"us_{n}.json", 1) for n in names}
    fx = load("us_KRW_X.json", 2)
    dates = align([us[n] for n in names])
    # 환율 ffill
    fxs = sorted(fx)
    fxv, j, last = [], 0, None
    for d in dates:
        while j < len(fxs) and fxs[j] <= d:
            last = fx[fxs[j]]
            j += 1
        fxv.append(last)
    fxv = np.array(fxv, float)
    # 한국시간 vs 미국시간 날짜 불일치 완화를 위해 환율은 전일 값 사용하지 않고 같은 날 값을 쓴다(월 단위 비교엔 영향 미미).
    cdd, last = [], 3.0
    cds = sorted(cd)
    j = 0
    for d in dates:
        while j < len(cds) and cds[j] <= d:
            last = cd[cds[j]]
            j += 1
        cdd.append(last)
    rc = (1 + np.array(cdd) / 100) ** (1 / 252) - 1
    P = np.array([[us[n][d] for n in names] for d in dates]) * fxv[:, None]
    R = np.vstack([np.zeros(len(names)), P[1:] / P[:-1] - 1])
    Rusd = np.vstack([np.zeros(len(names)), np.array([[us[n][d] for n in names] for d in dates])[1:] /
                      np.array([[us[n][d] for n in names] for d in dates])[:-1] - 1])
    ix = {n: k for k, n in enumerate(names)}

    def W(**kw):
        w = np.zeros(len(names))
        for k, v in kw.items():
            w[ix[k]] = v
        return w

    strat = {
        "SPY 100%": (W(SPY=1), "M"),
        "60/40 (SPY·IEF)": (W(SPY=.6, IEF=.4), "M"),
        "올웨더(달리오 30/40/15/7.5/7.5)": (W(SPY=.3, TLT=.4, IEF=.15, GLD=.075, DBC=.075), "M"),
        "올웨더 연1회 리밸런싱": (W(SPY=.3, TLT=.4, IEF=.15, GLD=.075, DBC=.075), "Y"),
        "올웨더+TIP(채권 일부 물가채)": (W(SPY=.3, TLT=.3, IEF=.1, TIP=.1, GLD=.1, DBC=.1), "M"),
        "영구포트폴리오 25x4": (W(SPY=.25, TLT=.25, GLD=.25, SHY=.25), "M"),
        "주식·채권·금 균등 3분할": (W(SPY=1 / 3, TLT=1 / 3, GLD=1 / 3), "M"),
        "주식 60·채권 20·금 20": (W(SPY=.6, TLT=.2, GLD=.2), "M"),
    }
    cuts = [("20060201", "20151231"), ("20160101", "20260930"), ("20220101", "20221231")]
    rets = {n: run(R, w, rc, rb, dates) for n, (w, rb) in strat.items()}
    report("A. 원화 환산(환노출)", dates, rets, rc, cuts)
    retsu = {n: run(Rusd, w, rc, rb, dates) for n, (w, rb) in strat.items() if n in ("SPY 100%", "60/40 (SPY·IEF)", "올웨더(달리오 30/40/15/7.5/7.5)")}
    report("A'. 달러 기준(환 영향 제거)", dates, retsu, rc, cuts)

    print("\n연도별 수익률(%, 원화)  SPY / 60·40 / 올웨더 / 영구")
    yrs = list(range(2007, 2027))
    cols = [year_returns(dates, rets[k], yrs) for k in ("SPY 100%", "60/40 (SPY·IEF)", "올웨더(달리오 30/40/15/7.5/7.5)", "영구포트폴리오 25x4")]
    for y, *v in zip(yrs, *cols):
        print(f"  {y}  " + "  ".join(f"{x:7.1f}" for x in v))

    # 최악 보유 구간: 롤링 5년 CAGR 분포
    print("\n롤링 5년 CAGR 분포(원화, 월 간격): 최저 / 하위10% / 중앙 / 상위10%")
    for k in ("SPY 100%", "60/40 (SPY·IEF)", "올웨더(달리오 30/40/15/7.5/7.5)", "영구포트폴리오 25x4"):
        eq = np.cumprod(1 + rets[k])
        vals = [(eq[i + 1260] / eq[i]) ** (1 / 5) - 1 for i in range(0, len(eq) - 1260, 21)]
        v = np.percentile(vals, [0, 10, 50, 90]) * 100
        print(f"  {k:30s} {v[0]:6.1f} / {v[1]:6.1f} / {v[2]:6.1f} / {v[3]:6.1f}   (표본 {len(vals)}, 중첩)")

    # ---------- B. 한국 상장 ETF 교차 확인 ----------
    kr_codes = {"S&P500": "360750", "미국30년(H)": "304660", "미국10년선물": "308620", "금현물": "411060", "WTI(H)": "261220",
                "KODEX200": "069500", "나스닥100": "133690", "국고채10년": "148070"}
    kr = {n: load(f"kr_{c}.json", 1) for n, c in kr_codes.items()}
    kd = sorted(set.intersection(*[set(s) for s in kr.values()]))
    kcd, last, j = [], 3.0, 0
    for d in kd:
        while j < len(cds) and cds[j] <= d:
            last = cd[cds[j]]
            j += 1
        kcd.append(last)
    krc = (1 + np.array(kcd) / 100) ** (1 / 252) - 1
    KP = np.array([[kr[n][d] for n in kr_codes] for d in kd])
    KR = np.vstack([np.zeros(KP.shape[1]), KP[1:] / KP[:-1] - 1])
    kix = {n: k for k, n in enumerate(kr_codes)}

    def KW(**kw):
        w = np.zeros(len(kr_codes))
        for k, v in kw.items():
            w[kix[k.replace("_", "")] if k.replace("_", "") in kix else kix[k]] = v
        return w

    def kw(d):
        w = np.zeros(len(kr_codes))
        for k, v in d.items():
            w[kix[k]] = v
        return w

    kstrat = {
        "KODEX200 100%": kw({"KODEX200": 1}),
        "S&P500 100%": kw({"S&P500": 1}),
        "60/40 (S&P·미국10년선물)": kw({"S&P500": .6, "미국10년선물": .4}),
        "올웨더형(S&P30·30년40·10년15·금7.5·WTI7.5)": kw({"S&P500": .3, "미국30년(H)": .4, "미국10년선물": .15, "금현물": .075, "WTI(H)": .075}),
        "올웨더형 WTI 제외(금 15)": kw({"S&P500": .3, "미국30년(H)": .4, "미국10년선물": .15, "금현물": .15}),
        "국내형(KODEX200·국고채10·금)": kw({"KODEX200": .4, "국고채10년": .4, "금현물": .2}),
    }
    krets = {n: run(KR, w, krc, "M", kd) for n, w in kstrat.items()}
    report("B. 한국 상장 ETF 실제 조합", kd, krets, krc, [(kd[0], "20231231"), ("20240101", kd[-1]), ("20220101", "20221231")])
    print("\n※ 30년채 H 상품은 환헤지, WTI 선물 ETF는 콘탱고·롤오버 비용 포함. 한국 ETF 수정주가에 보수·세금은 반영(이미 가격에).")


if __name__ == "__main__":
    main()
