# -*- coding: utf-8 -*-
"""
H24 미국 외 선진국·신흥국을 미국 코어에 섞으면 낙폭이 줄어드나 (2026-10-07).
코어: SPY(S&P500, 원화 환산·총수익). 섞는 것: 미국 외 = EFA 70% + EEM 30%(MSCI ACWI ex-US 대략 비중, 결과 보기 전 고정).
비중: 100% SPY / 90:10 / 80:20 (연 1회 리밸런싱, 월말 기준). 원화 환산(원/달러 월말), 수정종가 총수익, 비용·세금 없음.
기간: 2006-01~2026-09 (EEM 이력 2003-04~, 사전 지정 시작 2006).
사전 판정 기준(결과 보기 전 고정): 섞은 쪽(10% 또는 20%)이 100% SPY보다 최대낙폭이 2%p 이상 얕고 CAGR 손해가 0.5%p 이내이면 균형 프로필 후보(전향 측정만), 아니면 기각.
보조(판정 아님): 전반·후반 분할, 위기 구간별 낙폭, 5년 보유 최저 배율, 월수익률 상관.
한계: 20년·강세장(미국 편중 시기), 한국 상장 ETF가 아닌 원지수 기준(보수·환전비용·과세 없음), 신흥국 ETF EEM은 구성이 시기별로 변함.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
R = ".research-cache/allweather/"


def monthly(sym, col=1):
    m = {}
    for r in json.load(open(R + f"us_{sym}.json")):
        m[r[0][:6]] = r[col]
    return m


spy, efa, eem, kw = monthly("SPY"), monthly("EFA"), monthly("EEM"), monthly("KRW_X")
ms = [m for m in sorted(spy) if m in efa and m in eem and m in kw and m >= "200601"]
def krw(d): return np.array([d[m] * kw[m] for m in ms])
ps, pe, pm = krw(spy), krw(efa), krw(eem)
rs, re_, rm = ps[1:] / ps[:-1] - 1, pe[1:] / pe[:-1] - 1, pm[1:] / pm[:-1] - 1
rx = 0.7 * re_ + 0.3 * rm  # 월 단위 가중(비중 월 리밸런싱 근사 — ex-US 내부 구성만)


def portfolio(w_ex):
    """연 1회 리밸런싱, 월수익률 배열"""
    ws, wx = 1 - w_ex, w_ex
    out = []
    for i in range(len(rs)):
        r = ws * rs[i] + wx * rx[i]
        out.append(r)
        ws *= 1 + rs[i]; wx *= 1 + rx[i]
        tot = ws + wx; ws, wx = ws / tot, wx / tot
        if (i + 1) % 12 == 0:
            ws, wx = 1 - w_ex, w_ex
    return np.array(out)


def mdd(r):
    p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]
    return (p / pk - 1).min() * 100


def cagr(r): return (np.prod(1 + r) ** (12 / len(r)) - 1) * 100


print(f"공통 {ms[0]}~{ms[-1]} ({len(rs)}개월)")
print(f"월수익률 상관: SPY-EFA {np.corrcoef(rs, re_)[0,1]:.2f}, SPY-EEM {np.corrcoef(rs, rm)[0,1]:.2f}, SPY-ex-US {np.corrcoef(rs, rx)[0,1]:.2f}")
print(f"단독: SPY CAGR {cagr(rs):.1f}% MDD {mdd(rs):.1f}% / ex-US CAGR {cagr(rx):.1f}% MDD {mdd(rx):.1f}%")
base = portfolio(0.0)
print(f"\n{'구성':10s} {'CAGR':>6s} {'MDD':>7s} {'MDD 차':>7s} {'CAGR 차':>8s} {'판정':>6s}")
verdict = False
for w in (0.0, 0.10, 0.20):
    r = portfolio(w)
    dm, dc = mdd(r) - mdd(base), cagr(r) - cagr(base)
    ok = w > 0 and dm >= 2 and dc >= -0.5
    verdict |= ok
    print(f"{'SPY '+str(int((1-w)*100))+'%':10s} {cagr(r):>5.1f}% {mdd(r):>6.1f}% {dm:>+6.1f}p {dc:>+7.2f}p {'통과' if ok else ('-' if w == 0 else '미달'):>6s}")
print(f"\n기준 판정: {'후보(전향 측정만)' if verdict else '기각'}")

print("\n[보조] 전반/후반 CAGR·MDD (SPY 100 → 90:10 → 80:20)")
half = len(rs) // 2
for name, sl in (("전반 " + ms[1] + "~" + ms[half], slice(0, half)), ("후반 " + ms[half + 1] + "~" + ms[-1], slice(half, None))):
    line = []
    for w in (0.0, 0.1, 0.2):
        r = portfolio(w)[sl]
        line.append(f"{cagr(r):5.1f}%/{mdd(r):6.1f}%")
    print(f"{name:22s} " + "  ".join(line))

print("\n[보조] 5년 보유 배율 (모든 시작월): 중앙 / 나쁜10% / 최저")
for w in (0.0, 0.1, 0.2):
    r = portfolio(w)
    a = np.array([np.prod(1 + r[s:s + 60]) for s in range(len(r) - 59)])
    print(f"  SPY {int((1-w)*100):>3d}%  {np.median(a):.2f} / {np.percentile(a,10):.2f} / {a.min():.2f}")

print("\n[보조] 위기 구간 낙폭(월말 기준 고점→저점): SPY 100 vs 80:20")
def window(r, a, b):
    i, j = ms.index(a), ms.index(b)
    seg = r[i:j]
    p = np.cumprod(1 + seg)
    return (p / np.maximum.accumulate(p) - 1).min() * 100
for label, a, b in (("2008 위기", "200710", "200902"), ("2020 코로나", "202002", "202003"), ("2022 금리", "202112", "202209"), ("2026 7월 전후", "202606", "202608")):
    try:
        print(f"  {label:12s} {window(base,a,b):6.1f}% → {window(portfolio(0.2),a,b):6.1f}%")
    except Exception as e:
        print(label, "skip", e)
