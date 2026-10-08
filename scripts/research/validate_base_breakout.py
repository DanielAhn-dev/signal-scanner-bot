# -*- coding: utf-8 -*-
"""
수렴 돌파('매집 완료' 모양) 검증 H29 (2026-10-08). 조건·판정 기준은 docs/hypothesis-ledger.md H29에 결과 보기 전 고정.

사건(신호일 종가 t):
  ① 하락: t-250~t-80 최고 종가 대비 t-79~t 최저 종가가 -20% 이하
  ② 수렴·횡보: 최근 60일 일수익 표준편차 <= 직전 120일(t-179~t-60) 표준편차 x 0.7, 60일 종가 박스 (최고-최저)/최저 <= 30%
  ③ 저점 상승: 최근 60일 뒤 30일 최저 종가 > 앞 30일 최저 종가
  ④ 거래량 동반 돌파: t 종가 > 직전 60일 종가 최고, 거래량 >= 직전 20일 평균 x 1.5
제외: 봇이 이미 막는 사건(급등 추격 t-4~t, 윗꼬리 6%+). 같은 종목 20거래일 안 재신호 제외.
진입 t+1 시가, 20일(참고 60일) 종가 청산. 비용 차감 후 KODEX 200 같은 구간 대비. 대형(전날까지 20일 거래대금 상위 300)·소형(그 밖) 따로.
안 = 진입일 ~2021, 밖 = 2022~, 날짜 묶음 NW t(lag 5).
진단: 조건 하나씩 빼기(채택 근거 아님), 조건 통과 깔때기.

실행: python scripts/research/validate_base_breakout.py
"""
import sys, os, warnings, collections
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

warnings.filterwarnings("ignore")
vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, N = vt.dates, vt.T, vt.N
O, H, C, V, Cf, V20, UNIV, R1 = vt.O, vt.H, vt.C, vt.V, vt.Cf, vt.V20, vt.UNIV, vt.R1
EO, EC = lc.EO, lc.EC
HOLDS = (20, 60)
VARIANTS = [("전체", None), ("①하락 뺌", 1), ("②수렴 뺌", 2), ("③저점상승 뺌", 3), ("④거래량돌파 뺌", 4)]

# 급등 사건(봇 C16 기준) — t-4~t 안에 있으면 제외
CH = np.zeros((T, N), bool)
with np.errstate(all="ignore"):
    CH[1:] = (C[1:] / Cf[:-1] - 1 >= 0.08) & (V[1:] >= 5 * V20[:-1]) & (C[1:] >= 0.95 * H[1:])


def conditions(t):
    c = Cf
    with np.errstate(all="ignore"):
        M = np.nanmax(c[t - 250:t - 79], axis=0)
        L = np.nanmin(c[t - 79:t + 1], axis=0)
        c1 = (L / M - 1) <= -0.20
        sd60 = np.nanstd(R1[t - 59:t + 1], axis=0)
        sd120 = np.nanstd(R1[t - 179:t - 59], axis=0)
        w60 = c[t - 59:t + 1]
        lo60 = np.nanmin(w60, axis=0)
        box = (np.nanmax(w60, axis=0) - lo60) / lo60
        c2 = (sd60 <= 0.7 * sd120) & (box <= 0.30)
        c3 = np.nanmin(c[t - 29:t + 1], axis=0) > np.nanmin(c[t - 59:t - 29], axis=0)
        c4 = (c[t] > np.nanmax(c[t - 60:t], axis=0)) & (V[t] >= 1.5 * V20[t - 1])
        excl = CH[t - 4:t + 1].any(axis=0) | (H[t] / C[t] - 1 >= 0.06)
    return [np.asarray(x, bool) for x in (c1, c2, c3, c4)], np.asarray(excl, bool)


