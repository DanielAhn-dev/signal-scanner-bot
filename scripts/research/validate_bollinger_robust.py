# -*- coding: utf-8 -*-
"""볼린저 돌파 규칙의 파라미터 주변 안정성·연도별 일관성 (validate_index_rules.py 후속, 2026-10-01).
단일 파라미터에서만 좋으면 우연(17개 중 최고 선택 편향)이므로 격자 전체가 괜찮은지 본다."""
import sys
import numpy as np
sys.argv = ["x"]
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("r", pathlib.Path(__file__).with_name("validate_index_rules.py"))
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
c, N, dates = r.c, r.N, r.dates
START = 250
print("볼린저 돌파: 진입=종가>상단(윈도 W, k표준편차), 청산=종가<중심선(SMA W)   [CAGR / MDD / 샤프 / 보유%]")
print(f"{'W':>3s} " + " ".join(f"k={k:<4}              " for k in (1.0, 1.5, 2.0, 2.5)))
for W in (10, 20, 30, 50, 100):
    cells = []
    mid = r.sma(c, W); sd = r.rolling(np.std, c, W)
    for k in (1.0, 1.5, 2.0, 2.5):
        st = r.state_machine(r.nan_false(c > mid + k * sd), r.nan_false(c < mid)).astype(float)
        d, p = r.run(st); s = r.stats(d[START:], p[START:])
        cells.append(f"{s[0]:4.1f}/{s[1]:5.1f}/{s[2]:4.2f}/{s[3]:3.0f}")
    print(f"{W:3d} " + "  ".join(cells))
print("\n(기준) 보유 10.4/-55.7/0.39, SMA50 12.3/-35.2/0.57")

# 연도별: 표준(20,2) 규칙 vs 보유 vs SMA50
mid = r.sma(c, 20); sd = r.rolling(np.std, c, 20)
st = r.state_machine(r.nan_false(c > mid + 2 * sd), r.nan_false(c < mid)).astype(float)
dB, _ = r.run(st); dS, _ = r.run(r.nan_false(c > r.S50).astype(float)); dH, _ = r.run(np.ones(N))
yrs = np.array([d[:4] for d in dates])
print("\n연도별 수익(%)  볼린저돌파 / SMA50 / 보유")
winB = winS = n = 0
for y in sorted(set(yrs))[1:]:
    m = yrs == y
    f = lambda d: (np.prod(1 + d[m]) - 1) * 100
    b, s, h = f(dB), f(dS), f(dH)
    n += 1; winB += b > h; winS += s > h
    print(f"{y}  {b:7.1f} {s:7.1f} {h:7.1f}")
print(f"보유 이긴 해: 볼린저 {winB}/{n}, SMA50 {winS}/{n}")
