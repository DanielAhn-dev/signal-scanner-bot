# -*- coding: utf-8 -*-
"""
H28 당일 추격 매수 검증 (2026-10-07). 가설·판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

질문: 매수 당일 장중 가격이 전일 종가 +8% 이상일 때 사면 20일 뒤 코스피보다 나쁜가?
기존 추격 회피(C16·C19, chaseEntrySignal)는 전날까지의 일봉만 봐서 당일 급등은 못 막는다.
(2026-10-07 이수페타시스: 전일 122,000 → 장중 132,833 매수, 다음날 −7~−8% 손절)

일봉 근사: 거래대금 상위 300(전날까지 20일 평균), 고가 ≥ 전일 종가×(1+jump)인 날,
진입가 = max(시가, 전일 종가×(1+jump)) — 그 가격을 처음 넘을 때 샀다고 본다.
초과수익 = h일째 종가 / 진입가 − 1 − 같은 기간 코스피(전일 종가 기준). 날짜별 평균 후 Newey-West t.
C16(T4b)과 같은 방식이라 비용은 빼지 않는다.

실행: python scripts/research/validate_intraday_chase.py
"""
import collections, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_trader_paths as tp

T, N = tp.T, tp.N
C, Cf, H, O = tp.C, tp.Cf, tp.H, tp.O
KI, dates = tp.KI, tp.dates


def run(jump):
    rows = collections.defaultdict(lambda: collections.defaultdict(list))
    cnt = 0
    closed_below = 0
    for t in range(260, T - 22):
        u = tp.UNIV[t].copy()
        tv = np.where(u, tp.TV20[t - 1], -np.inf)
        top = np.zeros(N, bool)
        top[np.argsort(-tv)[:tp.SEED_SMALL_RANK]] = True
        trig = Cf[t - 1] * (1 + jump)
        ok = u & top & (H[t] >= trig) & ~np.isnan(O[t])
        for j in np.where(ok)[0]:
            entry = max(O[t, j], trig[j])
            cnt += 1
            if C[t, j] < entry:
                closed_below += 1
            for h in (1, 5, 20):
                x = t + h - 1
                rows[h][dates[t]].append(Cf[x, j] / entry - 1 - (KI[x] / KI[t - 1] - 1))
    yrs = (T - 282) / 250
    print(f"\n[장중 +{int(jump*100)}% 도달 시 매수] 사건 {cnt}건 (연 {cnt/yrs:.0f}건), 당일 종가가 진입가 아래 {closed_below/cnt*100:.0f}%")
    out = {}
    for h in (1, 5, 20):
        ks = sorted(rows[h])
        m = np.array([np.mean(rows[h][k]) for k in ks])
        a = np.array([k < "20220101" for k in ks])
        ta, tb = tp.nw_t(m[a], 5), tp.nw_t(m[~a], 5)
        print(f"  {h:>2}일: 초과 평균 {m.mean()*100:+.2f}% 중앙 {np.median(m)*100:+.2f}% t {tp.nw_t(m, 5):5.2f} | "
              f"전반 {m[a].mean()*100:+.2f}% (t {ta:5.2f}, {a.sum()}일) 후반 {m[~a].mean()*100:+.2f}% (t {tb:5.2f}, {(~a).sum()}일)")
        out[h] = (m[a].mean(), ta, m[~a].mean(), tb)
    return out


def main():
    res = run(0.08)
    ma, ta, mb, tb = res[20]
    passed = ma < 0 and mb < 0 and ta < -3 and tb < -3
    print(f"\n판정(+8%, 20일, 사전 기준: 두 구간 평균 음수·t < −3): {'통과 → 손실 차단형 후보 채택' if passed else '미통과 → 기각'}")
    print("\n참고(판정 아님):")
    run(0.05)
    run(0.15)


if __name__ == "__main__":
    main()