def main():
    groups = ("대형", "소형")
    # events[(variant, group, hold, cost_on)] = [(entry_date, excess)]
    events = collections.defaultdict(list)
    last_sig = {(v, g): np.full(N, -999) for v, _ in VARIANTS for g in groups}
    funnel = {g: np.zeros(5, np.int64) for g in groups}  # 유니버스, ①, ①②, ①②③, ①②③④
    per_year = collections.defaultdict(int)
    for t in range(261, T - 21):
        if not UNIV[t].any():
            continue
        conds, excl = conditions(t)
        big = lc.topm(t)
        gm = {"대형": big, "소형": UNIV[t] & ~big}
        e = t + 1
        for g in groups:
            base = gm[g] & np.isfinite(O[e])
            funnel[g][0] += gm[g].sum()
            m = gm[g].copy()
            for k in range(4):
                m = m & conds[k]
                funnel[g][k + 1] += m.sum()
            for vname, drop in VARIANTS:
                use = [conds[k] for k in range(4) if drop != k + 1]
                sel = base.copy()
                for u in use:
                    sel &= u
                sel &= ~excl
                sel &= (t - last_sig[(vname, g)]) >= 20
                js = np.where(sel)[0]
                last_sig[(vname, g)][js] = t
                for j in js:
                    cost = lc.rt_cost(j, e)
                    for h in HOLDS:
                        x = e + h - 1
                        if x >= T or not np.isfinite(Cf[x, j]):
                            continue
                        bench = EC[x] / EO[e] - 1
                        gross = Cf[x, j] / O[e, j] - 1 - bench
                        events[(vname, g, h, False)].append((dates[e], gross))
                        events[(vname, g, h, True)].append((dates[e], gross - cost))
                    if vname == "전체":
                        per_year[(g, dates[e][:4])] += 1

    print("\n[깔때기: 유니버스-일 합계 중 누적 통과 수]  (유니버스, ①, ①②, ①②③, ①②③④)")
    for g in groups:
        print(f"  {g}: " + " → ".join(f"{int(v):,}" for v in funnel[g]))

    def summarize(key, label):
        ev = events.get(key, [])
        if not ev:
            print(f"  {label:<26} 사건 없음")
            return None
        return lc.judge_events(label, ev)

    results = {}
    print("\n=== 본 검증: 20일 보유, 비용 차감 후 KODEX 200 대비 ===")
    for g in groups:
        results[g] = summarize(("전체", g, 20, True), f"{g} 수렴 돌파")
    print("\n--- 참고: 비용 전 ---")
    for g in groups:
        summarize(("전체", g, 20, False), f"{g} 수렴 돌파 (비용 전)")
    print("\n--- 참고: 60일 보유 (비용 후) ---")
    for g in groups:
        summarize(("전체", g, 60, True), f"{g} 수렴 돌파 60일")

    print("\n--- 진단: 조건 하나씩 빼기 (20일, 비용 후) — 채택 근거 아님 ---")
    for g in groups:
        for vname, _ in VARIANTS[1:]:
            summarize((vname, g, 20, True), f"{g} {vname}")

    print("\n--- 사건 분포: 연도별 건수(전체) ---")
    for g in groups:
        ys = sorted(y for gg, y in per_year if gg == g)
        print(f"  {g}: " + " ".join(f"{y}:{per_year[(g, y)]}" for y in ys))

    for g in groups:
        arr = np.array([x for _, x in events.get(("전체", g, 20, True), [])])
        if len(arr):
            print(f"\n  {g} 20일 비용 후: 중앙 {np.median(arr)*100:+.2f}% · 승률(지수 이김) {np.mean(arr > 0)*100:.0f}% · 하위 10% {np.percentile(arr, 10)*100:+.1f}% · 상위 10% {np.percentile(arr, 90)*100:+.1f}%")

    print("\n=== 사전 기준 판정 ===")
    for g in groups:
        r = results.get(g)
        if not r:
            print(f"  {g}: 사건 없음 — 기각")
            continue
        (am, at, an), (bm, bt, bn) = r["안"], r["밖"]
        adopt = am > 0.005 and bm > 0.005 and at > 2 and bt > 2 and an >= 100 and bn >= 100
        against = am < 0 and bm < 0 and at < -3 and bt < -3
        verdict = "채택(후보 등록)" if adopt else "반대 확정" if against else "기각"
        print(f"  {g}: 안 {am*100:+.2f}% (t {at:.2f}, {an}건) · 밖 {bm*100:+.2f}% (t {bt:.2f}, {bn}건) → {verdict}")


if __name__ == "__main__":
    main()
