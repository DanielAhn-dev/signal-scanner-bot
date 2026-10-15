# -*- coding: utf-8 -*-
"""
H45·H46 (2026-10-15, 판정 기준은 hypothesis-ledger.md에 결과 보기 전 고정).

H45 수급 선후 관계: 외국인 20일 순매수(정규화 Fz)에서 직전 코스피·S&P500 수익으로 설명되는 부분을 뺀
     잔차가 이후 20거래일 코스피 수익을 예측하는가. 계수는 안 구간(~2015)에서만 추정.
H46 세계 요인 vs 한국 고유 매도: H29a C(외국인 20일 누적 하위 10%) 매도일을 세계 위험회피 동반(G)과
     한국 고유(K)로 나눠 이후 20거래일 최대낙폭을 비교.

미국 자료는 한국 날짜 t보다 앞선 마지막 미국 종가를 쓴다(미국 종가는 한국 장 마감 뒤).
데이터: kospi.json, kospi_investor_flow.json(2004~), yh_GSPC_daily.json, allweather/us__VIX.json,
       allweather/us_KRW_X.json(보조), yh_TNX_daily.json(없을 때만 받음).
실행: python scripts/research/validate_flow_lead_lag.py > .research-cache/flow_lead_lag_out.txt
"""
import sys, os, json, bisect
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from fetch_allweather_data import fetch_us

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
END, SPLIT = "20260930", "20160101"
HOLD, LONG, NW_LAG = 20, 60, 20


def kv(path, pick=lambda v: v):
    raw = json.load(open(C + path, encoding="utf-8"))
    d = dict((r[0], r[1:] if len(r) > 2 else r[1]) for r in raw) if isinstance(raw, list) else raw
    return {k: pick(v) for k, v in d.items() if v is not None}


Kd = kv("kospi.json")
dates = sorted(d for d in Kd if d <= END)
T = len(dates)
K = np.array([Kd[d] for d in dates], float)
flow = kv("kospi_investor_flow.json", lambda v: v[1])
FOR = np.array([flow.get(d, np.nan) for d in dates], float)

tnx_path = C + "yh_TNX_daily.json"
if not os.path.exists(tnx_path):
    json.dump(fetch_us("^TNX"), open(tnx_path, "w", encoding="utf-8"))


def us_series(path, pick):
    """미국 일봉 → (날짜 목록, 값 배열)."""
    raw = json.load(open(C + path, encoding="utf-8"))
    rows = sorted((r[0], pick(r)) for r in raw if pick(r) is not None)
    return [r[0] for r in rows], np.array([r[1] for r in rows], float)


def prior_index(us_dates, d):
    """한국 날짜 d보다 앞선(엄격히 작은) 마지막 미국 거래일 위치."""
    return bisect.bisect_left(us_dates, d) - 1


SPd, SP = us_series("yh_GSPC_daily.json", lambda r: r[1])
VXd, VX = us_series("allweather/us__VIX.json", lambda r: r[2])
TNd, TN = us_series("yh_TNX_daily.json", lambda r: r[2])
KWd, KW = us_series("allweather/us_KRW_X.json", lambda r: r[2])


def us_feature(us_d, us_v, fn, need):
    out = np.full(T, np.nan)
    for i, d in enumerate(dates):
        j = prior_index(us_d, d)
        if j >= need and us_d[j] >= "20000101":
            out[i] = fn(us_v, j)
    return out


S20 = us_feature(SPd, SP, lambda v, j: np.log(v[j] / v[j - 20]), 20)
VX5 = us_feature(VXd, VX, lambda v, j: v[j - 4:j + 1].mean(), 60)
VX60 = us_feature(VXd, VX, lambda v, j: v[j - 59:j + 1].mean(), 60)
TN20 = us_feature(TNd, TN, lambda v, j: v[j] - v[j - 20], 20)  # %p
KW20 = us_feature(KWd, KW, lambda v, j: v[j] / v[j - 20] - 1, 20)


def rolling(x, w, fn):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).sum() >= int(w * 0.9):
            out[i] = fn(seg)
    return out


F20 = rolling(FOR, 20, np.nansum)
Fz = np.full(T, np.nan)
SELL = np.zeros(T, bool)
c_ok = np.zeros(T, bool)
for i in range(270, T):
    hist = F20[i - 250:i]
    hist = hist[np.isfinite(hist)]
    if len(hist) > 200 and np.isfinite(F20[i]):
        c_ok[i] = True
        SELL[i] = F20[i] <= np.percentile(hist, 10)  # H29a C 그대로
        Fz[i] = F20[i] / np.std(hist, ddof=1)

logK = np.log(K)
K20 = np.full(T, np.nan)
K20[20:] = logK[20:] - logK[:-20]
FWD = np.full(T, np.nan)
FWD[:-HOLD] = logK[HOLD:] - logK[:-HOLD]
MDD = np.full(T, np.nan)
MDD60 = np.full(T, np.nan)
for i in range(T - HOLD):
    MDD[i] = K[i:i + HOLD + 1].min() / K[i] - 1
    if i + LONG < T:
        MDD60[i] = K[i:i + LONG + 1].min() / K[i] - 1

