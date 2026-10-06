# -*- coding: utf-8 -*-
"""
청산 규칙 검증 X1 (2026-10-06 밤). 판정 기준은 docs/hypothesis-ledger.md C21에 결과 보기 전 고정.

질문: 매수 뒤 손절·익절·추적손절·시간손절·이평선 이탈 규칙이, 같은 진입을 60거래일 그냥 들고 간 것보다 낫나?
진입: 5거래일마다, 전날까지 20일 거래대금 상위 300(봇 크기) 전체, 다음날 시가. 급등·윗꼬리·급락 회피 규칙은 일부러 적용하지 않음(청산 효과만 분리).
청산: 종가로 조건 확인 → 다음날 시가 매도(하루 한 번 점검, 봇이 실제로 할 수 있는 방식). 청산 뒤 남은 기간 현금 연 3%.
비교: 같은 진입의 60일 보유(종가) 대비 규칙 수익 차이. 날짜별 평균 → 표본 안(~2021)·밖(2022~) NW t(lag 4).
비용은 두 쪽 모두 왕복 1회라 동일 → 생략. (청산 후 재진입은 모델하지 않음)

실행: python scripts/research/validate_exit_rules.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, N = vt.dates, vt.T, vt.N
O, Cf = vt.O, vt.Cf
STEP, D = 5, 60
SPLIT = "20220101"
CASH = 0.03 / 252


def ma(c, w):
    out = np.full_like(c, np.nan)
    cs = np.cumsum(np.nan_to_num(c), axis=0)
    out[w - 1:] = (cs[w - 1:] - np.vstack([np.zeros((1, c.shape[1])), cs[:-w]])) / w
    return out


MA20, MA50 = ma(Cf, 20), ma(Cf, 50)


def rules():
    R = {}
    for k in (4, 6, 8, 10, 15):
        R[f"손절 {k}%"] = dict(sl=k / 100)
    for k in (8, 12, 20):
        R[f"익절 {k}%"] = dict(tp=k / 100)
    R["손절4·익절8(봇 기본)"] = dict(sl=.04, tp=.08)
    R["손절6·익절12"] = dict(sl=.06, tp=.12)
    for k in (8, 12, 15, 20):
        R[f"추적 {k}%"] = dict(tr=k / 100)
    R["10일째 손실이면 정리"] = dict(time10=True)
    R["20일 지나 손실이면 정리"] = dict(time20=True)
    R["종가<20일선 이탈"] = dict(ma=20)
    R["종가<50일선 이탈"] = dict(ma=50)
    return R


RULES = rules()


def run_rule(rule, P, M20, M50, O1, entry):
    """P: (D, n) 종가 경로(d=0..D-1), O1: (D, n) 다음날 시가, entry: (n,). 반환 최종 수익 (n,)"""
    n = P.shape[1]
    ret = P[-1] * 0 + np.nan
    done = np.zeros(n, bool)
    final = np.full(n, np.nan)
    peak = entry.copy()
    for d in range(D):
        pc = P[d]
        peak = np.fmax(peak, pc)
        r = pc / entry - 1
        trig = np.zeros(n, bool)
        if "sl" in rule: trig |= r <= -rule["sl"]
        if "tp" in rule: trig |= r >= rule["tp"]
        if "tr" in rule: trig |= pc <= peak * (1 - rule["tr"])
        if rule.get("time10") and d == 9: trig |= r < 0
        if rule.get("time20") and d == 19: trig |= r < 0
        if rule.get("ma") == 20: trig |= pc < M20[d]
        if rule.get("ma") == 50: trig |= pc < M50[d]
        trig &= ~done & np.isfinite(pc)
        if trig.any():
            ex = O1[d]
            ex = np.where(np.isfinite(ex) & (ex > 0), ex, pc)
            final[trig] = (ex[trig] / entry[trig]) * (1 + CASH) ** (D - 1 - d) - 1
            done |= trig
    final[~done] = P[-1][~done] / entry[~done] - 1
    return final


def main():
    diffs = {k: [] for k in RULES}  # (date, 날짜 평균 차이, 평균 하위 10% 차이)
    base_rec = []
    tail = {k: [] for k in RULES}
    for t in range(261, T - D - 2, STEP):
        idx = np.where(lc.topm(t))[0]
        e = t + 1
        entry = O[e, idx]
        P = Cf[e:e + D, :][:, idx]
        O1 = O[e + 1:e + D + 1, :][:, idx]
        M20, M50 = MA20[e:e + D][:, idx], MA50[e:e + D][:, idx]
        ok = np.isfinite(entry) & np.isfinite(P).all(axis=0)
        if ok.sum() < 100:
            continue
        entry, P, O1, M20, M50 = entry[ok], P[:, ok], O1[:, ok], M20[:, ok], M50[:, ok]
        hold = P[-1] / entry - 1
        base_rec.append((dates[e], hold.mean()))
        for k, rule in RULES.items():
            f = run_rule(rule, P, M20, M50, O1, entry)
            diffs[k].append((dates[e], (f - hold).mean()))
            tail[k].append((dates[e], np.percentile(f, 5) - np.percentile(hold, 5)))
    def stat(L):
        a = np.array([v for d, v in L if d < SPLIT]); b = np.array([v for d, v in L if d >= SPLIT])
        return a.mean(), vt.nw_t(a, 12), b.mean(), vt.nw_t(b, 12)
    a, at, b, bt = stat(base_rec)
    print(f"기준(60일 보유, 비용 전): 안 {a*100:+.2f}% · 밖 {b*100:+.2f}%  (표본 겹침 때문에 NW lag 12)")
    print(f"{'규칙':<22}{'안 차이':>9}{'안 t':>7}{'밖 차이':>9}{'밖 t':>7} | 하위5% 차이 안/밖  판정")
    for k in RULES:
        a, at, b, bt = stat(diffs[k])
        ta, _, tb, _ = stat(tail[k])
        tag = ""
        if a > 0 and b > 0 and at > 2 and bt > 2: tag = "채택 후보"
        elif a < 0 and b < 0 and at < -2 and bt < -2: tag = "해로움"
        print(f"{k:<22}{a*100:+8.2f}%{at:7.2f}{b*100:+8.2f}%{bt:7.2f} | {ta*100:+6.1f}% / {tb*100:+6.1f}%  {tag}")


if __name__ == "__main__":
    main()
