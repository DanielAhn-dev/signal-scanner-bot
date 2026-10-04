# -*- coding: utf-8 -*-
"""
보유 종목 '비중 조절 경고' 검증 (2026-10-05). src/services/weightCautionSignal.ts의 근거 숫자를 만든다.
질문: 2026-06 고점 전에 개별 종목이 "이상하다"고 미리 알릴 수 있었나? 고점을 맞히는 게 아니라
      "평소보다 크게 빠질 확률이 높은 상태"를 구분할 수 있나?
데이터: .research-cache/px.pkl (2014~2026-10, 3,359종목 일별 수정주가, 상장폐지 포함).
표본: 약 월 1회(20거래일 간격), 하루 거래대금(20일 평균) 30억원 이상, 하루 ±31% 넘는 급변이 낀 구간 제외.
기준값은 검증 전에 고정했다(튜닝 없음).
  A 과열: 종가 / 200일 평균 - 1 > 60%
  B 변동성 급등: 최근 20일 로그수익률 표준편차 > 지난 1년(20일 간격 12개 창) 중앙값의 2배, 그리고 52주 고점의 90% 이상
결과 요약(2015~2025): -20% 이상 하락 확률(60거래일 안) 평소 34% → A 58%, B 52%, A+B 63%.
  대형주(거래대금 300억+)에서도 60% 안팎. 단 신호 뒤에도 상위 10%는 60거래일에 +37~47% 더 올랐다.
한계: 고점 시점은 맞히지 못한다. 월 1회 표본이라 같은 종목의 연속 신호가 겹친다(독립 표본은 더 적다).
"""
import pickle, statistics as st, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

x = pickle.load(open('.research-cache/px.pkl', 'rb'))
H = 60


def run(minval, years):
    S = {k: [] for k in ['ALL', 'A', 'B', 'A+B']}
    for code, v in x.items():
        if len(v) < 400:
            continue
        c = np.array([r[4] for r in v], float); vol = np.array([r[5] for r in v], float)
        if (c <= 0).any():
            continue
        r = np.diff(np.log(c)); jump = np.abs(np.diff(c) / c[:-1]) > 0.31
        for i in range(260, len(c) - H, 20):
            if v[i][0][:4] not in years or jump[i - 20:i + H].any():
                continue
            if np.mean(c[i - 20:i] * vol[i - 20:i]) < minval:
                continue
            ma200 = c[i - 199:i + 1].mean()
            rv20 = r[i - 20:i].std(); rvmed = np.median([r[j - 20:j].std() for j in range(i - 240, i, 20)])
            hi = c[i - 250:i + 1].max()
            f = c[i + H] / c[i] - 1; mdd = c[i:i + H + 1].min() / c[i] - 1
            a = c[i] / ma200 - 1 > 0.6; b = rv20 > 2 * rvmed and c[i] >= 0.9 * hi
            S['ALL'].append((f, mdd))
            if a: S['A'].append((f, mdd))
            if b: S['B'].append((f, mdd))
            if a and b: S['A+B'].append((f, mdd))
    return S


def show(title, S):
    print('==', title)
    for k, L in S.items():
        f = np.array([a for a, _ in L]); m = np.array([b for _, b in L])
        print(f'  {k:<4} n={len(L):>6} 60일 중앙 {np.median(f):+6.1%} 평균 {f.mean():+6.1%} 상위10% {np.percentile(f, 90):+6.0%}'
              f'  -20%확률 {(m <= -0.2).mean():5.0%}  -30%확률 {(m <= -0.3).mean():5.0%}')


all_years = {str(y) for y in range(2015, 2027)}
ex_2026 = {str(y) for y in range(2015, 2026)}
show('거래대금 30억+ 2015~2026', run(3e9, all_years))
show('거래대금 30억+ 2015~2025 (화면 근거, 올해 폭락 제외)', run(3e9, ex_2026))
show('거래대금 300억+ 대형주 2015~2025', run(3e10, ex_2026))
