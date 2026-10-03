# -*- coding: utf-8 -*-
"""
코스피200 vs 미국 지수(원화 환산) — 고르기 어려울 때 보는 표 (2026-10-03).
데이터: web/src/data/mixData.ts의 월말 수정주가(분배금 반영, 원화 환산 — 미국은 환율 포함). 기간은 두 자산의 공통 구간.
질문: (1) 보유 기간별로 어느 쪽이 이겼나 (2) 반반 섞으면 어땠나 (3) 서로 같이 움직이나(상관, 따로 노는 정도)
한계: 공통 구간이 짧아(약 15~24년) 독립 표본은 훨씬 적고, 한국 2025~ 급등이 결과를 좌우할 수 있다. 시작 시점을 앞뒤로 옮겨 민감도도 본다.
"""
import json, re, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
j = txt[txt.index("= [{") + 2: txt.rindex("]") + 1]
assets = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(j)}
print("자산:", {k: (min(v), max(v)) for k, v in assets.items()})
for us_id in ("sp500", "nasdaq100"):
    print("#"*10, "미국 자산:", us_id)
    k, u = assets["kospi200"], assets[us_id]
    ms = [m for m in sorted(k) if m in u]
    rk = np.array([k[ms[i]] / k[ms[i-1]] - 1 for i in range(1, len(ms))])
    ru = np.array([u[ms[i]] / u[ms[i-1]] - 1 for i in range(1, len(ms))])
    n = len(rk)
    print(f"\n공통 {ms[0]}~{ms[-1]} ({n}개월) 연환산: 코스피200 {(np.prod(1+rk)**(12/n)-1)*100:.1f}% / 미국 {(np.prod(1+ru)**(12/n)-1)*100:.1f}%, 월수익률 상관 {np.corrcoef(rk, ru)[0,1]:.2f}")
    def mdd(r):
        p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]; return (p / pk - 1).min() * 100
    print(f"최대낙폭 코스피200 {mdd(rk):.0f}% / 미국 {mdd(ru):.0f}% / 반반(월 리밸런싱) {mdd(0.5*rk+0.5*ru):.0f}%")
    print("\n=== 보유 기간별 (모든 시작월) ===")
    print(f"{'기간':>5s} {'시작수':>6s} {'코스피 중앙':>10s} {'미국 중앙':>9s} {'반반 중앙':>9s} {'미국이 이긴 비율':>14s} {'코스피 최저':>10s} {'미국 최저':>9s} {'반반 최저':>9s}")
    for H in (36, 60, 120):
        a = np.array([np.prod(1 + rk[s:s+H]) for s in range(n - H + 1)])
        b = np.array([np.prod(1 + ru[s:s+H]) for s in range(n - H + 1)])
        c = np.array([np.prod(1 + (0.5*rk+0.5*ru)[s:s+H]) for s in range(n - H + 1)])
        print(f"{H//12:>4d}년 {len(a):>6d} {np.median(a):>10.2f} {np.median(b):>9.2f} {np.median(c):>9.2f} {(b>a).mean()*100:>13.0f}% {a.min():>10.2f} {b.min():>9.2f} {c.min():>9.2f}")
    print("\n=== 민감도: 시작 연도를 옮겨 보면 (전체 기간 연환산 %) ===")
    for y0 in ("2003", "2008", "2013", "2018"):
        i = next(i for i, m in enumerate(ms[1:]) if m >= y0 + "01")
        a, b = rk[i:], ru[i:]; nn = len(a)
        print(f"  {y0}~ : 코스피200 {(np.prod(1+a)**(12/nn)-1)*100:5.1f}% / 미국 {(np.prod(1+b)**(12/nn)-1)*100:5.1f}%")
    print("\n=== 연도별 수익률(%) — 어느 해에 누가 이겼나 ===")
    years = sorted({m[:4] for m in ms})
    wins = 0; tot = 0; rows = []
    for y in years:
        ix = [i for i, m in enumerate(ms[1:]) if m[:4] == y]
        if len(ix) < 12: continue
        a = np.prod(1 + rk[ix]) - 1; b = np.prod(1 + ru[ix]) - 1
        rows.append((y, a * 100, b * 100)); tot += 1; wins += b > a
    print("  " + "  ".join(f"{y}:{a:+.0f}/{b:+.0f}" for y, a, b in rows))
    print(f"  미국이 이긴 해 {wins}/{tot}")