is_in = np.array([d < SPLIT for d in dates])


def ols(y, X):
    X1 = np.column_stack([np.ones(len(y)), X])
    b, *_ = np.linalg.lstsq(X1, y, rcond=None)
    return b, X1


def nw_slope_t(y, x, lag=NW_LAG):
    """y = a + b x, Bartlett HAC 표준오차로 b의 t."""
    b, X1 = ols(y, x)
    u = y - X1 @ b
    n = len(y)
    XtX_inv = np.linalg.inv(X1.T @ X1)
    Xu = X1 * u[:, None]
    S = Xu.T @ Xu
    for L in range(1, lag + 1):
        w = 1 - L / (lag + 1)
        G = Xu[L:].T @ Xu[:-L]
        S += w * (G + G.T)
    V = XtX_inv @ S @ XtX_inv
    return b[1], b[1] / np.sqrt(V[1, 1]), n


def quint_spread(e, y):
    qs = np.percentile(e, [20, 80])
    return y[e >= qs[1]].mean() - y[e <= qs[0]].mean()


def h45():
    print("=" * 70)
    print("H45 외국인 수급 선후 관계")
    base = c_ok & np.isfinite(Fz) & np.isfinite(K20) & np.isfinite(S20)
    first = int(np.argmax(base))
    print(f"Fz 계산 시작 {dates[first]} · 끝 {dates[np.where(base)[0][-1]]} · 유효일 {int(base.sum())}")

    fit_sel = base & is_in
    coef, _ = ols(Fz[fit_sel], np.column_stack([K20[fit_sel], S20[fit_sel]]))
    pred = coef[0] + coef[1] * K20 + coef[2] * S20
    e = Fz - pred
    for nm, sel in (("안(~2015)", base & is_in), ("밖(2016~)", base & ~is_in)):
        y = Fz[sel]
        r2 = 1 - np.sum((y - pred[sel]) ** 2) / np.sum((y - y.mean()) ** 2)
        print(f"  [보조] {nm} Fz를 직전 수익으로 설명한 R² {r2:.3f} (안 구간 계수 적용)")
    print(f"  계수(안 구간): 상수 {coef[0]:+.3f} · K20 {coef[1]:+.3f} · S20 {coef[2]:+.3f}"
          f"  (K20 +10%면 Fz {coef[1]*0.1:+.2f}σ, S20 +10%면 {coef[2]*0.1:+.2f}σ)")
    # 같은 날 반응(보조): Fz 대 K20 상관
    print(f"  [보조] 상관 corr(Fz, 직전 K20) {np.corrcoef(Fz[base], K20[base])[0,1]:+.3f} · "
          f"corr(Fz, 이후 20일 수익) {np.corrcoef(Fz[base & np.isfinite(FWD)], FWD[base & np.isfinite(FWD)])[0,1]:+.3f}")

    ok = base & np.isfinite(FWD)
    out = {}
    print("\n  예측 회귀: 이후 20거래일 코스피 로그수익 ~ 잔차 e (NW lag 20)")
    for nm, sel in (("안(~2015)", ok & is_in), ("밖(2016~)", ok & ~is_in), ("전체", ok)):
        b, t, n = nw_slope_t(FWD[sel], e[sel])
        sp = quint_spread(e[sel], FWD[sel])
        braw, traw, _ = nw_slope_t(FWD[sel], Fz[sel])
        sp_raw = quint_spread(Fz[sel], FWD[sel])
        out[nm] = (b, t, sp)
        print(f"  {nm:9s} n={n:5d} · 잔차 기울기 {b*100:+.2f}%/σ (t {t:+.2f}) · Q5−Q1 {sp*100:+.2f}%p"
              f"  | [보조] 원래 Fz 기울기 {braw*100:+.2f}%/σ (t {traw:+.2f}) · Q5−Q1 {sp_raw*100:+.2f}%p")

    # 보조: 잔차 하위 10% 이후 20일 최대낙폭
    okm = base & np.isfinite(MDD)
    lo = e <= np.nanpercentile(e[okm], 10)
    print(f"\n  [보조] 잔차 하위 10% 이후 20일 최대낙폭 중앙값 {np.median(MDD[okm & lo])*100:+.1f}% vs 나머지 {np.median(MDD[okm & ~lo])*100:+.1f}%"
          f" · −7% 도달 {np.mean(MDD[okm & lo] <= -0.07)*100:.0f}% vs {np.mean(MDD[okm & ~lo] <= -0.07)*100:.0f}%")
    # 보조: 직전 수익이 이후 수급을 설명하는가(피드백 방향)
    F_next = np.full(T, np.nan)
    F_next[:-HOLD] = Fz[HOLD:]
    okf = base & np.isfinite(F_next)
    bf, tf, _ = nw_slope_t(F_next[okf], K20[okf])
    print(f"  [보조] 반대 방향: 이후 20일 Fz ~ 직전 K20 기울기 {bf*0.1:+.2f}σ/10% (t {tf:+.2f})")

    pass1 = out["안(~2015)"][2] >= 0.01 and out["밖(2016~)"][2] >= 0.01
    pass2 = out["전체"][1] >= 2
    pass3 = out["안(~2015)"][0] > 0 and out["밖(2016~)"][0] > 0
    print(f"\n  판정: ① 두 구간 Q5−Q1 ≥ +1%p {pass1} · ② 전체 NW t ≥ 2 {pass2} · ③ 두 구간 기울기 양 {pass3}")
    print("  → " + ("통과: 가격을 앞서는 수급 성분 있음" if pass1 and pass2 and pass3
                    else "기각: 수급은 가격을 따라가거나 같이 움직일 뿐, 시점 예측에 못 씀"))


