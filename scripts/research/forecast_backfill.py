# -*- coding: utf-8 -*-
"""
예측 장부 백필 H69 (2026-10-27). 정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §3~§6에 결과 보기 전 고정.

질문: 기준일 종가까지의 정보로 '이후 20거래일 안에 코스피가 −7% 이하로 내려간다(T1)'는 확률을 매주 예측할 때,
      변동성만 쓰는 기준선(B1)보다 잘 맞히는가.

방법: 워크포워드(확장 창). 학습 2006~2012 → 2013년부터 매주 예측, 매년 1월 재학습.
      학습 표본의 결과 창(20거래일)이 예측 시작일을 넘으면 제외(퍼지).
모델: M1 = 특징 8개 L2 로지스틱(C=1), M0 = 수급·신용 2개를 뺀 6개. 기준선 B0 상수, B1 변동성 5구간표, B2 직전 4주 −5% 규칙.
판정: 문서 §6. 신뢰구간은 4주(20거래일) 블록 부트스트랩 1만 회.

실행: python scripts/research/forecast_backfill.py > .research-cache/forecast_backfill_out.txt
"""
import json
import sys

import numpy as np


class LogisticRegression:
    """L2 로지스틱 회귀(뉴턴법). sklearn과 같은 목적함수: 0.5·|w|² + C·Σ손실 (절편은 규제 안 함)."""

    def __init__(self, C=1.0, max_iter=100):
        self.C, self.max_iter = C, max_iter

    def fit(self, Xm, y):
        n, d = Xm.shape
        A = np.column_stack([np.ones(n), Xm])
        w = np.zeros(d + 1)
        reg = np.eye(d + 1) / self.C
        reg[0, 0] = 0
        for _ in range(self.max_iter):
            p = 1 / (1 + np.exp(-np.clip(A @ w, -30, 30)))
            g = A.T @ (p - y) + reg @ w
            Hm = (A * (p * (1 - p))[:, None]).T @ A + reg + 1e-9 * np.eye(d + 1)
            step = np.linalg.solve(Hm, g)
            w -= step
            if np.abs(step).max() < 1e-8:
                break
        self.intercept_, self.coef_ = w[0], w[1:].reshape(1, -1)
        return self

    def predict_proba(self, Xm):
        p = 1 / (1 + np.exp(-np.clip(Xm @ self.coef_[0] + self.intercept_, -30, 30)))
        return np.column_stack([1 - p, p])

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
H = 20                      # 결과 창(거래일)
DROP = -0.07                # T1 기준
TRAIN_START, TEST_START = "20060101", "20130101"
SPLIT_ERA = "20200101"
BLOCK, NBOOT = 4, 10000     # 주 단위 블록 길이, 부트스트랩 횟수
rng = np.random.default_rng(20261027)

Kd = dict(json.load(open(C + "kospi.json", encoding="utf-8")))
dates = sorted(Kd)
T = len(dates)
K = np.array([Kd[d] for d in dates], float)
idx_of = {d: i for i, d in enumerate(dates)}


