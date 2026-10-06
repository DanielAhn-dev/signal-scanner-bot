# -*- coding: utf-8 -*-
"""복합 선호 점수 F2 (2026-10-06 밤). 기준은 hypothesis-ledger C22에 결과 보기 전 고정.
저변동(20일 변동성 낮음) + 52주 고가 근접 + ROE 순위 평균 → 5분위 20일 초과수익(같은 날 평균 대비). 회피 3규칙 적용 여부 둘 다."""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_entry_features as ef
lc, vt = ef.lc, ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# CLEAN=1: 하루 ±31% 넘는 변동(수정주가 오류·비정상 사건 의심)이 앞 250일~뒤 80일 안에 있는 종목·날짜를 유니버스에서 제외
if os.environ.get("CLEAN"):
    _R = np.vstack([np.full((1, vt.N), np.nan), vt.Cf[1:] / vt.Cf[:-1] - 1])
    _f = (np.abs(np.nan_to_num(_R)) > 0.31).astype(np.int32)
    _cs = np.vstack([np.zeros((1, vt.N), np.int32), np.cumsum(_f, axis=0)])
    for _t in range(vt.T):
        _a, _b = max(0, _t - 250), min(vt.T, _t + 81)
        vt.UNIV[_t] &= (_cs[_b] - _cs[_a]) == 0
T, dates, Cf, O, H, C, V20 = ef.T, ef.dates, ef.Cf, ef.O, ef.H, ef.C, ef.V20
SPLIT, HOLD, STEP = ef.SPLIT, ef.HOLD, ef.STEP


def rank01(x):
    m = np.isfinite(x)
    r = np.full(len(x), np.nan)
    r[m] = np.argsort(np.argsort(x[m])) / max(m.sum() - 1, 1)
    return r


def avoid_mask(t, idx):
    """봇 회피 3규칙 근사: 전날 급등 5일, 긴 윗꼬리, 한 달 -15%"""
    c = Cf[:, idx]
    ret1 = c[t] / c[t - 1] - 1
    tail = H[t, idx] / C[t, idx] - 1 > 0.06
    m21 = c[t] / c[t - 21] - 1 <= -0.15
    surge = np.zeros(len(idx), bool)
    for k in range(5):
        tt = t - k
        r = Cf[tt, idx] / Cf[tt - 1, idx] - 1
        vr = vt.V[tt, idx] / V20[tt - 1, idx]
        close_hi = C[tt, idx] >= 0.95 * H[tt, idx]
        surge |= (r >= 0.08) & (vr >= 5) & close_hi
    return surge | tail | m21


def main():
    rec = {(f, q): [] for f in (0, 1) for q in range(5)}
    spread = {f: [] for f in (0, 1)}
    cost = []
    for t in range(261, T - HOLD - 1, STEP):
        idx = np.where(lc.topm(t))[0]
        e, x = t + 1, t + HOLD
        y = Cf[x, idx] / O[e, idx] - 1
        ok = np.isfinite(y)
        if ok.sum() < 100:
            continue
        idx, y = idx[ok], y[ok]
        f = ef.features(t, idx)
        comp = (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"]) + rank01(f["ROE"])) / 3
        av = avoid_mask(t, idx)
        for filt in (0, 1):
            keep = np.isfinite(comp) & (~av if filt else True)
            if keep.sum() < 80:
                continue
            ex = y[keep] - y[keep].mean() if filt else y[keep] - y.mean()
            cc = comp[keep]
            rk = np.argsort(np.argsort(cc)); q = (rk * 5 // len(cc)).astype(int)
            for k in range(5):
                rec[(filt, k)].append((dates[e], ex[q == k].mean()))
            spread[filt].append((dates[e], ex[q == 4].mean() - ex[q == 0].mean()))
        cost.append(np.mean([lc.rt_cost(j, t) for j in idx[comp >= np.nanpercentile(comp, 80)]]))
    def st(L):
        a = np.array([v for d, v in L if d < SPLIT]); b = np.array([v for d, v in L if d >= SPLIT])
        return a.mean(), vt.nw_t(a, 4), b.mean(), vt.nw_t(b, 4)
    print(f"왕복 비용 평균(상위 20% 종목): {np.mean(cost)*100:.2f}%")
    for filt in (0, 1):
        print(f"\n[{'회피 3규칙 적용 후 (기준: 남은 종목 평균)' if filt else '전체 (기준: 같은 날 평균)'}]")
        for k in range(5):
            a, at, b, bt = st(rec[(filt, k)])
            print(f"  {k+1}분위 (5=최선호): 안 {a*100:+.2f}% (t {at:.1f}) · 밖 {b*100:+.2f}% (t {bt:.1f})")
        a, at, b, bt = st(spread[filt])
        print(f"  5분위-1분위: 안 {a*100:+.2f}% (t {at:.1f}) · 밖 {b*100:+.2f}% (t {bt:.1f})")


if __name__ == "__main__":
    main()
