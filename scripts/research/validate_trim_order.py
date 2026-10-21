# -*- coding: utf-8 -*-
"""
H64 손실 개별주 정리 순서 (2026-10-21, C70 후속).

판정 기준은 docs/hypothesis-ledger.md H64 행에 결과 보기 전에 고정했다. 여기서는 그대로 계산만 한다.

질문: C70 계획 D(개별주를 6개월에 나눠 KODEX 200으로)를 할 때 어떤 종목부터 파느냐가 3년 뒤를 바꾸나.
  매달 파는 금액은 모두 같다(남은 개별주 평가액 ÷ 남은 달 수 — C70 D와 같은 속도). 고르는 순서만 다르다.
  D0 균등(모든 종목을 같은 비율로) · DL 원가 대비 손실 큰 것부터 · DV 직전 6개월 월 수익률 변동성 큰 것부터 · DS(참고) 손실 작은 것부터.
경로·대체·비용·새 돈은 validate_account_transition_paths.py(C70)와 같다(그 파일의 자료 읽기 부분을 그대로 옮겼다).
  새 돈은 지수 계획 1/3씩, 판 돈은 KODEX 200, 개별주 외 보유는 그대로.
한계: C70과 같다(개별주 가격 2014~, 시작 달 겹침, 세금 미반영, '비슷한 처지 종목'의 분포). 원가는 사용자 종목의 원가를 대체 종목에 그대로 붙인다.

실행: python scripts/research/validate_trim_order.py --start <json> > .research-cache/trim_order_out.txt
"""
import argparse
import bisect
import json
import pickle
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE = ".research-cache"
COST = 0.0025
DRAG_US = 0.009
DRAWS = 200
SEED = 20261021
# 사전 등록은 2003~2013 / 2014~였으나 px.pkl이 2014-01부터라 앞 시기가 비어(첫 실행에서 확인) 2014~2018 / 2019~로 보정했다.
ERA_SPLIT = "201901"
PLANS = ["D0", "DL", "DV", "DS"]
PLAN_NAME = {"D0": "균등하게 나눠", "DL": "손실 큰 것부터", "DV": "변동성 큰 것부터", "DS": "(참고) 손실 작은 것부터"}

ap = argparse.ArgumentParser()
ap.add_argument("--start", required=True)
ap.add_argument("--monthly", type=float, default=1_000_000)
ap.add_argument("--pool", choices=["loser", "any"], default="loser")
ap.add_argument("--sold", choices=["k200", "mix"], default="k200")
ap.add_argument("--top", type=int, default=300)
args = ap.parse_args()
start = json.load(open(args.start, encoding="utf-8"))


def load(path, col=1):
    return sorted((r[0], float(r[col])) for r in json.load(open(path, encoding="utf-8")) if r[col])


def month_end(rows):
    by = {}
    for d, v in rows:
        by[d[:6]] = v
    return by


k200 = month_end(load(f"{CACHE}/px_069500.json"))
fx_rows = load(f"{CACHE}/longrun/krw_usd_ecos.json")
fxd = [d for d, _ in fx_rows]


def fx_at(d):
    return fx_rows[bisect.bisect_right(fxd, d) - 1][1]


def usd_krw(path):
    return month_end([(d, v * fx_at(d)) for d, v in load(path)])


spx = usd_krw(f"{CACHE}/allweather/us_SPY.json")
ndx = usd_krw(f"{CACHE}/allweather/us_QQQ.json")
cd = month_end(load(f"{CACHE}/allweather/cd91.json"))

px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
spac = {c[2] for c in corps if "스팩" in c[1] or "기업인수목적" in c[1]}

months = sorted(set(k200) & set(spx) & set(ndx) & set(cd))
last_px = max(r[0] for r in px["005930"])[:6]
months = [m for m in months if m <= last_px]
# 마지막 달은 월말이 아닐 수 있어 버린다
months = months[:-1]
T = len(months)
mi = {m: i for i, m in enumerate(months)}


