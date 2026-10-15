# -*- coding: utf-8 -*-
"""
H49(조사 R3): 경기선행지수가 꺾인 국면에는 다음 3개월 주가가 오르는 국면보다 나쁜가 (2026-10-15).
판정 기준은 hypothesis-ledger.md H49에 결과 보기 전 고정(커밋 후 이 스크립트 작성).
데이터: .research-cache/macro_leading/ (fetch_macro_leading.py) — oecd_cli.json, indices.json, ecos_kr.json.
  하락 국면 = 월말 t에 쓸 수 있는 최신 값(CLI·선행지수는 t−2월, 수출은 t−1월)이 그 3개월 전 값보다 낮음.
  결과 = 지수 월말 t → t+3 로그수익. 안 ~2011, 밖 2012~.
출력: .research-cache/leading_indicators_out.txt
"""
import json, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

D = ".research-cache/macro_leading/"
OUT = ".research-cache/leading_indicators_out.txt"
H, LAG_CLI, LAG_EXP, LOOK, NW_LAG, SPLIT = 3, 2, 1, 3, 3, "201201"

cli = {cc: {k.replace("-", ""): v for k, v in s.items()} for cc, s in json.load(open(D + "oecd_cli.json")).items()}
idx = json.load(open(D + "indices.json"))
ecos = json.load(open(D + "ecos_kr.json", encoding="utf-8"))

months = []
y, m = 1970, 1
while (y, m) <= (2026, 9):
    months.append(f"{y}{m:02d}")
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
T = len(months)
pos = {mm: i for i, mm in enumerate(months)}
lines = []


def say(s=""):
    print(s)
    lines.append(s)


def arr(series):
    a = np.full(T, np.nan)
    for k, v in series.items():
        if k in pos:
            a[pos[k]] = v
    return a


def lagged(a, n):
    out = np.full(T, np.nan)
    out[n:] = a[:-n]
    return out


def down_flag(level, lag):
    # t에 쓸 수 있는 값(t−lag)과 그 LOOK개월 전 값(t−lag−LOOK) 비교
    cur, prev = lagged(level, lag), lagged(level, lag + LOOK)
    ok = np.isfinite(cur) & np.isfinite(prev)
    return cur < prev, ok


def fwd(px):
    r = np.full(T, np.nan)
    dd = np.full(T, np.nan)
    for t in range(T - H):
        if np.isfinite(px[t]) and np.all(np.isfinite(px[t + 1:t + H + 1])):
            r[t] = np.log(px[t + H] / px[t])
            dd[t] = px[t + 1:t + H + 1].min() / px[t] - 1
    return r, dd


def nw_mean_t(y, lag=NW_LAG):
    y = np.asarray(y, float)
    u = y - y.mean()
    n = len(y)
    s = u @ u / n
    for k in range(1, lag + 1):
        s += 2 * (1 - k / (lag + 1)) * (u[k:] @ u[:-k]) / n
    return y.mean(), y.mean() / np.sqrt(s / n)


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


is_in = np.array([mm < SPLIT for mm in months])

# ── (A) 국가 패널 ───────────────────────────────────────
panel = sorted(c for c in cli if c in idx)
R, DD, DN, OK = {}, {}, {}, {}
for c in panel:
    R[c], DD[c] = fwd(arr(idx[c]))
    DN[c], ok = down_flag(arr(cli[c]), LAG_CLI)
    OK[c] = ok & np.isfinite(R[c])

S = np.full(T, np.nan)
for t in range(T):
    dn = [R[c][t] for c in panel if OK[c][t] and DN[c][t]]
    up = [R[c][t] for c in panel if OK[c][t] and not DN[c][t]]
    if len(dn) >= 2 and len(up) >= 2:
        S[t] = np.mean(dn) - np.mean(up)

say("[H49-A] 국가 패널: 달마다 (하락 국면 국가 평균 − 상승 국면 국가 평균) 3개월 로그수익")
say(f"  국가 {len(panel)}: {', '.join(panel)}")
okS = np.isfinite(S)
iS = np.where(okS)[0]
say(f"  유효 달 {okS.sum()} ({months[iS[0]]}~{months[iS[-1]]})")
resA = {}
for nm, sel in (("안(~2011)", is_in), ("밖(2012~)", ~is_in), ("전체", np.ones(T, bool))):
    y = S[okS & sel]
    mu, t = nw_mean_t(y)
    resA[nm] = (mu, t)
    say(f"  {nm}: 달 {len(y)} · 평균 차 {mu*100:+.2f}%p/3개월 · NW t {t:+.2f} · 음수인 달 {np.mean(y < 0)*100:.0f}%")

