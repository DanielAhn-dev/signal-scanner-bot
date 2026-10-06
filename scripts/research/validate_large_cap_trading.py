# -*- coding: utf-8 -*-
"""
대형·중형주 단기 매매 추가 탐색 R1~R5 (2026-10-06). 가설·판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

유니버스: 전날까지 20일 거래대금 상위 300(봇이 실제로 사는 크기). 상장폐지 포함 수정주가.
  R1 급등(+8%·거래량 5배·고가 95%↑ 마감) 뒤 k일째(2~5) 시가 진입, 20일 보유
  R2 실적 공시 반응(공시일 전날 종가→다음날 종가, 시장 대비) 같은 달 상위 분위를 3일째 종가 진입, 20·60일 보유
  R3 52주 고가 근접도 상위 N, 월/분기 교체
  R4 1개월 수익 하위 N(중기 반전), 월/분기 교체
  R5 시가 갭하락(−3%·−5% 이하) 시가 매수 → 같은 날 종가 매도
기준: 사건형은 KODEX 200 같은 구간(시가 진입이면 ETF 시가), 포트폴리오형은 코스피+배당 연 1.5%p.
고르기는 2021-12까지, 확인은 2022-01~ 한 번.

실행: python scripts/research/validate_large_cap_trading.py
"""
import collections, json, sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_trader_paths as vt  # 데이터·엔진 공유 (import 시 가격 패널을 만든다)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, N = vt.dates, vt.T, vt.N
O, H, C, V, Cf, TV20, V20, UNIV = vt.O, vt.H, vt.C, vt.V, vt.Cf, vt.TV20, vt.V20, vt.UNIV
IS_END = "20211231"
TOP = 300

etf = {r[0]: r for r in json.load(open(".research-cache/trading_etfs/px_069500.json", encoding="utf-8"))}
EO = np.array([etf[d][1] if d in etf else np.nan for d in dates])
EC = np.array([etf[d][4] if d in etf else np.nan for d in dates])
for i in range(1, T):
    if np.isnan(EC[i]):
        EC[i], EO[i] = EC[i - 1], EC[i - 1]


def top_mask(t):
    u = UNIV[t].copy()
    tv = np.where(u, TV20[t - 1], -np.inf)
    m = np.zeros(N, bool)
    m[np.argsort(-tv)[:TOP]] = True
    return u & m


TOPM = {}


def topm(t):
    if t not in TOPM:
        TOPM[t] = top_mask(t)
    return TOPM[t]


def rt_cost(j, t):
    return 2 * vt.COMM + vt.TAX + 2 * float(vt.slip(np.nan_to_num(TV20[t - 1, j])))


def judge_events(name, ev):
    """ev: [(entry_date_str, net_excess)] → 표본 안/밖 평균, 날짜 묶음 NW t"""
    out = {}
    for lab, lo, hi in (("안", "0", IS_END), ("밖", "20220101", "9")):
        g = collections.defaultdict(list)
        for d, x in ev:
            if lo <= d <= hi and np.isfinite(x):
                g[d].append(x)
        ks = sorted(g)
        m = np.array([np.mean(g[k]) for k in ks])
        n_ev = sum(len(g[k]) for k in ks)
        out[lab] = (m.mean() if len(m) else np.nan, vt.nw_t(m, 5) if len(m) > 10 else np.nan, n_ev)
    a, b = out["안"], out["밖"]
    print(f"  {name:<30} 안 {a[0]*100:+6.2f}% t {a[1]:5.2f} ({a[2]}건) | 밖 {b[0]*100:+6.2f}% t {b[1]:5.2f} ({b[2]}건)", flush=True)
    return out


def chase_days():
    ev = []
    for t in range(260, T - 30):
        tm = topm(t)
        ok = tm & (C[t] / Cf[t - 1] - 1 >= 0.08) & (V[t] >= 5 * V20[t - 1]) & (C[t] >= 0.95 * H[t])
        ev.extend((t, j) for j in np.where(ok)[0])
    return ev