def rets(series):
    v = np.array([series[m] for m in months])
    r = np.zeros(T)
    r[1:] = v[1:] / v[:-1] - 1
    return r


R = {"k200": rets(k200), "spx": rets(spx) - DRAG_US / 12, "ndx": rets(ndx) - DRAG_US / 12}
cdv = np.array([cd[m] for m in months])
R["cash"] = np.zeros(T)
R["cash"][1:] = cdv[:-1] / 100 / 12

# 개별주 월말 종가 행렬(상장폐지 뒤는 마지막 가격 유지)과 월말 직전 20일 평균 거래대금
codes, P, TV = [], [], []
for code, rows in px.items():
    if code in spac or not rows:
        continue
    rows = [r for r in rows if r[4] and r[4] > 0]
    if len(rows) < 60:
        continue
    close = np.full(T, np.nan)
    tv = np.full(T, np.nan)
    ds = [r[0] for r in rows]
    for m, i in mi.items():
        k = bisect.bisect_right(ds, m + "99") - 1
        if k < 0:
            continue
        close[i] = rows[k][4]
        if ds[k][:6] == m and k >= 19:
            tv[i] = np.mean([r[4] * r[5] for r in rows[k - 19:k + 1]])
    first = bisect.bisect_left(months, ds[0][:6])
    close[:first] = np.nan
    codes.append(code)
    P.append(close)
    TV.append(tv)
P = np.array(P)
TV = np.array(TV)

sl0 = {k: float(start["sleeves"].get(k, 0)) for k in ("k200", "spx", "ndx", "cash")}
sv0 = np.array([s["value"] for s in start["stocks"]], float)
sc0 = np.array([s["cost"] for s in start["stocks"]], float)
NS = len(sv0)
V0 = sum(sl0.values()) + sv0.sum()
COST0 = float(start["cost"])
rng = np.random.default_rng(SEED)


def pool_at(i):
    if i < 6:
        return None
    tv = TV[:, i]
    ok = ~np.isnan(tv) & ~np.isnan(P[:, i])
    idx = np.where(ok)[0]
    top = idx[np.argsort(-tv[idx])][:args.top]
    if args.pool == "any":
        return top
    past = P[top, i - 6]
    r6 = P[top, i] / past - 1
    return top[~np.isnan(r6) & (r6 <= -0.20)]


def simulate(i0, H, picks):
    """picks: (DRAWS, NS) 종목 행 번호. 반환: {plan: (DRAWS, H+1) 계좌값}"""
    pr = P[picks][:, :, i0 - 6:i0 + H + 1].copy()
    for h in range(1, pr.shape[2]):
        pr[:, :, h] = np.where(np.isnan(pr[:, :, h]), pr[:, :, h - 1], pr[:, :, h])
    gr_all = pr[:, :, 1:] / pr[:, :, :-1]  # 앞 6칸은 시작 전 6개월
    gr = gr_all[:, :, 6:]
    mix_w = {"k200": 1 / 3, "spx": 1 / 3, "ndx": 1 / 3}
    out = {}
    for plan in PLANS:
        sl = {k: np.full(DRAWS, v) for k, v in sl0.items()}
        sv = np.tile(sv0, (DRAWS, 1))
        sc = np.tile(sc0, (DRAWS, 1))
        path = np.zeros((DRAWS, H + 1))

        def sell_step(h):
            quota = sv.sum(1) / (6 - h)
            if plan == "D0":
                frac = np.where(sv > 0, (quota / np.maximum(sv.sum(1), 1e-9))[:, None], 0.0)
                amt = sv * np.minimum(frac, 1.0)
            else:
                if plan == "DV":
                    w = gr_all[:, :, h:h + 6]  # 그 달 직전 6개월(시작 전 자료 포함)
                    key = -np.nanstd(np.log(np.where(w > 0, w, np.nan)), axis=2)
                    key = np.where(np.isnan(key), 0.0, key)
                else:
                    ratio = np.where(sc > 0, sv / np.maximum(sc, 1e-9), np.inf)
                    key = ratio if plan == "DL" else -ratio
                key = np.where(sv > 0, key, np.inf)  # 다 판 종목은 맨 뒤
                order = np.argsort(key, axis=1, kind="stable")
                svs = np.take_along_axis(sv, order, 1)
                before = np.cumsum(svs, 1) - svs
                take = np.clip(quota[:, None] - before, 0, svs)
                amt = np.zeros_like(sv)
                np.put_along_axis(amt, order, take, 1)
            frac_mat = np.where(sv > 0, amt / np.maximum(sv, 1e-9), 0.0)
            sv[:] -= amt
            sc[:] *= 1 - frac_mat
            sl["k200"] += amt.sum(1) * (1 - COST)

        sell_step(0)
        path[:, 0] = sum(sl.values()) + sv.sum(1)
        for h in range(1, H + 1):
            t = i0 + h
            for k in sl:
                sl[k] *= 1 + R[k][t]
            sv *= gr[:, :, h - 1]
            if h <= 5:
                sell_step(h)
            for k, w in mix_w.items():
                sl[k] += args.monthly * w
            path[:, h] = sum(sl.values()) + sv.sum(1)
        out[plan] = path
    return out