say("  국가별 (하락 − 상승) 3개월 평균 차 / 하락 국면 비율 / 3개월 내 최저 낙폭 평균(하락 vs 상승):")
neg = 0
for c in panel:
    ok = OK[c]
    a, b = R[c][ok & DN[c]], R[c][ok & ~DN[c]]
    if len(a) < 12 or len(b) < 12:
        continue
    d = a.mean() - b.mean()
    neg += d < 0
    da, db = DD[c][ok & DN[c]].mean(), DD[c][ok & ~DN[c]].mean()
    say(f"    {c}: {d*100:+.2f}%p · 하락 국면 {np.mean(DN[c][ok])*100:.0f}% · 낙폭 {da*100:.1f}% vs {db*100:.1f}% · 달 {ok.sum()}")
say(f"  하락 국면이 더 나쁜 국가 {neg}/{len(panel)}")

# ── (B) 한국 단독 ───────────────────────────────────────
kr_r, kr_dd = fwd(arr(idx["KOR"]))


def korea(name, dn, ok):
    ok = ok & np.isfinite(kr_r)
    i = np.where(ok)[0]
    say(f"\n[{name}] 기간 {months[i[0]]}~{months[i[-1]]} · 달 {ok.sum()} · 하락 {int((dn & ok).sum())}")
    res = {}
    for nm, sel in (("안(~2011)", is_in), ("밖(2012~)", ~is_in), ("전체", np.ones(T, bool))):
        o = ok & sel
        a, b = kr_r[o & dn], kr_r[o & ~dn]
        b1, t = nw_slope_t(kr_r[o], dn[o].astype(float))
        da, db = kr_dd[o & dn].mean(), kr_dd[o & ~dn].mean()
        res[nm] = (a.mean() - b.mean(), t)
        say(f"  {nm}: 하락 {len(a)}달 평균 {a.mean()*100:+.2f}% vs 상승 {len(b)}달 {b.mean()*100:+.2f}% → 차 {(a.mean()-b.mean())*100:+.2f}%p · NW t {t:+.2f} · 3개월 내 낙폭 {da*100:.1f}% vs {db*100:.1f}%")
    return res


dnB, okB = down_flag(arr(ecos["선행지수순환변동치"]), LAG_CLI)
resB = korea("H49-B 한국 ECOS 선행지수 순환변동치 → 코스피", dnB, okB)
dnB2, okB2 = down_flag(arr(cli["KOR"]), LAG_CLI)
korea("보조: 한국 OECD CLI → 코스피", dnB2, okB2)

# ── (C) 한국 수출 ───────────────────────────────────────
X = arr(ecos["수출금액"])
yoy = np.full(T, np.nan)
yoy[12:] = np.log(X[12:] / X[:-12])
avg3 = np.full(T, np.nan)
for t in range(2, T):
    w = yoy[t - 2:t + 1]
    if np.all(np.isfinite(w)):
        avg3[t] = w.mean()
dnC, okC = down_flag(avg3, LAG_EXP)
resC = korea("H49-C 한국 수출 전년비 3개월 평균 둔화 → 코스피", dnC, okC)

# ── 판정 ───────────────────────────────────────────────
A_pass = resA["전체"][1] <= -2 and resA["안(~2011)"][0] < 0 and resA["밖(2012~)"][0] < 0
B_ok = resB["안(~2011)"][0] < 0 and resB["밖(2012~)"][0] < 0
C_pass = resC["전체"][1] <= -2 and resC["안(~2011)"][0] < 0 and resC["밖(2012~)"][0] < 0
say("\n[판정 — H49 사전 기준]")
if A_pass and B_ok:
    ab = "통과"
elif A_pass:
    ab = "보류(세계적으로는 맞지만 한국 근거 약함)"
else:
    ab = "기각"
say(f"  (A)+(B) 선행지수: {ab}  [A 전체 t {resA['전체'][1]:+.2f}, A 안·밖 {resA['안(~2011)'][0]*100:+.2f}/{resA['밖(2012~)'][0]*100:+.2f}%p, B 안·밖 {resB['안(~2011)'][0]*100:+.2f}/{resB['밖(2012~)'][0]*100:+.2f}%p]")
say(f"  (C) 수출: {'통과' if C_pass else '기각'}  [전체 t {resC['전체'][1]:+.2f}, 안·밖 {resC['안(~2011)'][0]*100:+.2f}/{resC['밖(2012~)'][0]*100:+.2f}%p]")
if (ab == "통과") != C_pass:
    say("  둘 중 하나만 통과 → 여러 번 검정이므로 '약한 근거'")
say("  한계: 수정치 사용(발표 당시 값 아님), 가격지수(배당 제외), 3개월 창이 겹쳐 독립 표본은 달 수의 약 1/3")

open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
