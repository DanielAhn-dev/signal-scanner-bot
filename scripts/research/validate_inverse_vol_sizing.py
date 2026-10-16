# -*- coding: utf-8 -*-
"""H56 '아플 크기' 비중: 개별주 5종목 바구니를 직전 60거래일 변동성의 역수로 담기 vs 균등.
기준은 hypothesis-ledger H56에 결과 보기 전 고정. 비중 효과만 보려고 종목은 시총 상위 200에서 무작위로 고른다.
시총 근사 = 수정주가 × DART 최근 보고 보통주 주식수(C25와 같은 방식). 비용 무시(매매 횟수 같음)."""
import sys, os, json, glob, pickle
import numpy as np
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
CACHE = ".research-cache"
px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
names = {c[2]: c[1] for c in corps}
c2t = {c[0]: c[2] for c in corps}
codes = [c for c, v in px.items() if len(v) > 300 and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
dates = sorted({r[0] for c in codes for r in px[c]})
di = {d: i for i, d in enumerate(dates)}
T, N = len(dates), len(codes)
P = np.full((T, N), np.nan)
for j, c in enumerate(codes):
    for r in px[c]:
        if r[4] > 0:
            P[di[r[0]], j] = r[4]
cidx = {c: j for j, c in enumerate(codes)}
SH = np.full(N, np.nan)
for fn in glob.glob(f"{CACHE}/shares/*.json"):
    d = json.load(open(fn))
    tk = c2t.get(os.path.basename(fn).split("_")[0])
    if d.get("common") and tk in cidx:
        SH[cidx[tk]] = d["common"]
print(f"종목 {N}, 주식수 확보 {int(np.isfinite(SH).sum())}, 거래일 {dates[0]}~{dates[-1]}")

HOLD, LOOK, TOPN, K, DRAWS = 250, 60, 200, 5, 500
rng = np.random.default_rng(20261016)
# 분기 첫 거래일
qstarts = []
for i in range(1, T):
    if dates[i][4:6] in ("01", "04", "07", "10") and dates[i][4:6] != dates[i - 1][4:6]:
        if i >= 250 and i + HOLD < T:
            qstarts.append(i)
# 앱 안내용 기준 배수(판정 외): 분기마다 상위 200 종목 60일 변동성 ÷ 같은 창 KODEX 200 변동성의 중앙값 → 분기 중앙값
kx = {r[0]: r[1] for r in json.load(open(f"{CACHE}/allweather/kr_069500.json"))}
KX = np.array([kx.get(d, np.nan) for d in dates], float)
ref_ratios = []
rows = []  # (진입일, 균등수익, 역변동수익, 균등낙폭, 역변동낙폭)
for e in qstarts:
    hist = P[e - 250:e]
    ok = (np.sum(np.isfinite(hist), axis=0) >= 200) & np.isfinite(P[e - 1]) & np.isfinite(P[e]) & np.isfinite(SH)
    cap = np.where(ok, P[e - 1] * SH, -np.inf)
    univ = np.argsort(-cap)[:TOPN]
    univ = univ[np.isfinite(cap[univ])]
    seg = P[e - LOOK - 1:e]
    r = np.diff(np.log(seg), axis=0)
    vol = np.nanstd(r, axis=0)
    kseg = KX[e - LOOK - 1:e]
    if np.all(np.isfinite(kseg)):
        kv = np.std(np.diff(np.log(kseg)))
        uv = vol[univ]; uv = uv[np.isfinite(uv) & (uv > 0)]
        if kv > 0 and len(uv):
            ref_ratios.append(np.median(uv) / kv)
    # 보유 구간: 끊기면 마지막 종가로 동결
    H = P[e:e + HOLD + 1].copy()
    for t in range(1, len(H)):
        m = ~np.isfinite(H[t]); H[t, m] = H[t - 1, m]
    G = H / H[0]
    for _ in range(DRAWS):
        pick = rng.choice(univ, K, replace=False)
        v = vol[pick]
        if not np.all(np.isfinite(v)) or np.any(v <= 0):
            continue
        we = np.full(K, 1 / K); wi = (1 / v) / np.sum(1 / v)
        out = []
        for w in (we, wi):
            path = G[:, pick] @ w
            dd = np.min(path / np.maximum.accumulate(path) - 1)
            out += [path[-1] - 1, dd]
        rows.append((dates[e], out[0], out[2], out[1], out[3]))
A = np.array([r[1:] for r in rows])
D = np.array([r[0] for r in rows])
print(f"진입 분기 {len(qstarts)}개 ({dates[qstarts[0]]}~{dates[qstarts[-1]]}), 바구니 {len(rows)}개")

print(f"앱 기준 배수(상위200 종목 변동성 ÷ KODEX 200, 분기 {len(ref_ratios)}개): 중앙 {np.median(ref_ratios):.2f}, 범위 {min(ref_ratios):.2f}~{max(ref_ratios):.2f}")


def summ(mask, label):
    eq, iv, deq, div = A[mask, 0], A[mask, 1], A[mask, 2], A[mask, 3]
    p5 = np.percentile(iv, 5) - np.percentile(eq, 5)
    md = np.median(iv) - np.median(eq)
    print(f"\n== {label} (바구니 {mask.sum()}개)")
    print(f"  1년 수익  균등: 하위1% {np.percentile(eq,1)*100:.1f}% 하위5% {np.percentile(eq,5)*100:.1f}% 중앙 {np.median(eq)*100:.1f}% 평균 {eq.mean()*100:.1f}%")
    print(f"           역변동: 하위1% {np.percentile(iv,1)*100:.1f}% 하위5% {np.percentile(iv,5)*100:.1f}% 중앙 {np.median(iv)*100:.1f}% 평균 {iv.mean()*100:.1f}%")
    print(f"  차이(역변동−균등): 하위5% {p5*100:+.2f}%p, 중앙 {md*100:+.2f}%p, 평균 {(iv.mean()-eq.mean())*100:+.2f}%p")
    print(f"  1년 중 최대낙폭 하위5%: 균등 {np.percentile(deq,5)*100:.1f}% vs 역변동 {np.percentile(div,5)*100:.1f}%, 중앙 {np.median(deq)*100:.1f}% vs {np.median(div)*100:.1f}%")
    return p5, md


p5, md = summ(np.ones(len(D), bool), "전체 (판정)")
a5, _ = summ(D < "20200101", "진입 2014~2019")
b5, _ = summ(D >= "20200101", "진입 2020~")
c1, c2, c3 = p5 >= 0.03, md >= -0.005, a5 > 0 and b5 > 0
print(f"\n판정: (1) 하위5% ≥ +3%p {'충족' if c1 else '미달'} · (2) 중앙 ≥ −0.5%p {'충족' if c2 else '미달'} · (3) 두 구간 하위5% 개선 {'충족' if c3 else '미달'}"
      f" → {'통과' if c1 and c2 and c3 else '기각'}")
