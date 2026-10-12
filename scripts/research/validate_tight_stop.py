# -*- coding: utf-8 -*-
"""
타이트 손절 프로파일(REDUCE_TIGHT: 손절 2%·익절 4%) 검증 H34 (2026-10-12).
판정 기준은 docs/hypothesis-ledger.md H34에 결과 보기 전 고정.

틀은 validate_exit_rules.py(C21)를 그대로 쓴다: 거래대금 상위 300, 5거래일마다 다음날 시가 진입,
종가로 조건 확인 → 다음날 시가 청산, 60일, 청산 뒤 남은 기간 현금 연 3%, 재진입 없음.
추가로 보는 것: 설정별 조기 청산(손절·익절로 60일 전에 나간) 비율.

실행: python scripts/research/validate_tight_stop.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_exit_rules as ex

lc, vt = ex.lc, ex.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CFG = {
    "기본 손절4·익절8": dict(sl=.04, tp=.08),
    "타이트 손절2·익절4": dict(sl=.02, tp=.04),
    "중간 손절3·익절6": dict(sl=.03, tp=.06),
}
BASE, TIGHT = "기본 손절4·익절8", "타이트 손절2·익절4"


def early_exit_share(rule, P, entry):
    """60일 안에 손절·익절 조건에 걸려 나간 비율(청산 시점 판정은 run_rule과 같은 종가 기준)."""
    r = P / entry - 1
    hit = np.zeros(P.shape[1], bool)
    if "sl" in rule: hit |= (r <= -rule["sl"]).any(axis=0)
    if "tp" in rule: hit |= (r >= rule["tp"]).any(axis=0)
    return hit.mean()


def main():
    diffs = {k: [] for k in CFG}          # 규칙 − 60일 보유
    vs_base = {k: [] for k in CFG}        # 규칙 − 기본
    tails = {k: [] for k in CFG}          # 하위 5% 개선(규칙 − 보유)
    early = {k: [] for k in CFG}
    base_rec = []
    for t in range(261, ex.T - ex.D - 2, ex.STEP):
        idx = np.where(lc.topm(t))[0]
        e = t + 1
        entry = ex.O[e, idx]
        P = ex.Cf[e:e + ex.D, :][:, idx]
        O1 = ex.O[e + 1:e + ex.D + 1, :][:, idx]
        M20, M50 = ex.MA20[e:e + ex.D][:, idx], ex.MA50[e:e + ex.D][:, idx]
        ok = np.isfinite(entry) & np.isfinite(P).all(axis=0)
        if ok.sum() < 100:
            continue
        entry, P, O1, M20, M50 = entry[ok], P[:, ok], O1[:, ok], M20[:, ok], M50[:, ok]
        hold = P[-1] / entry - 1
        base_rec.append((ex.dates[e], hold.mean()))
        res = {k: ex.run_rule(r, P, M20, M50, O1, entry) for k, r in CFG.items()}
        for k, f in res.items():
            diffs[k].append((ex.dates[e], (f - hold).mean()))
            vs_base[k].append((ex.dates[e], (f - res[BASE]).mean()))
            tails[k].append((ex.dates[e], np.percentile(f, 5) - np.percentile(hold, 5)))
            early[k].append((ex.dates[e], early_exit_share(CFG[k], P, entry)))

    def split(L):
        a = np.array([v for d, v in L if d < ex.SPLIT]); b = np.array([v for d, v in L if d >= ex.SPLIT])
        return a, b

    def stat(L):
        a, b = split(L)
        return a.mean(), vt.nw_t(a, 12), b.mean(), vt.nw_t(b, 12)

    a, at, b, bt = stat(base_rec)
    print(f"60일 보유(비용 전): 안 {a*100:+.2f}% · 밖 {b*100:+.2f}%")
    print(f"\n{'설정':<20}{'안 차이':>9}{'안 t':>7}{'밖 차이':>9}{'밖 t':>7}  (규칙 − 60일 보유)")
    for k in CFG:
        a, at, b, bt = stat(diffs[k])
        print(f"{k:<20}{a*100:+8.2f}%{at:7.2f}{b*100:+8.2f}%{bt:7.2f}")
    print(f"\n{'설정 − 기본 4·8':<20}{'안 차이':>9}{'안 t':>7}{'밖 차이':>9}{'밖 t':>7}")
    for k in CFG:
        if k == BASE:
            continue
        a, at, b, bt = stat(vs_base[k])
        print(f"{k:<20}{a*100:+8.2f}%{at:7.2f}{b*100:+8.2f}%{bt:7.2f}")
    print(f"\n{'설정':<20}{'조기 청산 비율(안/밖)':>24}{'하위5% 개선(안/밖)':>22}")
    for k in CFG:
        ea, eb = (x.mean() for x in split(early[k]))
        ta, tb = (x.mean() for x in split(tails[k]))
        print(f"{k:<20}{ea*100:10.1f}% / {eb*100:5.1f}%{ta*100:11.1f}%p / {tb*100:5.1f}%p")

    # 사전 기준 판정
    a, at, b, bt = stat(vs_base[TIGHT])
    cond1 = (b <= -0.005) and (a < 0)
    ea_t, eb_t = (x.mean() for x in split(early[TIGHT]))
    ea_b, eb_b = (x.mean() for x in split(early[BASE]))
    cond2 = (ea_t >= 1.5 * ea_b) and (eb_t >= 1.5 * eb_b)
    tt = [x.mean() for x in split(tails[TIGHT])]
    tb_ = [x.mean() for x in split(tails[BASE])]
    # ③: 2/4의 개선 폭이 기본보다 3%p 이상 작지 **않음**(= 더 타이트해도 이득 없음)
    cond3 = all((tt[i] - tb_[i]) < 0.03 for i in range(2))
    flat = abs(b) < 0.005 or (a * b <= 0)
    better = (a >= 0.005) and (b >= 0.005)
    print("\n[H34 사전 기준 판정]")
    print(f"① 2/4 − 기본 평균 차이: 안 {a*100:+.2f}% · 밖 {b*100:+.2f}% → {'충족' if cond1 else '미충족'}")
    print(f"② 조기 청산 비율 2/4 ≥ 기본 ×1.5 (안 {ea_t/ea_b:.2f}배 · 밖 {eb_t/eb_b:.2f}배) → {'충족' if cond2 else '미충족'}")
    print(f"③ 하위5% 개선 폭이 기본보다 3%p 이상 크지 않음 (안 {(tt[0]-tb_[0])*100:+.1f}%p · 밖 {(tt[1]-tb_[1])*100:+.1f}%p) → {'충족' if cond3 else '미충족'}")
    verdict = "열세" if (cond1 and cond2 and cond3) else "우위" if better else "차이 없음"
    print(f"판정: {verdict}")


if __name__ == "__main__":
    main()
