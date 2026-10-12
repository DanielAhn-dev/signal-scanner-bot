# -*- coding: utf-8 -*-
"""
ATR 확장 손절·수익 잠금 후보 R1·R2 검증 (2026-10-12). 판정 기준은 docs/autotrade-diagnosis-2026-10-12.md 7장과
docs/hypothesis-ledger.md에 결과 보기 전 고정.

틀은 validate_exit_rules.py(C21)와 같다: 거래대금 상위 300, 5거래일마다 다음날 시가 진입, 60거래일,
종가로 조건 확인 → 다음날 시가 청산, 청산 뒤 남은 기간 현금 연 3%, 재진입 없음.
봇 청산 로직(virtualAutoTradeExitDecision·PositionStrategy)을 일봉 종가 점검으로 옮긴 근사다.

  기본(B0): 기본 손절 4% · ATR 확장 stop = max(4%, min(상한, 2.2×ATR%)) · 상한 = min(12%, max(기본×2.5, 기본+3%p))
            익절 = max(8%, stop+1.5%p)(상한 14%), 2분할(첫 도달 시 절반, 다음 점검에서 나머지)
            경직 손절 −10% 전량, 절반 손절 −7%(stop>7%일 때, 1회), 수익 잠금(고점 수익 ≥ +8% 발동: 8~15% 40%, 15~25% 55%, 25%~ 65% 잠금)
  R1: 수익 잠금 발동선 +8% → +5%
  R2: ATR 확장 상한 기본×2.5 → 기본×1.5 (4% → 6%, +3%p 하한 없음)
  R1+R2

한계: 봇은 하루 7회 안팎 장중 점검이라 고점 샘플이 종가보다 높을 수 있다(여기서는 종가 기준 고점).
      시간 손절·추세 이탈·시장 레짐 보정·신호 보정은 모델에 넣지 않았다. 청산 후 재진입 없음. 수량 반올림 없음.

실행: python scripts/research/validate_exit_atr.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, N = vt.dates, vt.T, vt.N
O, H, Cf = vt.O, vt.H, vt.Cf
STEP, D = 5, 60
SPLIT = "20220101"
CASH = 0.03 / 252

# ---- 저가 행렬과 ATR%(14일 단순평균 TR / 종가)
L = np.full((T, N), np.nan)
for j, c in enumerate(vt.codes):
    for r in vt.px[c]:
        L[vt.di[r[0]], j] = r[3]
Cprev = np.vstack([np.full((1, N), np.nan), Cf[:-1]])
TR = np.fmax(H - L, np.fmax(np.abs(H - Cprev), np.abs(L - Cprev)))
cs = np.cumsum(np.nan_to_num(TR), axis=0)
ATRP = np.full((T, N), np.nan)
ATRP[14:] = (cs[14:] - cs[:-14]) / 14 / Cf[14:]
ATRP[~np.isfinite(ATRP)] = np.nan

CONFIGS = {
    "B0 기본": dict(arm=0.08, cap_mult=2.5),
    "R1 잠금 발동선 +5%": dict(arm=0.05, cap_mult=2.5),
    "R2 ATR 상한 ×1.5": dict(arm=0.08, cap_mult=1.5),
    "R1+R2": dict(arm=0.05, cap_mult=1.5),
}
BASE_STOP = 0.04


def stop_pct(atrp, cap_mult):
    cap = min(0.12, max(BASE_STOP * cap_mult, BASE_STOP + 0.03)) if cap_mult >= 2 else min(0.12, BASE_STOP * cap_mult)
    atr = np.where(np.isfinite(atrp), atrp, 0.0)
    return np.clip(np.maximum(BASE_STOP, np.minimum(cap, 2.2 * atr)), 0.015, 0.12)


def simulate(cfg, P, O1, ATR, entry):
    n = P.shape[1]
    frac = np.ones(n)          # 남은 비중
    val = np.zeros(n)          # 청산분 가치(진입가=1 기준)
    peak_gain = np.zeros(n)
    half_done = np.zeros(n, bool)
    tp_done = np.zeros(n, bool)
    n_exits = np.zeros(n)

    def sell(mask, share):
        nonlocal val, frac
        m = mask & (frac > 1e-9)
        if not m.any():
            return
        part = np.where(m, frac * share, 0.0)
        ex = np.where(np.isfinite(O1[d]) & (O1[d] > 0), O1[d], P[d])
        val += part * (ex / entry) * (1 + CASH) ** (D - 1 - d)
        frac -= part
        n_exits[m] += 1

    for d in range(D):
        pc = P[d]
        alive = (frac > 1e-9) & np.isfinite(pc)
        r = pc / entry - 1
        peak_gain = np.where(alive, np.fmax(peak_gain, r), peak_gain)
        stop = stop_pct(ATR[d], cfg["cap_mult"])
        tp = np.clip(np.maximum(0.08, stop + 0.015), 0.03, 0.14)
        # 1) 수익 잠금
        ratio = np.where(peak_gain >= 0.25, 0.65, np.where(peak_gain >= 0.15, 0.55, 0.40))
        lock = alive & (peak_gain >= cfg["arm"]) & (r <= peak_gain * ratio)
        sell(lock, 1.0)
        alive &= ~lock
        # 2) 경직 손절 −10% 전량
        cat = alive & (r <= -0.10)
        sell(cat, 1.0)
        alive &= ~cat
        # 3) 절반 손절 −7% (손절선이 7%보다 넓을 때, 1회)
        half = alive & (r <= -0.07) & (stop > 0.07) & ~half_done
        sell(half, 0.5)
        half_done |= half
        alive &= ~half
        # 4) 손절선
        sl = alive & (r <= -stop)
        sell(sl, 1.0)
        alive &= ~sl
        # 5) 익절 2분할
        tpm = alive & (r >= tp)
        first = tpm & ~tp_done
        sell(first, 0.5)
        tp_done |= first
        second = tpm & ~first
        sell(second, 1.0)
    val += frac * (P[-1] / entry) * 1.0
    return val - 1, n_exits


def main():
    names = list(CONFIGS)
    res = {k: [] for k in names}      # (date, 날짜 평균)
    tail = {k: [] for k in names}     # 하위 5%
    ex_cnt = {k: [] for k in names}
    hold_rec = []
    for t in range(261, T - D - 2, STEP):
        idx = np.where(lc.topm(t))[0]
        e = t + 1
        entry = O[e, idx]
        P = Cf[e:e + D, :][:, idx]
        O1 = O[e + 1:e + D + 1, :][:, idx]
        ATR = ATRP[e:e + D][:, idx]
        ok = np.isfinite(entry) & np.isfinite(P).all(axis=0)
        if ok.sum() < 100:
            continue
        entry, P, O1, ATR = entry[ok], P[:, ok], O1[:, ok], ATR[:, ok]
        hold = P[-1] / entry - 1
        hold_rec.append((dates[e], hold.mean(), np.percentile(hold, 5)))
        for k, cfg in CONFIGS.items():
            f, nx = simulate(cfg, P, O1, ATR, entry)
            res[k].append((dates[e], f.mean()))
            tail[k].append((dates[e], np.percentile(f, 5)))
            ex_cnt[k].append((dates[e], nx.mean()))

    def split(L):
        a = np.array([v for d, v in L if d < SPLIT]); b = np.array([v for d, v in L if d >= SPLIT])
        return a, b

    def diff(k1, k0, src):
        d1 = [(d, v) for d, v in src[k1]]; d0 = {d: v for d, v in src[k0]}
        return [(d, v - d0[d]) for d, v in d1]

    print(f"60일 보유(참고): 안 {np.mean([v for d,v,_ in hold_rec if d<SPLIT])*100:+.2f}% · 밖 {np.mean([v for d,v,_ in hold_rec if d>=SPLIT])*100:+.2f}%")
    print(f"\n{'설정':<20}{'평균 안':>8}{'밖':>8}{'하위5% 안':>10}{'밖':>8}{'평균 청산 횟수':>14}")
    for k in names:
        a, b = split(res[k]); ta, tb = split(tail[k]); ca, cb = split(ex_cnt[k])
        print(f"{k:<20}{a.mean()*100:+7.2f}%{b.mean()*100:+7.2f}%{ta.mean()*100:+9.1f}%{tb.mean()*100:+7.1f}%{np.concatenate([ca,cb]).mean():14.2f}")
    print(f"\n{'B0 대비 차이':<20}{'평균 안':>9}{'t':>6}{'밖':>8}{'t':>6}   {'하위5% 안':>9}{'밖':>8}  판정")
    verdicts = {}
    for k in names[1:]:
        dm = diff(k, names[0], res); dt = diff(k, names[0], tail)
        a, b = split(dm); ta, tb = split(dt)
        ok_mean = (a.mean() >= -0.005) and (b.mean() >= -0.005)
        ok_tail = (ta.mean() >= 0.03) and (tb.mean() >= 0.03)
        verdict = "통과" if (ok_mean and ok_tail) else "기각"
        verdicts[k] = verdict
        print(f"{k:<20}{a.mean()*100:+8.2f}%{vt.nw_t(a, 12):6.2f}{b.mean()*100:+7.2f}%{vt.nw_t(b, 12):6.2f}   {ta.mean()*100:+8.1f}%{tb.mean()*100:+7.1f}%  평균 {'충족' if ok_mean else '미충족'} · 꼬리 {'충족' if ok_tail else '미충족'} → {verdict}")


if __name__ == "__main__":
    main()