def r1():
    print("\n[R1 급등 뒤 k일째 시가 진입, 20일 보유]")
    base = chase_days()
    res = {}
    for k in (1, 2, 3, 4, 5):
        ev = []
        for t, j in base:
            e = t + k
            x = e + 19
            if x >= T or np.isnan(O[e, j]):
                continue
            ev.append((dates[e], Cf[x, j] / O[e, j] - 1 - rt_cost(j, e) - (EC[x] / EO[e] - 1)))
        res[f"k={k}"] = judge_events(f"{k}일째 진입", ev)
    return res


def earnings_events():
    import bisect, datetime as dt
    fin = vt.fin
    out = []
    for c, L in fin.items():
        if c not in vt.cidx:
            continue
        j = vt.cidx[c]
        for r in L:
            rc = r["rcept"]
            if rc < "20150101":
                continue
            qend = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}[r["q"]]
            lag = (dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:])) - dt.date(r["y"], *qend)).days
            if not (0 < lag <= (110 if r["q"] == 4 else 75)):
                continue
            t0 = bisect.bisect_left(dates, rc)
            if t0 < 261 or t0 + 63 >= T or not topm(t0)[j]:
                continue
            react = Cf[t0 + 1, j] / Cf[t0 - 1, j] - 1 - (EC[t0 + 1] / EC[t0 - 1] - 1)
            if np.isfinite(react):
                out.append((t0, j, react))
    return out


def r2():
    print("\n[R2 실적 공시 반응 상위 분위, 3일째 종가 진입]")
    evs = earnings_events()
    by_m = collections.defaultdict(list)
    for t0, j, x in evs:
        by_m[dates[t0][:6]].append((t0, j, x))
    res = {}
    for q, H_ in ((0.2, 20), (0.2, 60), (0.1, 20), (0.1, 60)):
        ev = []
        for m, L in by_m.items():
            if len(L) < 20:
                continue
            cut = np.quantile([x for _, _, x in L], 1 - q)
            for t0, j, x in L:
                if x < cut:
                    continue
                e, xi = t0 + 2, t0 + 2 + H_
                ev.append((dates[e], Cf[xi, j] / Cf[e, j] - 1 - rt_cost(j, e) - (EC[xi] / EC[e] - 1)))
        res[f"상위{int(q*100)}% {H_}일"] = judge_events(f"상위 {int(q*100)}% · {H_}일 보유", ev)
    return res


def sel_high52(t, n):
    tm = topm(t)
    hi = np.nanmax(H[t - 249:t + 1], axis=0)
    p = np.where(tm, Cf[t] / hi, -np.inf)
    o = np.argsort(-p)[:n]
    return o[np.isfinite(p[o])]


def sel_rev1m(t, n):
    tm = topm(t)
    r = np.where(tm, Cf[t] / Cf[t - 21] - 1, np.inf)
    o = np.argsort(r)[:n]
    return o[np.isfinite(r[o])]


def port_eval(name, sel, n, step):
    nav, i0, i1, cap = vt.run_rebal(sel, 260, step, n)
    sm = vt.monthly_from_daily_nav(nav, i0, i1)
    bm = vt.bench_monthly(i0, i1)
    ks = [k for k in sorted(set(sm) & set(bm))[1:-1] if np.isfinite(sm[k])]
    ex = np.array([sm[k] - bm[k] for k in ks])
    a = np.array([k <= IS_END[:6] for k in ks])
    print(f"  {name:<30} 안 연 초과 {ex[a].mean()*1200:+6.1f}%p t {vt.nw_t(ex[a]):5.2f} | "
          f"밖 연 초과 {ex[~a].mean()*1200:+6.1f}%p t {vt.nw_t(ex[~a]):5.2f} | 전체 t {vt.nw_t(ex):5.2f}", flush=True)
    return dict(is_ex=ex[a].mean() * 12, is_t=vt.nw_t(ex[a]), oos_ex=ex[~a].mean() * 12, all_t=vt.nw_t(ex), oos_t=vt.nw_t(ex[~a]))


