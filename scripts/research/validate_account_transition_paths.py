# -*- coding: utf-8 -*-
"""
H62 실계좌 전환 계획 경로 시뮬레이션 (2026-10-21).

판정 기준은 docs/hypothesis-ledger.md H62 행에 결과 보기 전에 고정했다. 여기서는 그대로 계산만 한다.

질문: 지금 계좌(손실 중인 개별주 + 지수·커버드콜·미국 ETF·금리)에서 출발할 때, 개별주를 어떻게 하느냐에 따라
      앞으로 1·3·5년 계좌가 어떻게 갈리나. '최적 비중'을 찾는 게 아니라 정해 둔 몇 개 계획을 같은 경로에서 비교한다.

출발 상태: --start <json> (묶음별 금액·개별주별 평가액/원가). 개인 보유라 저장소에 넣지 않는다.
  {"cost": 원금, "sleeves": {"k200":..,"spx":..,"ndx":..,"cash":..}, "stocks": [{"value":..,"cost":..}, ...]}
  국내 커버드콜·배당 ETF는 이력이 짧아 k200(KODEX 200)으로 근사한다(모든 계획 공통).

경로: 과거 실제 시작 달부터의 실제 월 수익률.
  - k200: KODEX 200 수정주가(분배금 반영) · spx/ndx: SPY/QQQ 수정종가 × 원달러(ECOS) − 연 0.9%p · cash: CD91 금리/12
  - 개별주: 사용자의 종목 대신, 시작 달 직전 20일 거래대금 상위 300(스팩 제외) 중 직전 6개월 −20% 이하였던 종목에서
    무작위로 뽑아 넣는다(이 종목들의 과거 성과를 쓰지 않기 위해). 상장폐지면 마지막 가격 유지(C69와 같음, 보유 쪽에 유리).
계획: A 지금처럼(새 돈을 지금 비중대로, 개별주 포함) · B 새 돈만 지수 계획(코스피200·S&P500·나스닥100 1/3)
      C B + 개별주가 원가 대비 +20%면 한 번 절반을 KODEX 200으로(C54) · D B + 개별주를 6개월에 나눠 KODEX 200으로
      E B + 개별주 전부 지금 KODEX 200으로. 매도 비용 0.25%(거래세 0.20% + 수수료).
한계: 개별주 가격(px.pkl)이 2014-01부터라 시작 달은 2014-07~. 2025~26 한국 대형주 급등이 뒤 시기에 들어 있다. 시작 달이 겹쳐 경로가 독립이 아니다(두 시기로 나눠 본다). 세금(일반 계좌 분배금 과세 등)·리밸런싱은 넣지 않았다.
      과거 한국·미국 시장이 앞으로도 비슷하리라는 보장은 없다.

실행: python scripts/research/validate_account_transition_paths.py --start <json> [--monthly 1000000] [--pool loser|any] [--sold k200|mix] [--top 300]
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
PLANS = ["A", "B", "C", "D", "E"]
PLAN_NAME = {"A": "지금처럼", "B": "새 돈만 지수", "C": "B+20%면 절반 지수", "D": "B+6개월 나눠 지수", "E": "B+지금 전부 지수"}

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
    # 개별주 월 수익률 (DRAWS, NS, H)
    pr = P[picks][:, :, i0:i0 + H + 1].copy()
    # 시작 달 가격은 있다(풀 조건). 상장폐지 뒤 NaN은 마지막 값 유지
    for h in range(1, H + 1):
        pr[:, :, h] = np.where(np.isnan(pr[:, :, h]), pr[:, :, h - 1], pr[:, :, h])
    gr = pr[:, :, 1:] / pr[:, :, :-1]
    out = {}
    mix_w = {"k200": 1 / 3, "spx": 1 / 3, "ndx": 1 / 3}
    for plan in PLANS:
        sl = {k: np.full(DRAWS, v) for k, v in sl0.items()}
        sv = np.tile(sv0, (DRAWS, 1))
        sc = np.tile(sc0, (DRAWS, 1))
        trimmed = np.zeros((DRAWS, NS), bool)
        path = np.zeros((DRAWS, H + 1))

        def sell(frac_mat):
            amt = sv * frac_mat
            proceeds = amt.sum(1) * (1 - COST)
            sv[:] -= amt
            sc[:] *= (1 - frac_mat)
            if args.sold == "k200":
                sl["k200"] += proceeds
            else:
                for k, w in mix_w.items():
                    sl[k] += proceeds * w

        if plan == "E":
            sell(np.ones((DRAWS, NS)))
        if plan == "D":
            sell(np.full((DRAWS, NS), 1 / 6))
        path[:, 0] = sum(sl.values()) + sv.sum(1)
        for h in range(1, H + 1):
            t = i0 + h
            for k in sl:
                sl[k] *= 1 + R[k][t]
            sv *= gr[:, :, h - 1]
            if plan == "D" and h <= 5:
                sell(np.full((DRAWS, NS), 1 / (6 - h)))
            if plan == "C":
                hit = (sv >= 1.2 * sc) & ~trimmed & (sv > 0)
                sell(np.where(hit, 0.5, 0.0))
                trimmed |= hit
            c = args.monthly
            if plan == "A":
                tot = sum(sl.values()) + sv.sum(1)
                for k in sl:
                    sl[k] += c * sl[k] / tot
                add = c * sv / tot[:, None]
                sv += add
                sc += add
            else:
                for k, w in mix_w.items():
                    sl[k] += c * w
            path[:, h] = sum(sl.values()) + sv.sum(1)
        out[plan] = path
    return out


res = {H: {p: [] for p in PLANS} for H in (12, 36, 60)}
era = {H: [] for H in (12, 36, 60)}
mdd36 = {p: [] for p in PLANS}
skipped = {H: 0 for H in res}
starts = {H: 0 for H in res}
for H in (12, 36, 60):
    for i0 in range(6, T - H):
        pool = pool_at(i0)
        if pool is None or len(pool) < 15:
            skipped[H] += 1
            continue
        starts[H] += 1
        picks = pool[rng.integers(0, len(pool), size=(DRAWS, NS))]
        sim = simulate(i0, H, picks)
        for p in PLANS:
            res[H][p].append(sim[p][:, -1])
            if H == 36:
                run = np.maximum.accumulate(sim[p], 1)
                mdd36[p].append((sim[p] / run - 1).min(1))
        era[H].append(np.full(DRAWS, 0 if months[i0] < ERA_SPLIT else 1))
for H in res:
    for p in PLANS:
        res[H][p] = np.concatenate(res[H][p])
    era[H] = np.concatenate(era[H])
for p in PLANS:
    mdd36[p] = np.concatenate(mdd36[p])


def won(x):
    return f"{x / 1e8:6.2f}억"


print(f"H62 실계좌 전환 계획 경로 · 개별주 대체 상위 {args.top} {args.pool} · 판 돈 {args.sold} · 월 {args.monthly / 1e4:.0f}만원")
print(f"출발 계좌 {won(V0)} (원금 {won(COST0)}, 개별주 {NS}종 {won(sv0.sum())} = {sv0.sum() / V0 * 100:.1f}%)")
print(f"월 재료 {months[0]}~{months[-1]}, 시작 달당 대체 경로 {DRAWS}개")
for H in (12, 36, 60):
    need = COST0 + args.monthly * H
    print(f"\n== {H // 12}년 뒤 (시작 달 {starts[H]}개, 손실 종목 부족으로 뺀 달 {skipped[H]}개, 경로 {len(res[H]['A']):,}) — 원금+넣은 돈 {won(need)} ==")
    for p in PLANS:
        v = res[H][p]
        line = f"  {p} {PLAN_NAME[p]:14s} 중앙 {won(np.median(v))}  하위10% {won(np.percentile(v, 10))}  하위5% {won(np.percentile(v, 5))}  원금 회복 {np.mean(v >= need) * 100:5.1f}%"
        if H == 36:
            line += f"  3년 중 최대 낙폭 중앙 {np.median(mdd36[p]) * 100:5.1f}% 하위10% {np.percentile(mdd36[p], 10) * 100:5.1f}%"
        print(line)
    for p in PLANS[1:]:
        d = res[H][p] - res[H]["A"]
        e0, e1 = d[era[H] == 0], d[era[H] == 1]
        print(f"  {p}−A 중앙 {np.median(d) / 1e4:+8.0f}만원 (시작 ~2018 {np.median(e0) / 1e4 if len(e0) else float('nan'):+7.0f} · 2019~ {np.median(e1) / 1e4 if len(e1) else float('nan'):+7.0f})  평균 {d.mean() / 1e4:+7.0f}만  {p}가 나은 경로 {np.mean(d > 0) * 100:4.1f}%")

print("\n판정(사전 기준, 3년): 우위 = X−A 중앙값이 두 시기 모두 > 시작 계좌의 1% + X 하위10% ≥ A 하위10%")
H = 36
th = V0 * 0.01
a10 = np.percentile(res[H]["A"], 10)
for p in PLANS[1:]:
    d = res[H][p] - res[H]["A"]
    m0, m1 = np.median(d[era[H] == 0]), np.median(d[era[H] == 1])
    x10 = np.percentile(res[H][p], 10)
    ok = m0 > th and m1 > th and x10 >= a10
    worse = m0 < -th and m1 < -th
    verdict = "우위" if ok else ("열세" if worse else "차이 없음")
    print(f"  {p} {PLAN_NAME[p]:14s} ⓐ 앞 {m0 / 1e4:+.0f}만·뒤 {m1 / 1e4:+.0f}만 (기준 {th / 1e4:.0f}만) ⓑ 하위10% {won(x10)} vs A {won(a10)} → {verdict}")