def on_axis(pairs, pick=lambda v: v, lag=0):
    """pairs: [(date, v)] 또는 {date: v}. 코스피 거래일 축에 맞추고 직전 값으로 채운 뒤 lag일 늦춘다."""
    d = dict(pairs) if isinstance(pairs, list) else pairs
    out = np.full(T, np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        v = d.get(dt)
        if v is not None:
            x = pick(v)
            if x is not None:
                last = x
        out[i] = last
    if lag:
        out = np.concatenate([np.full(lag, np.nan), out[:-lag]])
    return out


VK = on_axis(json.load(open(C + "vkospi.json")))
VIX = on_axis(json.load(open(C + "yh_VIX_daily.json")), lag=1)   # 미국 종가는 한국 종가 뒤라 하루 늦춰 사용
KRW = on_axis(json.load(open(C + "longrun/krw_usd_ecos.json")), lag=1)
fl = json.load(open(C + "kospi_investor_flow.json"))
FOR = np.nan_to_num(on_axis(fl, lambda v: v[1] if v else None, lag=1))
cr = json.load(open(C + "freesis_credit.json"))
CR = on_axis(cr, lambda v: v[0] or None, lag=2)


def roll(x, w, fn):
    out = np.full(T, np.nan)
    for i in range(w - 1, T):
        out[i] = fn(x[i - w + 1:i + 1])
    return out


def pctile(x, w):
    out = np.full(T, np.nan)
    for i in range(w, T):
        h = x[i - w + 1:i + 1]
        h = h[np.isfinite(h)]
        if len(h) > w * 0.8 and np.isfinite(x[i]):
            out[i] = (h <= x[i]).mean()
    return out


def features():
    ret = np.concatenate([[np.nan], np.diff(np.log(K))])
    rv20 = roll(ret, 20, np.nanstd)
    f1 = pctile(rv20, 250)
    f2 = roll(VK, 5, np.nanmean) / roll(VK, 60, np.nanmean)
    f3 = K / roll(K, 200, np.nanmean) - 1
    f4 = K / roll(K, 120, np.nanmax) - 1
    f5 = pctile(roll(FOR, 20, np.sum), 250)
    f6 = np.full(T, np.nan)
    f6[60:] = CR[60:] / CR[:-60] - 1
    f7 = np.full(T, np.nan)
    f7[20:] = KRW[20:] / KRW[:-20] - 1
    f8 = np.log(VIX)
    return np.column_stack([f1, f2, f3, f4, f5, f6, f7, f8])


X = features()
M0_COLS, M1_COLS = [0, 1, 2, 3, 6, 7], list(range(8))

# 결과 T1: i 다음 H거래일 안 최저가가 K[i] 대비 −7% 이하
Y = np.full(T, np.nan)
for i in range(T - H):
    Y[i] = float(K[i + 1:i + H + 1].min() / K[i] - 1 <= DROP)
DD4W = np.full(T, np.nan)
for i in range(H, T):
    DD4W[i] = K[i] / K[i - H:i + 1].max() - 1

# 주간 표본: 각 ISO 주의 마지막 거래일
from datetime import date as _d
wk = {}
for i, dt in enumerate(dates):
    y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
    wk[(y, w)] = i
WEEKLY = sorted(wk.values())


def rows(start, end):
    return [i for i in WEEKLY if start <= dates[i] < end and np.isfinite(X[i]).all() and np.isfinite(Y[i])]


def fit_predict(train, test, cols):
    mu, sd = X[train][:, cols].mean(0), X[train][:, cols].std(0) + 1e-9
    z = lambda ix: (X[ix][:, cols] - mu) / sd
    m = LogisticRegression(C=1.0, max_iter=1000).fit(z(train), Y[train])
    return m.predict_proba(z(test))[:, 1]


def baselines(train, test):
    y = Y[train]
    base = y.mean()
    p0 = np.full(len(test), base)
    # B1: 변동성 백분위 5구간 (학습 구간 분위수), 평활화 5건
    edges = np.quantile(X[train][:, 0], [0.2, 0.4, 0.6, 0.8])
    bt, bs = np.digitize(X[train][:, 0], edges), np.digitize(X[test][:, 0], edges)
    rate = np.array([(y[bt == b].sum() + base * 5) / ((bt == b).sum() + 5) for b in range(5)])
    p1 = rate[bs]
    # B2: 직전 4주 안에 고점 대비 −5% 이하
    f_tr, f_te = DD4W[train] <= -0.05, DD4W[test] <= -0.05
    r2 = {f: (y[f_tr == f].sum() + base * 5) / ((f_tr == f).sum() + 5) for f in (True, False)}
    p2 = np.array([r2[bool(f)] for f in f_te])
    return p0, p1, p2


def walk_forward(test_start, test_end, mode="forward"):
    """forward: 매년 확장 창 재학습. 학습은 예측 연도 1월 전에 결과가 끝나는 표본만."""
    out = {k: [] for k in ("idx", "m0", "m1", "b0", "b1", "b2")}
    years = range(int(test_start[:4]), min(int(test_end[:4]), int(dates[-1][:4])) + 1)
    for yr in years:
        t0, t1 = f"{yr}0101", f"{yr + 1}0101"
        if mode == "forward":
            train = [i for i in rows(TRAIN_START, t0) if i + H < idx_of[next(d for d in dates if d >= t0)]]
        else:  # 역방향: 평가 구간 이후만으로 학습
            train = [i for i in rows(test_end, "99999999")]
        test = rows(max(t0, test_start), min(t1, test_end))
        if mode != "forward":  # 결과 창이 학습 구간으로 넘어가는 평가 표본 제외
            test = [i for i in test if i + H < idx_of[next(d for d in dates if d >= test_end)]]
        if len(train) < 150 or not test:
            continue
        train, test = np.array(train), np.array(test)
        p0, p1, p2 = baselines(train, test)
        out["idx"] += list(test)
        out["m0"] += list(fit_predict(train, test, M0_COLS))
        out["m1"] += list(fit_predict(train, test, M1_COLS))
        out["b0"] += list(p0); out["b1"] += list(p1); out["b2"] += list(p2)
    return {k: np.array(v) for k, v in out.items()}


def brier(p, y): return float(np.mean((p - y) ** 2))
def logloss(p, y):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def calib_slope(p, y):
    p = np.clip(p, 1e-3, 1 - 1e-3)
    z = np.log(p / (1 - p)).reshape(-1, 1)
    if y.sum() < 3:
        return float("nan")
    return float(LogisticRegression(C=1e6, max_iter=1000).fit(z, y).coef_[0][0])


def skill(pm, pb, y): return 1 - np.sum((pm - y) ** 2) / np.sum((pb - y) ** 2)


def boot_skill(pm, pb, y):
    n = len(y)
    nb = int(np.ceil(n / BLOCK))
    ev, eb = (pm - y) ** 2, (pb - y) ** 2
    starts = rng.integers(0, n - BLOCK + 1, size=(NBOOT, nb))
    ix = (starts[:, :, None] + np.arange(BLOCK)).reshape(NBOOT, -1)[:, :n]
    s = 1 - ev[ix].sum(1) / eb[ix].sum(1)
    return np.percentile(s, [5, 50, 95])


def indep_events(ix, y):
    ev, last = 0, -999
    for i in ix[y == 1]:
        if i - last > H:
            ev += 1
        last = i
    return ev


def report(name, r, key_models=("m0", "m1")):
    ix = r["idx"]
    y = Y[ix]
    era = np.array([dates[i] >= SPLIT_ERA for i in ix])
    ev = indep_events(ix, y)
    print(f"\n===== {name} =====")
    print(f"예측 {len(ix)}회 · T1 발생 {int(y.sum())}회({y.mean():.1%}) · 독립 사건 {ev}건 · {dates[ix[0]]}~{dates[ix[-1]]}")
    print(f"{'모델':<4} {'Brier':>8} {'logloss':>8} {'보정기울기':>9}  스킬 vs B0 / B1 / B2")
    for k in ("b0", "b1", "b2", "m0", "m1"):
        p = r[k]
        sk = " / ".join(f"{skill(p, r[b], y):+.3f}" for b in ("b0", "b1", "b2")) if k.startswith("m") else ""
        print(f"{k:<4} {brier(p, y):8.4f} {logloss(p, y):8.4f} {calib_slope(p, y):9.2f}  {sk}")
    verdicts = {}
    for k in key_models:
        p = r[k]
        lo, mid, hi = boot_skill(p, r["b1"], y)
        s_all = skill(p, r["b1"], y)
        s_a = skill(p[~era], r["b1"][~era], y[~era]) if (~era).sum() > 20 else float("nan")
        s_b = skill(p[era], r["b1"][era], y[era]) if era.sum() > 20 else float("nan")
        sl = calib_slope(p, y)
        print(f"[{k}] 스킬(vs B1) {s_all:+.3f} · 블록부트 90% [{lo:+.3f}, {hi:+.3f}] · 2013~2019 {s_a:+.3f} · 2020~ {s_b:+.3f} · 기울기 {sl:.2f}")
        ok = (s_all > 0 and lo > 0 and s_a > 0 and s_b > 0 and 0.7 <= sl <= 1.3)
        if ev < 15:
            v = "보류 (독립 사건 15건 미만)"
        elif ok:
            v = "통과"
        elif s_all <= 0 or (hi < 0.0 or (lo <= 0 <= hi and s_all < 0)):
            v = "기각"
        else:
            v = "기준 미충족 — 기각(통과 조건 일부 실패)"
        verdicts[k] = v
        print(f"    판정: {v}")
    # 보정 표 (M1)
    for k in key_models:
        p = r[k]
        qs = np.quantile(p, [0, .2, .4, .6, .8, 1.0])
        print(f"  [{k}] 예측확률 5분위별 실제 비율")
        for a, b in zip(qs[:-1], qs[1:]):
            m = (p >= a) & (p <= b)
            print(f"    예측 {a:.2f}~{b:.2f}: n={m.sum():3d} 평균예측 {p[m].mean():.3f} 실제 {y[m].mean():.3f}")
    return verdicts


def main():
    print("특징 8개: 변동성백분위·VKOSPI비·200일선괴리·120일고점거리·외국인20일백분위·신용60일변화·원달러20일변화·VIX(log)")
    print(f"M0 = 특징 {[c + 1 for c in M0_COLS]} / M1 = 전체 8개 / T1 = {H}거래일 내 최대낙폭 ≤ {DROP:.0%}")
    r = walk_forward(TEST_START, "99999999")
    report("주 판정: 학습 2006~ → 평가 2013~ 워크포워드", r)
    rr = walk_forward("20060101", "20130101", mode="reverse")
    if len(rr["idx"]):
        report("기술(판정 아님): 역방향 — 2013~ 학습 → 2006~2012 평가", rr)
    # M1 계수 방향(전체 구간 학습, 해석용 기술)
    allr = np.array(rows(TRAIN_START, "99999999"))
    mu, sd = X[allr].mean(0), X[allr].std(0) + 1e-9
    m = LogisticRegression(C=1.0, max_iter=1000).fit((X[allr] - mu) / sd, Y[allr])
    names = ["변동성백분위", "VKOSPI비", "200일선괴리", "120일고점거리", "외국인백분위", "신용변화", "환율변화", "VIX"]
    print("\n[기술] M1 전체 구간 표준화 계수:", ", ".join(f"{n} {c:+.2f}" for n, c in zip(names, m.coef_[0])))


if __name__ == "__main__":
    main()
