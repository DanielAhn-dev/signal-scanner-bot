# -*- coding: utf-8 -*-
"""
H47·H48 (2026-10-15, 판정 기준은 hypothesis-ledger.md에 결과 보기 전 고정).

H47 신용융자 과열: A = 신용융자 ÷ 투자자예탁금이 직전 250거래일 상위 10%,
                  B = 신용융자 20거래일 증가율이 직전 250거래일 상위 10%.
    → 코스피 이후 60거래일 최대낙폭(중앙값·−10% 도달률).
H48 반대매매 급증: 미수금 실제 반대매매금액 5거래일 합이 직전 250거래일 상위 5% → 이후 60거래일 수익.
공표 지연을 감안해 날짜 t의 신호는 t−2거래일까지 자료만 쓴다(코스피 거래일 축 기준).
데이터: freesis_credit.json·freesis_funds.json(fetch_freesis_credit.py), kospi.json, allweather/kr_index_KQ11.json(보조).
실행: python scripts/research/validate_credit_market.py > .research-cache/credit_market_out.txt
"""
import sys, os, json
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
END, SPLIT = "20260930", "20160101"
LAG, LONG, SHORT, NW_LAG = 2, 60, 20, 60

Kd = dict(json.load(open(C + "kospi.json", encoding="utf-8")))
dates = sorted(d for d in Kd if d <= END)
T = len(dates)
K = np.array([Kd[d] for d in dates], float)
credit = json.load(open(C + "freesis_credit.json"))
funds = json.load(open(C + "freesis_funds.json"))


def on_axis(d, pick):
    out = np.full(T, np.nan)
    for i, x in enumerate(dates):
        v = d.get(x)
        if v is not None and pick(v) is not None:
            out[i] = pick(v)
    return out


CR = on_axis(credit, lambda v: v[0] or None)
DEP = on_axis(funds, lambda v: v[0] or None)
LIQ = on_axis(funds, lambda v: v[4])
LIQ[: np.argmax(np.nan_to_num(LIQ) > 0)] = np.nan  # 첫 유효일(2006-04) 전은 0이 아니라 결측

kq_path = C + "allweather/kr_index_KQ11.json"
KQd = {d: c for d, _a, c in json.load(open(kq_path, encoding="utf-8"))} if os.path.exists(kq_path) else {}
KQ = np.array([KQd.get(d, np.nan) for d in dates], float)


def shift(x, n):
    out = np.full(T, np.nan)
    out[n:] = x[:-n]
    return out


def rolling_sum(x, w):
    out = np.full(T, np.nan)
    for i in range(w - 1, T):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).all():
            out[i] = seg.sum()
    return out


def pct_flag(x, q):
    """x[i]가 직전 250거래일(x[i-250:i]) 분포의 q 분위 이상인가. 계산 가능 여부도 같이."""
    flag, ok = np.zeros(T, bool), np.zeros(T, bool)
    for i in range(250, T):
        hist = x[i - 250:i]
        hist = hist[np.isfinite(hist)]
        if len(hist) > 225 and np.isfinite(x[i]):
            ok[i] = True
            flag[i] = x[i] >= np.percentile(hist, q)
    return flag, ok


L = shift(CR / DEP, LAG)
G20 = shift(CR / shift(CR, 20) - 1, LAG)
LQ5 = shift(rolling_sum(LIQ, 5), LAG)
A, okA = pct_flag(L, 90)
B, okB = pct_flag(G20, 90)
Lq, okL = pct_flag(LQ5, 95)


def fwd_mdd(P, h):
    out = np.full(T, np.nan)
    for i in range(T - h):
        seg = P[i:i + h + 1]
        if np.isfinite(seg).all():
            out[i] = seg.min() / P[i] - 1
    return out


MDD60, MDD20 = fwd_mdd(K, LONG), fwd_mdd(K, SHORT)
KQ60 = fwd_mdd(KQ, LONG)
logK = np.log(K)
R60 = np.full(T, np.nan); R60[:-LONG] = logK[LONG:] - logK[:-LONG]
R20 = np.full(T, np.nan); R20[:-SHORT] = logK[SHORT:] - logK[:-SHORT]
is_in = np.array([d < SPLIT for d in dates])


def events(flag, ok):
    ev, last = [], -999
    for i in np.where(flag & ok)[0]:
        if i - last > LONG:
            ev.append(i)
        last = i
    return ev


def nw_t(y, x, lag=NW_LAG):
    X1 = np.column_stack([np.ones(len(y)), x])
    b, *_ = np.linalg.lstsq(X1, y, rcond=None)
    u = y - X1 @ b
    XtX_inv = np.linalg.inv(X1.T @ X1)
    Xu = X1 * u[:, None]
    S = Xu.T @ Xu
    for k in range(1, lag + 1):
        Gk = Xu[k:].T @ Xu[:-k]
        S += (1 - k / (lag + 1)) * (Gk + Gk.T)
    V = XtX_inv @ S @ XtX_inv
    return b[1], b[1] / np.sqrt(V[1, 1])


