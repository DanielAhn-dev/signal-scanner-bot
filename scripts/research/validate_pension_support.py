# -*- coding: utf-8 -*-
"""
H50(조사 R5): 급락 구간에서 연기금이 강하게 순매수한 뒤에는 코스피가 같은 급락 구간의 다른 날보다 나은가 (2026-10-15).
판정 기준은 hypothesis-ledger.md H50에 결과 보기 전 고정(커밋 후 이 스크립트 작성).
데이터: .research-cache/market_investor_detail.json (fetch_pension_flow.py, 코스피 2016-05~), .research-cache/kospi.json.
  급락 구간 = 종가가 직전 120거래일 최고 종가보다 10% 이상 낮은 날.
  신호 = 연기금 5거래일 누적 순매수가 직전 250거래일 같은 값 분포의 상위 10%.
  결과 = 코스피 t+1 → t+61 로그수익(주), t+1 → t+21(보조). 안 ~2020-12, 밖 2021~.
출력: .research-cache/pension_support_out.txt
"""
import json, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/pension_support_out.txt"
NW_LAG, SPLIT = 60, "20210101"
lines = []


def say(s=""):
    print(s)
    lines.append(s)


flow = json.load(open(".research-cache/market_investor_detail.json"))["KOSPI"]
kospi = {d: c for d, c in json.load(open(".research-cache/kospi.json"))}
dates = sorted(d for d in flow if d in kospi)
T = len(dates)
P = np.array([kospi[d] for d in dates])
pf = np.array([flow[d].get("PENSION_FUND") or 0.0 for d in dates]) / 1e8  # 억원
missing_px = sorted(set(flow) - set(kospi))
say(f"기간 {dates[0]}~{dates[-1]} · {T}거래일 (지수 없는 날 {len(missing_px)})")

# 120거래일 고점 대비 낙폭(t까지 자료) — 앞 119일은 전체 이력을 쓰려고 kospi.json에서 직접 계산
all_d = sorted(kospi)
all_p = np.array([kospi[d] for d in all_d])
ap = {d: i for i, d in enumerate(all_d)}
dd = np.array([all_p[ap[d]] / all_p[max(0, ap[d] - 119):ap[d] + 1].max() - 1 for d in dates])
crash = dd <= -0.10

f5 = np.full(T, np.nan)
for t in range(4, T):
    f5[t] = pf[t - 4:t + 1].sum()
sig = np.zeros(T, bool)
for t in range(254, T):
    hist = f5[t - 250:t]
    sig[t] = f5[t] >= np.nanquantile(hist, 0.9)
valid = np.arange(T) >= 254


def fwd(h):
    r = np.full(T, np.nan)
    for t in range(T - h - 1):
        r[t] = np.log(P[t + 1 + h] / P[t + 1])
    return r


R60, R20 = fwd(60), fwd(20)


def nw_slope_t(y, x, lag=NW_LAG):
    X1 = np.column_stack([np.ones(len(y)), x])
    b, *_ = np.linalg.lstsq(X1, y, rcond=None)
    u = y - X1 @ b
    XtX_inv = np.linalg.inv(X1.T @ X1)
    Xu = X1 * u[:, None]
    S = Xu.T @ Xu
    for k in range(1, lag + 1):
        Gk = Xu[k:].T @ Xu[:-k]
        S += (1 - k / (lag + 1)) * (Gk + Gk.T)
    V = XtX_inv @ S @ XtX_inv
    return b[1], b[1] / np.sqrt(V[1, 1])


def events(flag):
    ev, last = [], -10**9
    for i in np.where(flag)[0]:
        if i - last >= 60:
            ev.append(i)
            last = i
    return ev


is_in = np.array([d < SPLIT for d in dates])
base = valid & crash & np.isfinite(R60)
ev = events(sig & base)
say(f"급락 구간 유효일 {int(base.sum())} · 그중 연기금 강한 매수일 {int((sig & base).sum())} · 독립 사건 {len(ev)}건")
say("  사건: " + ", ".join(f"{dates[i]}(낙폭 {dd[i]*100:.0f}%, 60일 {R60[i]*100:+.1f}%)" for i in ev))

res = {}
for nm, sel in (("안(~2020)", is_in), ("밖(2021~)", ~is_in), ("전체", np.ones(T, bool))):
    o = base & sel
    a, b = R60[o & sig], R60[o & ~sig]
    if len(a) == 0 or len(b) == 0:
        say(f"  {nm}: 신호일 {len(a)} · 나머지 {len(b)} — 비교 불가")
        res[nm] = None
        continue
    _, t = nw_slope_t(R60[o], sig[o].astype(float))
    a20, b20 = R20[o & sig], R20[o & ~sig]
    res[nm] = (a.mean() - b.mean(), t)
    say(f"  {nm}: 신호 {len(a)}일 60일 {a.mean()*100:+.2f}% vs 나머지 {len(b)}일 {b.mean()*100:+.2f}% → 차 {(a.mean()-b.mean())*100:+.2f}%p · NW t {t:+.2f}"
        f" · 20일 {np.nanmean(a20)*100:+.2f}% vs {np.nanmean(b20)*100:+.2f}%")

# 보조: 급락 구간 밖 같은 신호
o = valid & ~crash & np.isfinite(R60)
a, b = R60[o & sig], R60[o & ~sig]
say(f"\n보조: 급락 구간 밖 — 신호 {len(a)}일 60일 {a.mean()*100:+.2f}% vs 나머지 {b.mean()*100:+.2f}%")
# 보조: 연기금 매수가 하락을 뒤따르는가 (직전 5일 코스피 수익과 5일 누적 순매수 상관)
r5 = np.full(T, np.nan)
r5[5:] = np.log(P[5:] / P[:-5])
ok = np.isfinite(r5) & np.isfinite(f5)
say(f"보조: 직전 5일 코스피 수익 vs 연기금 5일 누적 순매수 상관 {np.corrcoef(r5[ok], f5[ok])[0, 1]:+.2f} (음수면 떨어질 때 산다)")
say(f"보조: 급락 구간 비율 {crash[valid].mean()*100:.0f}% · 급락 구간 중 신호일 비율 {sig[valid & crash].mean()*100:.0f}% (전체 신호일 비율 {sig[valid].mean()*100:.0f}%)")

say("\n[판정 — H50 사전 기준]")
if len(ev) < 6:
    verdict = f"표본 부족 — 보류 (독립 사건 {len(ev)}건 < 6)"
elif res["전체"] and res["안(~2020)"] and res["밖(2021~)"]:
    t_all = res["전체"][1]
    di, do = res["안(~2020)"][0], res["밖(2021~)"][0]
    if t_all >= 2 and di > 0 and do > 0:
        verdict = "통과(급락 때 연기금 매수는 지지 신호)"
    elif t_all <= -2 and di < 0 and do < 0:
        verdict = "반대(연기금 매수 뒤 더 빠짐)"
    else:
        verdict = "기각"
else:
    verdict = "기각(한 구간에 비교 대상 없음)"
say(f"  {verdict}")
say("  한계: 2016-05~ 약 10년, 큰 하락 약 5번, 연기금 분류는 '연기금 등'(국민연금 외 공제회 등 포함)")

open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
