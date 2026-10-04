# -*- coding: utf-8 -*-
"""
시장 수준 '비중 조절' 신호 검증 (2026-10-05). src/services/marketFlowCaution.ts의 근거 숫자를 만든다.
질문: 2026-05~06(코스피 9,115 고점, 이후 -39%)에 금리·환율·변동성·외국인/개인 수급에서 미리 보인 이상 패턴이
      과거에도 하락을 앞섰나? 고점 매도가 아니라 '비중을 점검할 때'를 알릴 수 있나?
데이터: .research-cache/kospi.json(1996~), vkospi.json(2003~), allweather/cd91.json, allweather/us_KRW_X.json,
        kospi_investor_flow.json(2016~, fetch_kospi_investor_flow.py).
기준값은 검증 전에 고정했다. 평가: 신호일 이후 60거래일 안 -10%/-15% 이상 하락 비율, 60·120거래일 수익률 중앙값.
'사건'은 60거래일 넘게 떨어진 첫 신호일(독립 사건 수).

결과 요약
  거시(1996~): 강세장(200일선 +20%)인데 CD91 120일 +0.25%p → -10% 확률 47%(평소 26%), 1999·2002·2007 고점 전.
    그러나 2025-12(4,100)~2026-04에 켜지고 고점 직전 5~6월엔 꺼졌다 → 채택하지 않음.
    원화 약세 동반 상승·신고가 부근 VKOSPI 급등은 오히려 이후 수익이 높거나 차이 없음.
  수급(2016~): F3 신고가 부근(52주 고점 95%+) + 외국인 60일 누적 순매도가 1년 중 하위 10% → -10% 확률 50%(평소 21%),
    사건 6번(2017-08, 2018-04, 2019-12, 2021-05, 2023-07, 2026-02). 2026년엔 4/15~6/22 거의 계속 켜짐.
    F2 개인 20일 순매수 1년 상위 10% + 신고가 부근 → 37%. F1 상승 중 외국인 20일 순매도 → 24%(효과 없음).
  행동(2017-04~2026-10): F3 때 지수 비중 70%·60거래일 유지(나머지 CD금리) 연 +14.4%·최대낙폭 -38%,
    계속 보유 연 +13.7%·-44%. 비중·유지기간을 바꾸면 연 +11.8~+15.7%로 흔들린다 → 안내로만 쓴다.
한계: 사건 수가 적다. 2026-02-10(5,302)에도 켜졌고 그 뒤 9,115까지 올랐다(고점 시점은 못 맞힌다).
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

C = '.research-cache/'
H = 60
k = json.load(open(C + 'kospi.json'))


def stats_table(P, D, sig):
    print(f'  {"신호":<44}{"일수":>6}{"사건":>5}{"60일중앙":>9}{"-10%":>7}{"-15%":>7}{"120일중앙":>9}')
    for n, ix in sig.items():
        ix = np.array(ix); f = P[ix + H] / P[ix] - 1
        mdd = np.array([P[i:i + H + 1].min() / P[i] - 1 for i in ix])
        f120 = np.array([P[min(i + 120, len(P) - 1)] / P[i] - 1 for i in ix])
        ev = []; last = -999
        for i in ix:
            if i - last > 60: ev.append(D[i])
            last = i
        print(f'  {n:<44}{len(ix):>6}{len(ev):>5}{np.median(f):>+9.1%}{(mdd <= -0.1).mean():>7.0%}{(mdd <= -0.15).mean():>7.0%}{np.median(f120):>+9.1%}')
        if n != 'ALL': print('      사건:', ' '.join(ev))


# ---- 1) 거시: 지수 과열·환율·금리·VKOSPI (1996~)
D = [r[0] for r in k]; P = np.array([r[1] for r in k])


def ff(f):
    m = dict((r[0], r[1]) for r in json.load(open(C + f))); out = []; last = np.nan
    for d in D:
        last = m.get(d, last); out.append(last)
    return np.array(out, float)


KRW = ff('allweather/us_KRW_X.json'); CD = ff('allweather/cd91.json'); VK = ff('vkospi.json')
ma = lambda a, i, n: np.nanmean(a[i - n + 1:i + 1])
sig = {}
for i in range(260, len(P) - H):
    r60 = P[i] / P[i - 60] - 1; near = P[i] >= 0.95 * P[i - 250:i + 1].max(); gap = P[i] / ma(P, i, 200) - 1
    sig.setdefault('ALL', []).append(i)
    if gap > 0.3: sig.setdefault('지수 200일선 +30%', []).append(i)
    if not np.isnan(KRW[i - 60]) and KRW[i] / KRW[i - 60] - 1 > 0.03 and r60 > 0.10: sig.setdefault('M1 지수 60일 +10%인데 원화 3% 약세', []).append(i)
    if not np.isnan(CD[i - 120]) and CD[i] - CD[i - 120] >= 0.25 and gap > 0.2: sig.setdefault('M2 강세장인데 CD91 120일 +0.25%p', []).append(i)
    if not np.isnan(VK[i - 60]) and ma(VK, i, 20) > 1.2 * ma(VK, i - 20, 60) and near: sig.setdefault('M3 신고가 부근 VKOSPI 20%↑', []).append(i)
print('== 1) 거시 신호 (1996~)')
stats_table(P, D, sig)

# ---- 2) 수급 (2016~)
fl = json.load(open(C + 'kospi_investor_flow.json'))
rows = [(d, p, fl[d]) for d, p in k if d >= '20160101' and fl.get(d)]
D = [r[0] for r in rows]; P = np.array([r[1] for r in rows])
IND = np.array([r[2][0] for r in rows], float); FOR = np.array([r[2][1] for r in rows], float)
cd_map = dict((r[0], r[1]) for r in json.load(open(C + 'allweather/cd91.json')))
cs = lambda a, i, n: a[i - n + 1:i + 1].sum()


def pct(a, i, n, w=250):
    return (np.array([cs(a, j, n) for j in range(i - w, i)]) < cs(a, i, n)).mean()


n = len(P); f2 = np.zeros(n, bool); f3 = np.zeros(n, bool); sig = {}
for i in range(320, n):
    near = P[i] >= 0.95 * P[i - 250:i + 1].max()
    f2[i] = near and pct(IND, i, 20) > 0.9; f3[i] = near and pct(FOR, i, 60) < 0.1
    if i < n - H:
        sig.setdefault('ALL', []).append(i)
        if P[i] / P[i - 20] - 1 > 0.05 and cs(FOR, i, 20) < 0: sig.setdefault('F1 지수 20일 +5%인데 외국인 20일 순매도', []).append(i)
        if f2[i]: sig.setdefault('F2 신고가 부근 + 개인 20일 순매수 1년 상위10%', []).append(i)
        if f3[i]: sig.setdefault('F3 신고가 부근 + 외국인 60일 순매도 1년 하위10%', []).append(i)
print(f'\n== 2) 수급 신호 ({D[0]}~{D[-1]})')
stats_table(P, D, sig)
print('  2026년 F3 켜진 날:', ' '.join(D[i] for i in range(n) if f3[i] and D[i] >= '2026'))

# ---- 3) 행동: 신호 때 지수 비중 축소 (오늘 종가로 정하고 다음 날 수익에 적용, 나머지는 CD금리)
cd = []; last = 2.0
for d in D:
    last = cd_map.get(d, last); cd.append(last)
cd = np.array(cd) / 100 / 252
ret = np.r_[0, P[1:] / P[:-1] - 1]


def sim(s, low, hold):
    off = -999; eq = [1.0]
    for i in range(320, n - 1):
        if s[i]: off = i
        w = low if i - off < hold else 1.0
        eq.append(eq[-1] * (1 + w * ret[i + 1] + (1 - w) * cd[i]))
    eq = np.array(eq); yrs = (n - 1 - 320) / 252
    return eq[-1] ** (1 / yrs) - 1, (eq / np.maximum.accumulate(eq) - 1).min()


print(f'\n== 3) 비중 축소 시뮬레이션 ({D[320]}~{D[-1]})')
c, m = sim(np.zeros(n, bool), 1, 0); print(f'  계속 보유                     연 {c:+.1%}  최대낙폭 {m:.0%}')
for name, s in [('F3', f3), ('F2&F3', f2 & f3), ('F2|F3', f2 | f3)]:
    for low in (0.7, 0.5):
        for hold in (20, 60):
            c, m = sim(s, low, hold); print(f'  {name:<6} {low:.0%}로 {hold}일 유지          연 {c:+.1%}  최대낙폭 {m:.0%}')