H = 36
res = {p: [] for p in PLANS}
era = []
starts = skipped = 0
for i0 in range(6, T - H):
    pool = pool_at(i0)
    if pool is None or len(pool) < 15:
        skipped += 1
        continue
    starts += 1
    picks = pool[rng.integers(0, len(pool), size=(DRAWS, NS))]
    sim = simulate(i0, H, picks)
    for p in PLANS:
        res[p].append(sim[p][:, -1])
    era.append(np.full(DRAWS, 0 if months[i0] < ERA_SPLIT else 1))
for p in PLANS:
    res[p] = np.concatenate(res[p])
era = np.concatenate(era)


def won(x):
    return f"{x / 1e8:6.2f}억"


print(f"H64 손실 개별주 정리 순서 · 개별주 대체 상위 {args.top} {args.pool} · 월 {args.monthly / 1e4:.0f}만원 · 6개월에 나눠 KODEX 200으로")
print(f"출발 계좌 {won(V0)} (원금 {won(COST0)}, 개별주 {NS}종 {won(sv0.sum())} = {sv0.sum() / V0 * 100:.1f}%)")
print(f"월 재료 {months[0]}~{months[-1]}, 3년 경로 시작 달 {starts}개(손실 종목 부족으로 뺀 달 {skipped}개) × 대체 {DRAWS}")
for p in PLANS:
    v = res[p]
    print(f"  {p} {PLAN_NAME[p]:16s} 중앙 {won(np.median(v))}  하위10% {won(np.percentile(v, 10))}  하위5% {won(np.percentile(v, 5))}")
th = V0 * 0.005
d10 = np.percentile(res["D0"], 10)
print()
print(f"판정(사전 기준, 3년): 우위 = X−D0 중앙값이 두 시기 모두 > 시작 계좌의 0.5%({th / 1e4:.0f}만) + X 하위10% ≥ D0 하위10%")
for p in PLANS[1:]:
    d = res[p] - res["D0"]
    m0, m1 = np.median(d[era == 0]), np.median(d[era == 1])
    x10 = np.percentile(res[p], 10)
    ok = m0 > th and m1 > th and x10 >= d10
    worse = m0 < -th and m1 < -th
    verdict = "우위" if ok else ("열세" if worse else "차이 없음")
    tag = "판정 안 함" if p == "DS" else verdict
    print(f"  {p} {PLAN_NAME[p]:16s} 중앙 {np.median(d) / 1e4:+6.0f}만 (~2018 {m0 / 1e4:+.0f}만 · 2019~ {m1 / 1e4:+.0f}만)  나은 경로 {np.mean(d > 0) * 100:4.1f}%  하위10% {won(x10)} vs D0 {won(d10)} → {tag}")
