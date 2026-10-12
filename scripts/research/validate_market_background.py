# -*- coding: utf-8 -*-
"""
시장 배경 신호 검증 H29 / H35 (2026-10-12). 정의와 판정 기준은 docs/hypothesis-ledger.md의 H29a·H35에 결과 보기 전 고정.

신호(종가 t까지의 정보만 사용)
  A 과열        : 코스피 종가 ≥ 200일 이동평균 × 1.20
  B 시장 폭 악화 : 코스피가 120일 고점의 97% 이상인데 유니버스 종목 중 50일선 위 비율 ≤ 45%
  C 외국인 매도  : 외국인 20거래일 누적 순매수가 직전 250거래일 분포의 하위 10%
  D 변동성 상승  : VKOSPI 5일 평균 ≥ 60일 평균 × 1.25
  '조합 충족' = 4개 중 3개 이상. 기간 2017-01~, 안 구간 ~2020, 밖 구간 2021~.

H29 (지수): 충족일 vs 나머지의 이후 20거래일 최대 낙폭 중앙값, −7% 도달률.
H35 (진입): 충족일 종가 신호 → 다음날 시가 진입 → 20거래일 뒤 종가, 상위 300 동일가중. 5거래일마다 표본.

실행: python scripts/research/validate_market_background.py
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T = vt.dates, vt.T
O, Cf = vt.O, vt.Cf
C = ".research-cache/"
START, SPLIT = "20170101", "20210101"
HOLD, STEP = 20, 5


def series(path, pick=lambda v: v):
    raw = json.load(open(C + path, encoding="utf-8"))
    d = dict(raw) if isinstance(raw, list) else {k: v for k, v in raw.items()}
    out = np.full(T, np.nan)
    for i, dt in enumerate(dates):
        v = d.get(dt)
        if v is not None:
            out[i] = pick(v)
    return out


K = series("kospi.json")
VK = series("vkospi.json")
FOR = series("kospi_investor_flow.json", lambda v: v[1] if v else np.nan)
FOR0 = np.nan_to_num(FOR)


def rolling(x, w, fn):
    out = np.full(T, np.nan)
    for i in range(w - 1, T):
        out[i] = fn(x[i - w + 1:i + 1])
    return out


def build_signals():
    ma200 = rolling(K, 200, np.nanmean)
    hi120 = rolling(K, 120, np.nanmax)
    A = K >= 1.20 * ma200
    # 시장 폭: 종목별 50일선 위 비율
    cs = np.cumsum(np.nan_to_num(Cf), axis=0)
    ma50 = np.full_like(Cf, np.nan)
    ma50[49:] = (cs[49:] - np.vstack([np.zeros((1, Cf.shape[1])), cs[:-50]])) / 50
    valid = np.isfinite(Cf) & np.isfinite(ma50)
    breadth = np.where(valid.sum(axis=1) > 100, ((Cf > ma50) & valid).sum(axis=1) / np.maximum(valid.sum(axis=1), 1), np.nan)
    B = (K >= 0.97 * hi120) & (breadth <= 0.45)
    F20 = np.full(T, np.nan)
    for i in range(19, T):
        F20[i] = FOR0[i - 19:i + 1].sum()
    Cs = np.zeros(T, bool)
    for i in range(270, T):
        hist = F20[i - 250:i]
        hist = hist[np.isfinite(hist)]
        if len(hist) > 200 and np.isfinite(F20[i]):
            Cs[i] = F20[i] <= np.percentile(hist, 10)
    v5, v60 = rolling(VK, 5, np.nanmean), rolling(VK, 60, np.nanmean)
    D = v5 >= 1.25 * v60
    return A, B, Cs, D


def nw_diff_t(y, flag, lag=12):
    """y = a + b·flag 의 b에 대한 Newey-West t"""
    y, flag = np.asarray(y, float), np.asarray(flag, float)
    X = np.column_stack([np.ones(len(y)), flag])
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    u = y - X @ beta
    S = (X * u[:, None]).T @ (X * u[:, None])
    for l in range(1, lag + 1):
        w = 1 - l / (lag + 1)
        G = (X[l:] * u[l:, None]).T @ (X[:-l] * u[:-l, None])
        S += w * (G + G.T)
    XtXi = np.linalg.inv(X.T @ X)
    V = XtXi @ S @ XtXi
    return beta[1], beta[1] / np.sqrt(V[1, 1])


def main():
    A, B, Cs, D = build_signals()
    cnt = A.astype(int) + B.astype(int) + Cs.astype(int) + D.astype(int)
    flag = cnt >= 3
    ok_day = np.array([dt >= START for dt in dates]) & np.isfinite(K)
    print("신호 일수(2017~):", {n: int((s & ok_day).sum()) for n, s in zip("ABCD", (A, B, Cs, D))}, "조합(3/4):", int((flag & ok_day).sum()))

    # ---- H29: 지수 20거래일 최대 낙폭
    idx = [i for i in range(T - HOLD - 1) if ok_day[i] and np.isfinite(K[i:i + HOLD + 1]).all()]
    mdd = {i: np.min(K[i:i + HOLD + 1]) / K[i] - 1 for i in idx}
    events, last = [], -999
    for i in idx:
        if flag[i]:
            if i - last > HOLD:
                events.append(i)
            last = i
    print(f"\n[H29] 독립 사건 {len(events)}건: " + ", ".join(dates[i] for i in events))
    res = {}
    for name, sel in (("안(~2020)", lambda d: d < SPLIT), ("밖(2021~)", lambda d: d >= SPLIT)):
        f = np.array([mdd[i] for i in idx if flag[i] and sel(dates[i])])
        r = np.array([mdd[i] for i in idx if not flag[i] and sel(dates[i])])
        ne = sum(1 for e in events if sel(dates[e]))
        if len(f) == 0:
            print(f"  {name}: 충족일 없음"); res[name] = None; continue
        h7f, h7r = (f <= -0.07).mean(), (r <= -0.07).mean()
        res[name] = (np.median(f), np.median(r), h7f, h7r)
        print(f"  {name}: 충족 {len(f)}일(사건 {ne}) 낙폭 중앙값 {np.median(f)*100:+.1f}% vs 나머지 {np.median(r)*100:+.1f}% | −7% 도달 {h7f*100:.0f}% vs {h7r*100:.0f}% (배수 {h7f/max(h7r,1e-9):.2f})")
    if len(events) < 6:
        print("  → H29 판정: 표본 부족 — 보류 (독립 사건 6건 미만)")
    else:
        passed = all(v and v[0] < v[1] and v[2] >= 1.5 * v[3] for v in res.values())
        print(f"  → H29 판정: {'통과' if passed else '기각'}")

    # ---- H35: 봇 유니버스 신규 진입
    rows = []
    for t in range(261, T - HOLD - 2, STEP):
        if not ok_day[t]:
            continue
        idx_u = np.where(lc.topm(t))[0]
        e, x = t + 1, t + HOLD
        y = Cf[x, idx_u] / O[e, idx_u] - 1
        y = y[np.isfinite(y)]
        if len(y) < 100:
            continue
        rows.append((dates[t], y.mean(), bool(flag[t])))
    print(f"\n[H35] 표본일 {len(rows)} · 충족일 {sum(r[2] for r in rows)}")
    out = {}
    for name, sel in (("안", lambda d: d < SPLIT), ("밖", lambda d: d >= SPLIT), ("전체", lambda d: True)):
        sub = [r for r in rows if sel(r[0])]
        yf = np.array([r[1] for r in sub if r[2]]); yn = np.array([r[1] for r in sub if not r[2]])
        if len(yf) == 0:
            print(f"  {name}: 충족일 없음"); out[name] = None; continue
        b, t_ = nw_diff_t([r[1] for r in sub], [r[2] for r in sub])
        out[name] = (yf.mean() - yn.mean(), t_)
        print(f"  {name}: 충족 {len(yf)}일 평균 {yf.mean()*100:+.2f}% vs 나머지 {yn.mean()*100:+.2f}% → 차이 {(yf.mean()-yn.mean())*100:+.2f}%p (NW t {t_:.2f})")
    if len(events) < 6:
        print("  → H35 판정: 표본 부족 — 보류 (독립 사건 6건 미만)")
    elif out["안"] and out["밖"] and out["안"][0] <= -0.01 and out["밖"][0] <= -0.01 and out["전체"][1] <= -2:
        print("  → H35 판정: 통과 (11/23 관문 안건 후보)")
    else:
        print("  → H35 판정: 기각")


if __name__ == "__main__":
    main()