def r3():
    print("\n[R3 52주 고가 근접 상위]")
    return {f"N{n} 교체{s}": port_eval(f"N{n} 교체{s}일", sel_high52, n, s) for n, s in ((20, 21), (10, 21), (30, 21), (20, 63))}


def r4():
    print("\n[R4 1개월 하위(중기 반전)]")
    return {f"N{n} 교체{s}": port_eval(f"N{n} 교체{s}일", sel_rev1m, n, s) for n, s in ((20, 21), (10, 21), (30, 21), (20, 63))}


def r5():
    print("\n[R5 시가 갭하락 당일 시가 매수 → 종가 매도]")
    res = {}
    for g in (0.03, 0.05):
        ev = []
        for t in range(261, T):
            tm = topm(t)
            gap = O[t] / Cf[t - 1] - 1
            ok = tm & (gap <= -g) & ~np.isnan(O[t]) & ~np.isnan(C[t])
            for j in np.where(ok)[0]:
                ev.append((dates[t], C[t, j] / O[t, j] - 1 - rt_cost(j, t) - (EC[t] / EO[t] - 1)))
        res[f"-{int(g*100)}%"] = judge_events(f"갭 -{int(g*100)}% 이하", ev)
    return res


def pick_event(res):
    k = max(res, key=lambda k: res[k]["안"][1] if np.isfinite(res[k]["안"][1]) else -9)
    a, b = res[k]["안"], res[k]["밖"]
    ok = a[1] > 2 and b[0] > 0 and b[1] > 1
    avoid = a[1] < -2 and b[1] < -2
    return k, ok, avoid


def pick_port(res):
    k = max(res, key=lambda k: res[k]["is_t"])
    r = res[k]
    return k, (r["oos_ex"] > 0 and r["all_t"] > 2), (r["is_t"] < -2 and r["oos_t"] < -2)


def r4b():
    print("\n[R4b 1개월 수익 절대 기준 이하, 다음날 시가 진입·20일]")
    for thr in (-0.15, -0.20):
        ev = []
        for t in range(261, T - 21):
            tm = topm(t)
            ok = tm & (Cf[t] / Cf[t - 21] - 1 <= thr)
            e, x = t + 1, t + 20
            for j in np.where(ok)[0]:
                if np.isnan(O[e, j]):
                    continue
                ev.append((dates[e], Cf[x, j] / O[e, j] - 1 - (EC[x] / EO[e] - 1)))
        judge_events(f"1개월 {int(thr*100)}% 이하 (비용 전)", ev)


def main():
    if "--r4b" in sys.argv:
        return r4b()
    out = {"R1": (r1(), pick_event), "R2": (r2(), pick_event), "R3": (r3(), pick_port),
           "R4": (r4(), pick_port), "R5": (r5(), pick_event)}
    print("\n=== 판정 (표본 안 1등 기준) ===")
    for nm, (res, pick) in out.items():
        k, ok, _ = pick(res)
        print(f"  {nm}: 고른 설정 {k} → {'채택 후보' if ok else '기각'}")
    print("\n=== 매수 회피 후보 (두 구간 모두 t < -2인 설정) ===")
    for nm, (res, pick) in out.items():
        for k, v in res.items():
            if isinstance(v, dict) and "안" in v and v["안"][1] < -2 and v["밖"][1] < -2:
                print(f"  {nm} {k}: 안 {v['안'][0]*100:+.2f}% (t {v['안'][1]:.1f}) 밖 {v['밖'][0]*100:+.2f}% (t {v['밖'][1]:.1f})")
            elif isinstance(v, dict) and "is_t" in v and v["is_t"] < -2 and v["oos_t"] < -2:
                print(f"  {nm} {k}: 안 t {v['is_t']:.1f} 밖 t {v['oos_t']:.1f}")


if __name__ == "__main__":
    main()
