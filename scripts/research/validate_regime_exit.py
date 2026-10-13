# -*- coding: utf-8 -*-
"""
H43 상황 판단형 청산 (2026-10-13). 판정 기준은 docs/hypothesis-ledger.md H43에 결과 보기 전 고정.

질문: 시장 상태(KODEX 200 종가 vs 50일선, 청산 판단일)에 따라 손절·익절을 미루면 봇 기본(손절 4%·익절 8%)보다 낫나?
  S1 하락장에서는 손절 4%를 미루고 −15% 재난 손절만(익절 8%는 그대로)
  S2 상승장에서는 익절 8%를 미루고 계속 보유(손절 4%는 그대로)
  S3 둘 다
진입·청산은 validate_exit_rules.py(C21)와 같다. 왕복 비용(수수료·세금·슬리피지)을 뺀다.
통과 = 기본 대비 평균 차이가 안(~2021)·밖(2022~) 모두 양수·NW t > 2, 그리고 하위 5% 차이가 두 구간 모두 −3%p 이상.

실행(저장소 루트에서): python scripts/research/validate_regime_exit.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T = vt.dates, vt.T
O, Cf = vt.O, vt.Cf
STEP, D = 5, 60
SPLIT = "20220101"
CASH = 0.03 / 252
SL, TP, DISASTER = 0.04, 0.08, 0.15


def ma(x, w):
    out = np.full_like(x, np.nan)
    for i in range(w - 1, len(x)):
        win = x[i - w + 1:i + 1]
        if np.isfinite(win).all():
            out[i] = win.mean()
    return out


MKT_UP = lc.EC >= ma(lc.EC, 50)  # True = 50일선 위(상승장)
MKT_OK = np.isfinite(lc.EC) & np.isfinite(ma(lc.EC, 50))

VARIANTS = {
    "기본 4/8": dict(),
    "S1 하락장 손절 유예": dict(defer_sl=True),
    "S2 상승장 익절 유예": dict(defer_tp=True),
    "S3 둘 다": dict(defer_sl=True, defer_tp=True),
}


def run(v, P, O1, entry, up):
    """P·O1: (D, n), up: (D,) 그날 시장이 50일선 위인지. 반환 최종 수익 (n,)"""
    n = P.shape[1]
    done = np.zeros(n, bool)
    final = np.full(n, np.nan)
    for d in range(D):
        pc = P[d]
        r = pc / entry - 1
        sl_on = not (v.get("defer_sl") and not up[d])
        tp_on = not (v.get("defer_tp") and up[d])
        trig = r <= -DISASTER
        if sl_on:
            trig |= r <= -SL
        if tp_on:
            trig |= r >= TP
        trig &= ~done & np.isfinite(pc)
        if trig.any():
            ex = O1[d]
            ex = np.where(np.isfinite(ex) & (ex > 0), ex, pc)
            final[trig] = (ex[trig] / entry[trig]) * (1 + CASH) ** (D - 1 - d) - 1
            done |= trig
    final[~done] = P[-1][~done] / entry[~done] - 1
    return final


def main():
    rec = {k: [] for k in VARIANTS}
    tails = {k: [] for k in VARIANTS}
    level = {k: [] for k in VARIANTS}
    up_share = []
    for t in range(261, T - D - 2, STEP):
        idx = np.where(lc.topm(t))[0]
        e = t + 1
        if not MKT_OK[e:e + D].all():
            continue
        entry = O[e, idx]
        P = Cf[e:e + D, :][:, idx]
        O1 = O[e + 1:e + D + 1, :][:, idx]
        ok = np.isfinite(entry) & np.isfinite(P).all(axis=0)
        if ok.sum() < 100:
            continue
        idx, entry, P, O1 = idx[ok], entry[ok], P[:, ok], O1[:, ok]
        cost = np.array([lc.rt_cost(j, t) for j in idx])
        up = MKT_UP[e:e + D]
        up_share.append(up.mean())
        res = {k: run(v, P, O1, entry, up) - cost for k, v in VARIANTS.items()}
        base = res["기본 4/8"]
        for k in VARIANTS:
            rec[k].append((dates[e], (res[k] - base).mean()))
            tails[k].append((dates[e], np.percentile(res[k], 5) - np.percentile(base, 5)))
            level[k].append((dates[e], res[k].mean()))

    def stat(L):
        a = np.array([x for d, x in L if d < SPLIT]); b = np.array([x for d, x in L if d >= SPLIT])
        return a.mean(), vt.nw_t(a, 12), b.mean(), vt.nw_t(b, 12), len(a), len(b)

    print(f"진입 시점 {len(rec['기본 4/8'])}개(5거래일 간격), 보유 중 시장이 50일선 위였던 날 비율 평균 {np.mean(up_share)*100:.0f}%")
    print(f"{'변형':<16}{'평균(비용 후) 안/밖':>22} | {'기본 대비 안':>10}{'t':>6}{'밖':>9}{'t':>6} | 하위5% 차이 안/밖   판정")
    for k in VARIANTS:
        la, _, lb, _, na, nb = stat(level[k])
        a, at, b, bt, _, _ = stat(rec[k])
        ta, _, tb, _, _, _ = stat(tails[k])
        if k == "기본 4/8":
            print(f"{k:<16}{la*100:+9.2f}% / {lb*100:+6.2f}%   | (기준)  표본 안 {na} · 밖 {nb}")
            continue
        passed = a > 0 and b > 0 and at > 2 and bt > 2 and ta >= -0.03 and tb >= -0.03
        print(f"{k:<16}{la*100:+9.2f}% / {lb*100:+6.2f}%   | {a*100:+9.2f}%{at:6.2f}{b*100:+8.2f}%{bt:6.2f} | {ta*100:+6.1f}%p / {tb*100:+6.1f}%p  {'통과' if passed else '기각'}")


if __name__ == "__main__":
    main()