def events_of(flag, idx):
    ev, last = [], -999
    for i in idx:
        if flag[i]:
            if i - last > HOLD:
                ev.append(i)
            last = i
    return ev


def h46():
    print("\n" + "=" * 70)
    print("H46 세계 위험회피 동반 매도(G) vs 한국 고유 매도(K)")
    g_ok = np.isfinite(S20) & np.isfinite(VX5) & np.isfinite(VX60) & np.isfinite(TN20)
    g1 = S20 <= np.log(0.97)
    g2 = VX5 >= 1.25 * VX60
    g3 = TN20 >= 0.40
    G = g_ok & (g1 | g2 | g3)
    ok = c_ok & g_ok & np.isfinite(MDD)
    idx = [i for i in range(T) if ok[i]]
    print(f"기간 {dates[idx[0]]}~{dates[idx[-1]]} · 유효일 {len(idx)} · 매도일 {int((SELL & ok).sum())}"
          f" · 그중 G {int((SELL & G & ok).sum())} / K {int((SELL & ~G & ok).sum())}")
    print(f"  [보조] 매도일 중 조건별: S&P −3% {int((SELL & ok & g1).sum())} · VIX 급등 {int((SELL & ok & g2).sum())} · 금리 +0.4%p {int((SELL & ok & g3).sum())}"
          f" · 아무 날 G 비율 {np.mean(G[ok])*100:.0f}% / 매도일 G 비율 {np.mean(G[ok & SELL])*100:.0f}%")

    flagG, flagK = SELL & G & ok, SELL & ~G & ok
    evG, evK = events_of(flagG, idx), events_of(flagK, idx)
    print(f"  독립 사건: G {len(evG)}건 · K {len(evK)}건")
    for nm, ev in (("G", evG), ("K", evK)):
        print(f"   {nm}: " + ", ".join(f"{dates[i][:6]}({MDD[i]*100:+.0f}%)" for i in ev))

    res = {}
    for nm, sel in (("안(~2015)", is_in), ("밖(2016~)", ~is_in), ("전체", np.ones(T, bool))):
        row = {}
        for gn, f in (("G", flagG), ("K", flagK), ("매도아님", ok & ~SELL)):
            m = MDD[f & sel]
            m60 = MDD60[f & sel & np.isfinite(MDD60)]
            kw = KW20[f & sel]
            kw = kw[np.isfinite(kw)]
            row[gn] = (np.median(m) if len(m) else np.nan, np.mean(m <= -0.07) if len(m) else np.nan, len(m))
            print(f"  {nm:9s} {gn:4s} n={len(m):4d} · 20일 낙폭 중앙 {row[gn][0]*100:+.1f}% · −7% 도달 {row[gn][1]*100:4.0f}%"
                  f" · [보조] 60일 −10% {np.mean(m60 <= -0.10)*100 if len(m60) else float('nan'):4.0f}%"
                  f" · 원/달러 20일 중앙 {np.median(kw)*100 if len(kw) else float('nan'):+.1f}%")
        res[nm] = row

    def wins(a, b):
        return all(res[p][a][0] < res[p][b][0] and res[p][a][1] >= 1.5 * res[p][b][1]
                   for p in ("안(~2015)", "밖(2016~)") if res[p][a][2] and res[p][b][2]) \
            and all(res[p][a][2] and res[p][b][2] for p in ("안(~2015)", "밖(2016~)"))

    if len(evG) < 6 or len(evK) < 6:
        verdict = "보류(표본 부족 — 그룹별 독립 사건 6건 미만)"
    elif wins("K", "G"):
        verdict = "통과: 한국 고유 매도가 더 위험"
    elif wins("G", "K"):
        verdict = "통과: 세계 동반 매도가 더 위험"
    else:
        verdict = "기각: 차이 없음"
    print(f"\n  판정 → {verdict}")


if __name__ == "__main__":
    h45()
    h46()
