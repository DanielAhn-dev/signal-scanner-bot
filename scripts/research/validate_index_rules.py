# -*- coding: utf-8 -*-
"""
코스피 30년(1996~) 지수 매매 규칙 일괄 검증 (2026-10-01).

대상: 이 프로젝트의 기준선(SMA50/SMA200)과 유행하는 규칙들 — 터틀(돈치안), 골든크로스, 변동성 타겟,
절대 모멘텀(듀얼 모멘텀의 지수 쪽 절반), 계절성(11~4월), RSI(2) 역추세, 볼린저(역추세·돌파), 일목 구름대,
52주 신고가 근접. 파라미터는 문헌의 표준값 하나로 고정(탐색하지 않음) — 짜맞추기 방지.

규칙: 전일 종가로 신호 → 당일 종가수익부터 반영(룩어헤드 없음). 미보유 시 현금 연3%.
전환마다 0.07% 비용. 전반(~2010)/후반(2011~) 나눠 부호 일관성 확인.
기준선 대비 판단 기준: 보유보다 CAGR이 비슷하면서 MDD가 크게 작거나, SMA50보다 둘 다 낫거나.
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = __file__.rsplit("scripts", 1)[0] + ".research-cache/"
rows = sorted(json.load(open(ROOT + "kospi.json", encoding="utf-8")), key=lambda r: r[0])
dates = np.array([r[0] for r in rows])
c = np.array([r[1] for r in rows], dtype=float)
N = len(c)
ret = np.concatenate(([0.0], c[1:] / c[:-1] - 1))
RC = 1.03 ** (1 / 250) - 1
COST = 0.0007


def sma(x, w):
    out = np.full(N, np.nan)
    cs = np.cumsum(x)
    out[w - 1:] = (cs[w - 1:] - np.concatenate(([0], cs[:-w]))) / w
    return out


def rolling(fn, x, w):
    out = np.full(N, np.nan)
    for i in range(w - 1, N):
        out[i] = fn(x[i - w + 1:i + 1])
    return out


def hi_n(w): return rolling(np.max, c, w)
def lo_n(w): return rolling(np.min, c, w)


def state_machine(enter, exit_, start=0):
    """enter/exit_ 는 길이 N 불리언(해당 일 종가 기준). 보유 상태 배열 반환(해당 일 종가 시점 판단)."""
    st = np.zeros(N, dtype=bool)
    h = False
    for i in range(start, N):
        if not h and enter[i]:
            h = True
        elif h and exit_[i]:
            h = False
        st[i] = h
    return st


def run(pos_frac: np.ndarray):
    """pos_frac[i] = i일 종가 시점 판단 비중 → i+1일 수익에 적용."""
    p = np.concatenate(([0.0], pos_frac[:-1]))
    daily = p * ret + (1 - p) * RC - np.abs(np.diff(np.concatenate(([0.0], p)))) * COST
    return daily, p


def stats(d, p):
    eq = np.cumprod(1 + d)
    yrs = len(d) / 250
    cagr = eq[-1] ** (1 / yrs) - 1
    mdd = (eq / np.maximum.accumulate(eq) - 1).min()
    vol = d.std() * np.sqrt(250)
    sharpe = (d.mean() * 250 - 0.03) / vol if vol else 0
    trades = np.abs(np.diff(p)).sum() / 2
    return cagr * 100, mdd * 100, sharpe, p.mean() * 100, trades / (len(d) / 250)


def nan_false(a):
    return np.where(np.isnan(a), False, a).astype(bool)


S5, S20, S50, S200 = sma(c, 5), sma(c, 20), sma(c, 50), sma(c, 200)
strats: dict[str, np.ndarray] = {}
strats["보유"] = np.ones(N)
strats["SMA50"] = nan_false(c > S50).astype(float)
strats["SMA200"] = nan_false(c > S200).astype(float)
strats["골든크로스 50/200"] = nan_false(S50 > S200).astype(float)
# 터틀: 55일 신고가 돌파 진입, 20일 신저가 이탈 청산 / 20-10 단기판
for en, ex in [(55, 20), (20, 10)]:
    he, lx = hi_n(en), lo_n(ex)
    enter = nan_false(c >= np.concatenate(([np.nan], he[:-1])))  # 직전 N일 고가 돌파
    exit_ = nan_false(c <= np.concatenate(([np.nan], lx[:-1])))
    strats[f"터틀 {en}/{ex}"] = state_machine(enter, exit_).astype(float)
# 절대 모멘텀: 12개월(250일) 수익>0 이면 보유(월말 판정 → 일봉으로 단순화)
mom = np.full(N, np.nan); mom[250:] = c[250:] / c[:-250] - 1
strats["절대모멘텀 12개월"] = nan_false(mom > 0).astype(float)
mom6 = np.full(N, np.nan); mom6[125:] = c[125:] / c[:-125] - 1
strats["절대모멘텀 6개월"] = nan_false(mom6 > 0).astype(float)
# 변동성 타겟: 목표 15% / 20일 실현변동성, 최대 1배(레버리지 없음)
rv = np.full(N, np.nan)
for i in range(20, N):
    rv[i] = ret[i - 19:i + 1].std() * np.sqrt(250)
strats["변동성타겟 15%"] = np.where(np.isnan(rv), 0, np.minimum(1.0, 0.15 / np.maximum(rv, 1e-9)))
strats["변동성타겟15%+SMA50"] = strats["변동성타겟 15%"] * strats["SMA50"]
# 계절성: 11~4월 보유(할로윈), 월초(마지막 4거래일~다음달 첫 3거래일)
month = np.array([int(d[4:6]) for d in dates])
strats["계절성 11~4월"] = np.isin(month, [11, 12, 1, 2, 3, 4]).astype(float)
ym = np.array([d[:6] for d in dates])
turn = np.zeros(N)
idx_in_month = np.zeros(N, dtype=int); left_in_month = np.zeros(N, dtype=int)
i = 0
while i < N:
    j = i
    while j < N and ym[j] == ym[i]: j += 1
    for k in range(i, j):
        idx_in_month[k] = k - i
        left_in_month[k] = j - 1 - k
    i = j
strats["월초월말 효과(말4+초3일)"] = ((left_in_month < 4) | (idx_in_month < 3)).astype(float)
# RSI(2) 역추세: 200일선 위에서 RSI2<10 매수, 종가>5일선 청산
def rsi(n):
    d = np.diff(c, prepend=c[0]); g = np.where(d > 0, d, 0.0); l = np.where(d < 0, -d, 0.0)
    ag = np.full(N, np.nan); al = np.full(N, np.nan)
    ag[n] = g[1:n + 1].mean(); al[n] = l[1:n + 1].mean()
    for k in range(n + 1, N):
        ag[k] = (ag[k - 1] * (n - 1) + g[k]) / n; al[k] = (al[k - 1] * (n - 1) + l[k]) / n
    return 100 - 100 / (1 + ag / np.maximum(al, 1e-12))
R2 = rsi(2)
strats["RSI(2) 역추세(200일선 위)"] = state_machine(nan_false((R2 < 10) & (c > S200)), nan_false(c > S5)).astype(float)
# 볼린저(20,2): 역추세(하단 이탈 매수→중심선 청산) / 돌파(상단 돌파 보유→중심선 이탈 청산)
sd20 = rolling(np.std, c, 20)
up, lo = S20 + 2 * sd20, S20 - 2 * sd20
strats["볼린저 역추세"] = state_machine(nan_false(c < lo), nan_false(c > S20)).astype(float)
strats["볼린저 돌파"] = state_machine(nan_false(c > up), nan_false(c < S20)).astype(float)
# 일목 구름대(종가 기준 근사: 9/26/52, 선행스팬은 26일 뒤로 이동)
def mid(w): return (hi_n(w) + lo_n(w)) / 2
tenkan, kijun, b52 = mid(9), mid(26), mid(52)
spanA = (tenkan + kijun) / 2
cloud_top = np.full(N, np.nan); cloud_bot = np.full(N, np.nan)
cloud_top[26:] = np.maximum(spanA[:-26], b52[:-26]); cloud_bot[26:] = np.minimum(spanA[:-26], b52[:-26])
strats["일목 구름대 위"] = nan_false(c > cloud_top).astype(float)
# 52주 신고가 근접: 52주 고가의 90% 이상이면 보유
strats["52주고가 90% 이상"] = nan_false(c >= 0.9 * hi_n(250)).astype(float)

split = int(np.searchsorted(dates, "20110101"))
print(f"코스피 {dates[0]}~{dates[-1]}, 전반/후반 경계 {dates[split]}")
hdr = f"{'규칙':26s} | {'CAGR':>6s} {'MDD':>7s} {'샤프':>5s} {'보유%':>5s} {'연전환':>5s} | 전반CAGR/MDD | 후반CAGR/MDD"
print(hdr)
START = 250  # 모든 규칙을 같은 시작점(워밍업 이후)에서 비교
for name, pf in strats.items():
    d, p = run(pf)
    full = stats(d[START:], p[START:])
    a = stats(d[START:split], p[START:split]); b = stats(d[split:], p[split:])
    print(f"{name:26s} | {full[0]:6.1f} {full[1]:7.1f} {full[2]:5.2f} {full[3]:5.0f} {full[4]:5.1f} | {a[0]:5.1f}/{a[1]:6.1f} | {b[0]:5.1f}/{b[1]:6.1f}")
