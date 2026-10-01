# -*- coding: utf-8 -*-
"""
어닝 서프라이즈 후 drift(PEAD) 검증 (2026-10-01). DART 분기재무 + 네이버 수정주가(상장폐지 포함) 캐시 사용.

이벤트 = 분기 공시(rcept 일자). 서프라이즈 = (영업이익_분기 - 전년동기) / 자본총계 (분모가 0 근처인 적자·소규모 기저 폭주 방지).
진입 = 공시일 '다음' 거래일 종가(공시 시각을 몰라 첫날 반응은 먹지 않는다 = 실제로 따라 할 수 있는 방식),
보유 20/60거래일. 초과수익 = 종목 수익 - 같은 날 진입한 유니버스 평균 수익.
같은 달 이벤트끼리 서프라이즈 5분위 → 상위 - 하위 월별 스프레드, 전·후반·연도별 일관성과 NW t.
유니버스: 20일 평균 거래대금 10억 이상(전체) / 그 중 거래대금 상위 300(대형·중형 근사).
비용 미차감(왕복 0.3% 가정 시 표 값에서 빼서 본다).
"""
import collections, glob, json, os, pickle, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import revalidate_rules as rv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
CACHE = ".research-cache"
px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
fin = rv.parse_financials(CACHE)
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
names = {c[2]: c[1] for c in corps}
codes = [c for c, v in px.items() if len(v) > 300 and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
dates = sorted({r[0] for c in codes for r in px[c]})
di = {d: i for i, d in enumerate(dates)}
T, N = len(dates), len(codes)
C = np.full((T, N), np.nan); TV = np.full((T, N), np.nan)
for j, c in enumerate(codes):
    for r in px[c]:
        i = di[r[0]]; C[i, j] = r[4]; TV[i, j] = r[4] * r[5]
last = T - 1 - np.argmax(~np.isnan(C[::-1]), axis=0)
first = np.argmax(~np.isnan(C), axis=0)
Cf = C.copy()
for j in range(N):
    v = np.nan
    for i in range(first[j], T):
        if i <= last[j] and not np.isnan(Cf[i, j]): v = Cf[i, j]
        else: Cf[i, j] = v
TV20 = np.full((T, N), np.nan)
for j in range(N):
    s = np.nan_to_num(TV[:, j]); cs = np.cumsum(s)
    TV20[19:, j] = (cs[19:] - np.concatenate(([0], cs[:-20]))) / 20
cidx = {c: j for j, c in enumerate(codes)}
QEND = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}


def days_after_qend(y, q, rcept):
    import datetime as dt
    m, d = QEND[q]
    return (dt.date(int(rcept[:4]), int(rcept[4:6]), int(rcept[6:])) - dt.date(y, m, d)).days


def first_idx_ge(d):
    import bisect
    return bisect.bisect_left(dates, d)


events = []
for c, L in fin.items():
    if c not in cidx: continue
    j = cidx[c]; idx = {(r["y"], r["q"]): r for r in L}
    for r in L:
        ya = idx.get((r["y"] - 1, r["q"]))
        if not ya or r.get("op_q") is None or ya.get("op_q") is None or not r.get("eq") or r["eq"] <= 0: continue
        lim = 110 if r["q"] == 4 else 75
        lag = days_after_qend(r["y"], r["q"], r["rcept"])
        if not (0 < lag <= lim): continue  # 정정공시·지연공시 제외
        t0 = first_idx_ge(r["rcept"])
        e = t0 + 1  # 다음 거래일 종가 진입
        if e + 60 >= T or e >= T or t0 >= T or r["rcept"] < "20170428": continue
        if not (first[j] + 250 <= e <= last[j]) or np.isnan(Cf[e, j]) or np.isnan(TV20[e, j]): continue
        events.append(dict(j=j, e=e, d=dates[e], s=(r["op_q"] - ya["op_q"]) / r["eq"], tv=TV20[e, j]))
print(f"이벤트 {len(events)}건 ({events[0]['d']}~{events[-1]['d']})")
for ev in events:
    for H in (20, 60):
        ev[f"r{H}"] = Cf[ev["e"] + H, ev["j"]] / Cf[ev["e"], ev["j"]] - 1
# 같은 진입일 유니버스 평균(비교 기준): 해당일 거래대금 10억 이상 전 종목의 H일 수익 평균
mkt = {}
def mk(e, H):
    k = (e, H)
    if k not in mkt:
        ok = (TV20[e] >= 1e9) & ~np.isnan(Cf[e]) & ~np.isnan(Cf[e + H])
        mkt[k] = float(np.mean(Cf[e + H][ok] / Cf[e][ok] - 1))
    return mkt[k]
for ev in events:
    for H in (20, 60): ev[f"x{H}"] = ev[f"r{H}"] - mk(ev["e"], H)


def nw_t(x, lag=3):
    x = np.asarray(x); n = len(x); e = x - x.mean(); v = e @ e / n
    for l in range(1, lag + 1): v += 2 * (1 - l / (lag + 1)) * (e[l:] @ e[:-l]) / n
    return x.mean() / np.sqrt(v / n)


def study(label, evs):
    print(f"\n== {label} (이벤트 {len(evs)}건)")
    bym = collections.defaultdict(list)
    for ev in evs: bym[ev["d"][:6]].append(ev)
    for H in (20, 60):
        spreads, tops, bots, mids = {}, [], [], []
        for m, L in sorted(bym.items()):
            if len(L) < 25: continue
            s = np.array([ev["s"] for ev in L]); x = np.array([ev[f"x{H}"] for ev in L])
            q = np.argsort(np.argsort(s)) * 5 // len(L)
            spreads[m] = x[q == 4].mean() - x[q == 0].mean()
            tops.append(x[q == 4].mean()); bots.append(x[q == 0].mean()); mids.append(x[q == 2].mean())
        v = np.array(list(spreads.values())); ms = sorted(spreads); half = len(v) // 2
        by_year = collections.defaultdict(list)
        for m, sp in spreads.items(): by_year[m[:4]].append(sp)
        yrs = " ".join(f"{y[2:]}:{np.mean(a)*100:+.1f}" for y, a in sorted(by_year.items()))
        print(f"  {H}일: 상위5분위 {np.mean(tops)*100:+.2f}% / 중간 {np.mean(mids)*100:+.2f}% / 하위 {np.mean(bots)*100:+.2f}% → 스프레드 {v.mean()*100:+.2f}%p "
              f"(월 {len(v)}개, NW t={nw_t(v):+.2f}, 전반 {v[:half].mean()*100:+.2f} 후반 {v[half:].mean()*100:+.2f}, 양(+)인 달 {np.mean(v>0)*100:.0f}%)")
        print(f"       연도별 스프레드(%p): {yrs}")


study("전체 유니버스(거래대금 10억+)", events)
by_month_tv = collections.defaultdict(list)
for ev in events: by_month_tv[ev["d"][:6]].append(ev)
top300 = []
for m, L in by_month_tv.items():
    top300 += sorted(L, key=lambda ev: -ev["tv"])[:300]
study("거래대금 상위 300(월별)", sorted(top300, key=lambda ev: ev["d"]))