def h47_one(name, flag, ok):
    base = ok & np.isfinite(MDD60)
    idx = np.where(base)[0]
    ev = events(flag, base)
    print(f"\n[H47-{name}] 기간 {dates[idx[0]]}~{dates[idx[-1]]} · 유효일 {len(idx)} · 신호일 {int((flag & base).sum())} · 독립 사건 {len(ev)}건")
    print("  사건: " + ", ".join(f"{dates[i][:6]}({MDD60[i]*100:+.0f}%)" for i in ev))
    res = {}
    for nm, sel in (("안(~2015)", is_in), ("밖(2016~)", ~is_in), ("전체", np.ones(T, bool))):
        f, r = flag & base & sel, ~flag & base & sel
        if f.sum() == 0:
            print(f"  {nm}: 신호일 없음"); res[nm] = None; continue
        hf, hr = np.mean(MDD60[f] <= -0.10), np.mean(MDD60[r] <= -0.10)
        mf, mr = np.median(MDD60[f]), np.median(MDD60[r])
        res[nm] = (mf, mr, hf, hr)
        kq = KQ60[f & np.isfinite(KQ60)]
        kqr = KQ60[r & np.isfinite(KQ60)]
        print(f"  {nm:9s} 신호 n={int(f.sum()):4d} · 60일 낙폭 중앙 {mf*100:+.1f}% vs {mr*100:+.1f}% · −10% 도달 {hf*100:.0f}% vs {hr*100:.0f}% ({hf/hr if hr else float('nan'):.2f}배)"
              f" | [보조] 20일 −7% {np.mean(MDD20[f] <= -0.07)*100:.0f}% vs {np.mean(MDD20[r] <= -0.07)*100:.0f}%"
              f" · 코스닥 60일 −10% {np.mean(kq <= -0.10)*100 if len(kq) else float('nan'):.0f}% vs {np.mean(kqr <= -0.10)*100 if len(kqr) else float('nan'):.0f}%")
    if len(ev) < 6:
        v = "보류(표본 부족)"
    elif all(res[p] and res[p][0] < res[p][1] and res[p][2] >= 1.5 * res[p][3] for p in ("안(~2015)", "밖(2016~)")):
        v = "통과"
    else:
        v = "기각"
    print(f"  판정 → {v}")
    return v


def h48():
    base = okL & np.isfinite(R60)
    idx = np.where(base)[0]
    ev = events(Lq, base)
    print(f"\n[H48] 반대매매 급증 · 기간 {dates[idx[0]]}~{dates[idx[-1]]} · 유효일 {len(idx)} · 신호일 {int((Lq & base).sum())} · 독립 사건 {len(ev)}건")
    print("  사건: " + ", ".join(f"{dates[i][:6]}({R60[i]*100:+.0f}%)" for i in ev))
    res = {}
    for nm, sel in (("안(~2015)", is_in), ("밖(2016~)", ~is_in), ("전체", np.ones(T, bool))):
        m = base & sel
        b, t = nw_t(R60[m], Lq[m].astype(float))
        f, r = Lq & m, ~Lq & m
        res[nm] = (R60[f].mean(), R60[r].mean(), t)
        r20f, r20r = R20[f & np.isfinite(R20)], R20[r & np.isfinite(R20)]
        print(f"  {nm:9s} 신호 n={int(f.sum()):4d} · 60일 수익 평균 {R60[f].mean()*100:+.2f}% vs {R60[r].mean()*100:+.2f}% (차 {b*100:+.2f}%p, NW t {t:+.2f})"
              f" | [보조] 20일 {r20f.mean()*100:+.2f}% vs {r20r.mean()*100:+.2f}% · 60일 낙폭 중앙 {np.median(MDD60[f])*100:+.1f}% vs {np.median(MDD60[r])*100:+.1f}%")
    halves = ("안(~2015)", "밖(2016~)")
    if len(ev) < 6:
        v = "보류(표본 부족)"
    elif res["전체"][2] >= 2 and all(res[p][0] > res[p][1] for p in halves):
        v = "통과: 반대매매 급증 뒤 평소보다 오름"
    elif res["전체"][2] <= -2 and all(res[p][0] < res[p][1] for p in halves):
        v = "반대 방향: 반대매매 뒤 더 빠짐"
    else:
        v = "기각"
    print(f"  판정 → {v}")


if __name__ == "__main__":
    print("H47·H48 시장 신용융자·반대매매 (FreeSIS)")
    print(f"신용융자 ÷ 예탁금 범위 {np.nanmin(L):.3f}~{np.nanmax(L):.3f} · 최근 {L[np.where(np.isfinite(L))[0][-1]]:.3f}")
    h47_one("A 레버리지 비율 상위 10%", A, okA)
    h47_one("B 신용 20일 급증 상위 10%", B, okB)
    h48()
