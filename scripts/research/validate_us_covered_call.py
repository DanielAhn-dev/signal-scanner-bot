# -*- coding: utf-8 -*-
"""
미국 커버드콜(QYLD 2014~, JEPI 2020~, JEPQ 2022~) vs S&P500(SPY) 총수익(야후 adjclose, 달러) 점검 (2026-10-03).
질문: 한국 표본(강세장 4.5년)의 결론이 하락·박스권이 섞인 더 긴 미국 표본에서도 유지되나? 인컴 몫을 섞었을 때 비용·낙폭은?
한계: 달러 총수익이라 환율·세금 제외, 상품마다 기간이 다르고 분배금 지급 전략(주 단위 옵션 등)이 달라 한 묶음으로 보면 안 된다.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import time

def monthly(sym):
    d = json.load(open(f".research-cache/yh_{sym}.json"))
    m = {}
    for t, a in zip(d['t'], d['adj']):
        if a is not None:
            m[time.strftime('%Y%m', time.gmtime(t))] = a
    return m

spy = monthly("SPY")
for sym in ("QYLD", "JEPI", "JEPQ"):
    cc = monthly(sym)
    ms = [k for k in sorted(cc) if k in spy]
    ri = np.array([spy[ms[i]] / spy[ms[i-1]] - 1 for i in range(1, len(ms))])
    rc = np.array([cc[ms[i]] / cc[ms[i-1]] - 1 for i in range(1, len(ms))])
    n = len(ri)
    print(f"\n##### {sym} {ms[0]}~{ms[-1]} ({n}개월) 총수익 {sym} {(np.prod(1+rc)-1)*100:+.0f}% vs SPY {(np.prod(1+ri)-1)*100:+.0f}%")
    for H in (36, 60):
        if n - H + 1 < 6: continue
        a = np.array([np.prod(1 + rc[s:s+H]) for s in range(n - H + 1)])
        b = np.array([np.prod(1 + ri[s:s+H]) for s in range(n - H + 1)])
        print(f"  {H//12}년 보유(시작 {len(a)}개): 중앙값 {sym} {np.median(a):.2f} / SPY {np.median(b):.2f}, {sym}가 SPY 이긴 비율 {(a>b).mean()*100:.0f}%, 최저 {a.min():.2f} vs {b.min():.2f}")
    print(f"  {'인컴 비중':>8s} {'총수익':>8s} {'최대낙폭':>8s}")
    for w in (0, 20, 40, 60, 100):
        r = (1 - w/100) * ri + w/100 * rc
        p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]
        print(f"  {w:7d}% {(p[-1]-1)*100:+7.0f}% {((p/pk-1).min())*100:7.1f}%")
