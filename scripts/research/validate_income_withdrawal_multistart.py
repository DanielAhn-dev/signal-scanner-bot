# -*- coding: utf-8 -*-
"""
H12 고배당에서 생활비를 꺼내 쓰기 vs 지수에서 꺼내 쓰기, 다중 시작점 (2026-10-06).

배경: src/lib/incomeGuide.ts 근거 주석 "분배형은 횡보장에서 같은 생활비에 원금을 더 남겼지만 랠리 구간에서 크게 뒤졌다"는
  2026-09-29 단일 시작점 결과다. 재투자 질문(validate_income_multistart.py)은 다중 시작점으로 다시 봤지만 인출 질문은 안 했다.
사전 판정 기준(가설 장부 H12): 10년 끝자산에서 시작점 60% 이상 지수 우세 + 전·후반 같은 방향이면 채택(안내 유지), 아니면 문구 수정.

방법:
  - 월말 수정주가(분배금 재투자 총수익)로 월 총수익을 만든다. 세전에는 분배금으로 받든 팔아서 받든 같다(validate_retirement_withdrawal.py).
  - 세후: 분배금은 15.4% 원천징수. 국내 주식형 ETF 매매차익은 비과세라 지수에서 팔아 쓰는 쪽은 매도분에 세금이 없다.
    그래서 매달 총수익에서 (15.4% × 그달 분배율)을 뺀다. 지수(KODEX200) 분배금도 같은 방식(2021~ 실제, 그 전 연 2.3% 근사).
  - 분배율 = 그달 주당 분배금 ÷ 직전 월말 '원래 가격'. 수정주가는 과거 가격이 낮아 분배율이 부풀려지므로,
    분배금 이력으로 원래 가격을 역산한다: 분배락 직전 원가격 = 수정가격/누적계수 + 분배금, 누적계수 *= (1 − 분배금/원가격).
  - 인출: 시작 자산 1, 연 4·5·6%를 12로 나눠 매달 꺼내고 매년 2.5% 올린다(생활비 물가 연동). 월말 수익 반영 뒤 인출.
  - 시작점: 두 상품 공통 구간의 모든 월말. 보유 5·10년.
한계: 금융소득종합과세(연 2천만원 초과)·ISA·연금계좌 과세 이연, 건보료는 반영하지 않았다. 계좌 안에서는 세후 차이가 줄어든다.
  국내 고배당 3종의 10년 창은 2009~2016 시작에 몰려 있어 독립 표본이 적다.
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
TAX = 0.154
PRODUCTS = [
    ("KIWOOM고배당(104530)", C + "dividend_etfs/px_104530.json", C + "div_104530.json"),
    ("PLUS고배당주(161510)", C + "px_161510.json", C + "div_161510.json"),
    ("TIGER코스피고배당(210780)", C + "dividend_etfs/px_210780.json", C + "div_210780.json"),
]
RATES = [4.0, 5.0, 6.0]
HORIZONS = [60, 120]


def monthly_adj(path):
    rows = sorted(json.load(open(path, encoding="utf-8")), key=lambda r: r[0])
    m = {}
    for r in rows:
        m[r[0][:6]] = float(r[-1])
    return m


def divs_by_month(path):
    out = {}
    for d in json.load(open(path, encoding="utf-8")):
        k = d["recordDate"].replace("-", "")[:6]
        out[k] = out.get(k, 0.0) + float(d["amount"])
    return out


def kodex_divs():
    out = {}
    for d in json.load(open(C + "kodex200_divid.json", encoding="utf-8")):
        k = d["basicD"][:6]
        out[k] = out.get(k, 0.0) + float(d["dividA"])
    return out


def yields(adj: dict, dv: dict):
    """월별 분배율(직전 월말 원가격 기준) — 원가격은 분배금 이력으로 역산"""
    months = sorted(adj)
    raw = {}
    F = 1.0
    for i in range(len(months) - 1, -1, -1):
        m = months[i]
        raw[m] = adj[m] / F
        # 이 달에 분배가 있으면, 이 달 이전(직전 월말)부터는 계수가 바뀐다
        d = dv.get(m, 0.0)
        if d and i > 0:
            prev_raw = adj[months[i - 1]] / F + d
            F *= 1 - d / prev_raw
    y = {}
    for i in range(1, len(months)):
        y[months[i]] = dv.get(months[i], 0.0) / raw[months[i - 1]]
    return y


def series(adj, y, months, fallback_annual=None):
    r, ty = [], []
    for i in range(1, len(months)):
        r.append(adj[months[i]] / adj[months[i - 1]] - 1)
        yy = y.get(months[i])
        if yy is None or (fallback_annual is not None and months[i] < "202101"):
            yy = (fallback_annual / 100 / 12) if fallback_annual is not None else 0.0
        ty.append(yy)
    return np.array(r), np.array(ty)


def withdraw(r, y, rate_pct, after_tax):
    W = 1.0
    w = rate_pct / 100 / 12
    low = 1.0
    for i in range(len(r)):
        g = r[i] - (TAX * y[i] if after_tax else 0.0)
        W = W * (1 + g) - w
        if W <= 0:
            return 0.0, 0.0
        low = min(low, W)
        if (i + 1) % 12 == 0:
            w *= 1.025
    return W, low


k_adj = monthly_adj(C + "px_069500.json")
k_y = yields(k_adj, kodex_divs())
summary = []
for label, ppath, dpath in PRODUCTS:
    p_adj = monthly_adj(ppath)
    p_y = yields(p_adj, divs_by_month(dpath))
    months = sorted(set(p_adj) & set(k_adj))
    pr, py = series(p_adj, p_y, months)
    kr, ky = series(k_adj, k_y, months, fallback_annual=2.3)
    print(f"\n=== {label} vs KODEX200 — 공통 {months[0]}~{months[-1]}, 평균 분배율 연 {py.mean()*1200:.1f}% (지수 {ky.mean()*1200:.1f}%) ===")
    for H in HORIZONS:
        starts = range(0, len(pr) - H + 1)
        if len(starts) < 6:
            continue
        for tax in (False, True):
            for rate in RATES:
                ratio, idx_cagr = [], []
                for s in starts:
                    a, _ = withdraw(pr[s:s + H], py[s:s + H], rate, tax)
                    b, _ = withdraw(kr[s:s + H], ky[s:s + H], rate, tax)
                    ratio.append((a + 1e-9) / (b + 1e-9))
                    idx_cagr.append((np.prod(1 + kr[s:s + H])) ** (12 / H) - 1)
                ratio = np.array(ratio)
                n = len(ratio)
                half = n // 2
                idx_win = (ratio < 1).mean() * 100
                w1, w2 = (ratio[:half] < 1).mean() * 100, (ratio[half:] < 1).mean() * 100
                ic = np.array(idx_cagr)
                rally = ic >= np.median(ic)
                tag = "세후" if tax else "세전"
                print(f"  {H//12:2d}년 {tag} 연{rate:.0f}%: 시작 {n:3d}개 | 지수 우세 {idx_win:5.1f}% (전반 {w1:5.1f}% · 후반 {w2:5.1f}%) | "
                      f"끝자산 비율(고배당/지수) 중앙값 {np.median(ratio):.2f} | 지수 강한 창 {(ratio[rally] < 1).mean()*100:5.1f}% · 약한 창 {(ratio[~rally] < 1).mean()*100:5.1f}%")
                if H == 120:
                    summary.append((label, tag, rate, n, idx_win, w1, w2, np.median(ratio)))

print("\n=== 사전 기준 판정 (10년, 지수 우세 ≥60% + 전·후반 모두 ≥50%) ===")
for label, tag, rate, n, win, w1, w2, med in summary:
    ok = win >= 60 and w1 >= 50 and w2 >= 50
    print(f"{label:24s} {tag} 연{rate:.0f}%: 지수 우세 {win:5.1f}% (전 {w1:.0f}·후 {w2:.0f}) → {'채택(지수 우세)' if ok else '기각'}")
