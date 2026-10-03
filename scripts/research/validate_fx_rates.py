# -*- coding: utf-8 -*-
"""
환율과 금리차 (2026-10-03) — (1) 원화 환산 S&P500 수익을 달러 수익과 환율 효과로 분해, (2) 한미 금리차·미국 장기금리와 원/달러 환율의 관계, (3) 환율이 코스피200 대 미국 선택에 준 영향.
데이터: SPY 수정주가(달러 총수익, 월), 원/달러(KRW=X 월말), 한국 CD91(.research-cache/allweather/cd91.json), 미국 3개월물·10년물(야후 월말), mixData 코스피200·S&P500(원화 환산).
기간: 2003-12~2026-08(공통). 한계: 환율은 금리 외 요인(위험회피·경상수지·외국인 수급)이 크고 회귀는 인과가 아니다.
"""
import json, sys, time
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
def yh_m(fn, key):
    d = json.load(open(f".research-cache/yh_{fn}.json")); o = {}
    for t, a in zip(d['t'], d[key]):
        if a is not None: o[time.strftime('%Y%m', time.gmtime(t))] = a
    return o
spy = yh_m("SPY", "adj")
# 원/달러: 야후 월봉(KRW=X)은 일부 달에 0.11 같은 이상값이 있어 쓰지 않고, 정상 확인된 일봉 파일의 월말값을 쓴다
_fxd = json.load(open(".research-cache/allweather/us_KRW_X.json")); _fxd.sort(key=lambda r: r[0])
fx = {}
for r in _fxd:
    fx[r[0][:6]] = float(r[-1])
irx = json.load(open(".research-cache/yh_IRX_me.json")); tnx = json.load(open(".research-cache/yh_TNX_me.json"))
cd = json.load(open(".research-cache/allweather/cd91.json")); cd.sort(key=lambda r: r[0]); cdm = {r[0][:6]: float(r[1]) for r in cd}
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
mix = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(txt[txt.index("= [{") + 2: txt.rindex("]") + 1])}
ms = [m for m in sorted(mix["sp500"]) if m >= "200312" and m in spy and m in fx and m in irx and m in tnx and m in cdm and m in mix["kospi200"]]
n = len(ms)
r_krw = np.array([mix["sp500"][ms[i]] / mix["sp500"][ms[i-1]] - 1 for i in range(1, n)])
r_usd = np.array([spy[ms[i]] / spy[ms[i-1]] - 1 for i in range(1, n)])
r_fx = np.array([fx[ms[i]] / fx[ms[i-1]] - 1 for i in range(1, n)])
r_k = np.array([mix["kospi200"][ms[i]] / mix["kospi200"][ms[i-1]] - 1 for i in range(1, n)])
ann = lambda r: (np.prod(1 + r) ** (12 / len(r)) - 1) * 100
print(f"공통 {ms[0]}~{ms[-1]} ({n-1}개월)")
print(f"S&P500 원화 환산 연 {ann(r_krw):.1f}% = 달러 총수익 연 {ann(r_usd):.1f}% (SPY 근사) + 원/달러 변동 연 {ann(r_fx):.1f}% (환율 {fx[ms[0]]:.0f}→{fx[ms[-1]]:.0f}원)")
print(f"코스피200 연 {ann(r_k):.1f}%")
# 환율 효과가 없었다면: 달러 수익 vs 코스피
print(f"\n=== 환율을 빼면 선택이 바뀌나? 보유 10년 창 중앙값 배수 ===")
H = 120
f = lambda r: np.array([np.prod(1 + r[s:s + H]) for s in range(len(r) - H + 1)])
a, b, c = f(r_k), f(r_krw), f(r_usd)
print(f"코스피200 {np.median(a):.2f} / S&P500 원화 {np.median(b):.2f} / S&P500 달러(환율 제외) {np.median(c):.2f}   미국(원화)이 이긴 창 {(b>a).mean()*100:.0f}% / 달러만으로 이긴 창 {(c>a).mean()*100:.0f}%")
# 환율의 위험 성격: 원/달러와 주식
dd = {m: (1 if m >= "200812" else 0) for m in ms}
print(f"\n=== 환율과 주식의 관계 ===")
print(f"월수익률 상관: 원/달러 변화 vs 코스피200 {np.corrcoef(r_fx, r_k)[0,1]:.2f}, vs S&P500(달러) {np.corrcoef(r_fx, r_usd)[0,1]:.2f}")
worst = np.argsort(r_usd)[:12]
print(f"S&P500 달러 기준 최악 12개월 월평균 {r_usd[worst].mean()*100:.1f}% 일 때 원/달러 평균 변화 {r_fx[worst].mean()*100:+.1f}%, 원화 환산 평균 {r_krw[worst].mean()*100:.1f}% — 미국이 급락할 때 원화가 약해져 원화 손실이 {'덜' if r_krw[worst].mean() > r_usd[worst].mean() else '더'} 컸다")
# 금리차와 환율
sp = np.array([irx[m] - cdm[m] for m in ms])      # 미국 3개월 − 한국 CD91
t10 = np.array([tnx[m] for m in ms])
dsp = np.diff(sp); dt = np.diff(t10)
print(f"\n=== 한미 금리차·미국 장기금리와 원/달러 월 변화 ===")
for nm, x in (("금리차(미 3개월−한 CD91) 변화", dsp), ("미국 10년 금리 변화", dt)):
    b1 = np.polyfit(x, r_fx * 100, 1)[0]; c1 = np.corrcoef(x, r_fx)[0, 1]
    print(f"{nm:28s} 1%p당 원/달러 월 변화 {b1:+.2f}%  상관 {c1:+.2f}")
lv = np.array([fx[m] for m in ms])
print(f"금리차 수준과 환율 수준 상관 {np.corrcoef(sp, lv)[0,1]:+.2f} (금리차 평균 {sp.mean():+.2f}%p, 현재 {sp[-1]:+.2f}%p)")
for lo, hi, nm in ((-9, -1, "한국이 1%p 이상 높음"), (-1, 1, "비슷함(±1%p)"), (1, 9, "미국이 1%p 이상 높음")):
    mk = (sp[1:] > lo) & (sp[1:] <= hi)
    if mk.sum() >= 12: print(f"  {nm:20s} {mk.sum():>3d}개월  원/달러 월평균 변화 {r_fx[mk].mean()*100:+.2f}%  S&P500 원화 연환산 {ann(r_krw[mk]):5.1f}%  코스피200 {ann(r_k[mk]):5.1f}%")
