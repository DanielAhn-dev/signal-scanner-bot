# -*- coding: utf-8 -*-
"""
트레이더 경로 검증 T1~T4 (2026-10-06). 가설·판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

질문: 기관이 못 들어오는 작은 시장(소형주)이나 단타형 사건 매매에서, 비용을 빼고도 지수를 이기는 방법이 있나?
그리고 그 수익으로 3억·월 300만원 인출(전업)이 버티나?

데이터: 네이버 수정주가 OHLCV(상장폐지 포함, .research-cache/px.pkl) + DART 분기재무(fin/).
- T1 소형주 주간 단기 반전: 5일 수익 최하위 N종목, 5일 보유
- T2 소형주 퀄리티: TTM 이익 성장/자본 · ROE · 60일 저변동 순위 합 상위 N, 21일 교체
- T3 소형주 12-1 모멘텀: 상위 N, 21일 교체
- T4 거래량 급증 장대양봉(+15%·거래량 20일 평균 5배·고가 95% 이상 마감) 다음날 시가 진입, H일 보유, 5칸
체결: 신호 다음 거래일 종가(T4는 다음날 시가). 상장폐지는 마지막 가격에 청산.
비용: 수수료 0.015%×2 + 매도세 0.20% + 한쪽 슬리피지(20일 거래대금 100억↑ 0.05%, 10~100억 0.15%, 그 아래 0.40%).
기준: 코스피 가격지수 + 배당 연 1.5%p.

실행: python scripts/research/validate_trader_paths.py
"""
import bisect, collections, json, os, pickle, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import revalidate_rules as rv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
CACHE = ".research-cache"
COMM, TAX = 0.00015, 0.0020
COST_ON = True  # 진단용: False면 비용 0(총수익)
DIV_M = 0.015 / 12
SEED_SMALL_RANK = 300

px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
names = {c[2]: c[1] for c in corps}
codes = [c for c, v in px.items() if len(v) > 300 and c.endswith("0")
         and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
dates = sorted({r[0] for c in codes for r in px[c]})
di = {d: i for i, d in enumerate(dates)}
T, N = len(dates), len(codes)
O, H, C, V = (np.full((T, N), np.nan) for _ in range(4))
for j, c in enumerate(codes):
    for r in px[c]:
        i = di[r[0]]
        O[i, j], H[i, j], C[i, j], V[i, j] = r[1], r[2], r[4], r[5]
O[O <= 0] = np.nan  # 거래 없는 날 시가 0
first = np.argmax(~np.isnan(C), axis=0)
last = T - 1 - np.argmax(~np.isnan(C[::-1]), axis=0)
Cf = C.copy()
for j in range(N):
    v = np.nan
    for i in range(first[j], T):
        if i <= last[j] and not np.isnan(Cf[i, j]):
            v = Cf[i, j]
        else:
            Cf[i, j] = v


def roll_mean(X, w):
    s = np.nan_to_num(X)
    cs = np.cumsum(s, axis=0)
    out = np.full_like(X, np.nan)
    out[w - 1:] = (cs[w - 1:] - np.vstack([np.zeros((1, X.shape[1])), cs[:-w]])) / w
    return out


TV20 = roll_mean(C * V, 20)
V20 = roll_mean(V, 20)
R1 = Cf[1:] / Cf[:-1] - 1
R1 = np.vstack([np.full((1, N), np.nan), R1])
def vol60(t):
    return np.nanstd(R1[t - 59:t + 1], axis=0)


idx = np.arange(T)[:, None]
LISTED = (idx >= first[None, :] + 250) & (idx <= last[None, :])
UNIV = LISTED & ~np.isnan(C) & (Cf >= 1000) & (TV20 >= 1e8)


def small_mask(t):
    u = UNIV[t].copy()
    tv = np.where(u, TV20[t], -np.inf)
    order = np.argsort(-tv)
    big = order[:SEED_SMALL_RANK]
    u[big] = False
    return u


def slip(tv):
    if not COST_ON:
        return np.zeros_like(np.asarray(tv, float))
    return np.where(tv >= 1e10, 0.0005, np.where(tv >= 1e9, 0.0015, 0.004))


# ── 코스피 기준 ───────────────────────────────────────────
kospi = dict((d, v) for d, v in json.load(open(f"{CACHE}/kospi.json")))
KI = np.array([kospi.get(d, np.nan) for d in dates])
for i in range(1, T):
    if np.isnan(KI[i]):
        KI[i] = KI[i - 1]


def month_key(i):
    return dates[i][:6]


def monthly_from_daily_nav(nav, i0, i1):
    """nav[i] (i0..i1) → {yyyymm: 월수익}"""
    out, prev_end, cur = {}, nav[i0], month_key(i0)
    for i in range(i0 + 1, i1 + 1):
        m = month_key(i)
        if m != cur:
            out[cur] = nav[i - 1] / prev_end - 1
            prev_end, cur = nav[i - 1], m
    out[cur] = nav[i1] / prev_end - 1
    return out


def bench_monthly(i0, i1):
    m = monthly_from_daily_nav(KI, i0, i1)
    return {k: v + DIV_M for k, v in m.items()}


def nw_t(x, lag=3):
    x = np.asarray(x, float)
    n = len(x)
    if n < 10:
        return np.nan
    e = x - x.mean()
    s = e @ e / n
    for L in range(1, lag + 1):
        s += 2 * (1 - L / (lag + 1)) * (e[L:] @ e[:-L]) / n
    return x.mean() / np.sqrt(s / n)


# ── 교체형 포트폴리오 시뮬레이션 ────────────────────────────

def run_rebal(select, start, step, n):
    """select(t, n) → 종목 인덱스 배열. t 종가 신호, t+1 종가 체결, 다음 교체일+1 종가 청산."""
    nav = np.full(T, np.nan)
    i0 = start + 1
    nav[i0] = 1.0
    held, w = np.array([], int), None
    cap = []  # 3억 기준 종목당 금액 / 거래대금
    t = start
    while t + 1 < T - 1:
        e = t + 1
        new = select(t, n)
        if len(new) == 0:
            new = held
        # 비용: 나가는 종목(매도), 들어오는 종목(매수)
        cost = 0.0
        out_ = np.setdiff1d(held, new)
        in_ = np.setdiff1d(new, held)
        if len(held):
            cost += np.sum(COMM + TAX + slip(np.nan_to_num(TV20[e, out_]))) / max(len(held), 1)
        cost += np.sum(COMM + slip(np.nan_to_num(TV20[e, in_]))) / max(len(new), 1)
        if not COST_ON:
            cost = 0.0
        nav[e] = nav[e] * (1 - cost)
        held = new
        for j in in_:
            if TV20[e, j] > 0:
                cap.append(3e8 / len(new) / TV20[e, j])
        nxt = min(t + step, T - 2)
        base = Cf[e, held]
        for i in range(e + 1, nxt + 2):
            nav[i] = nav[e] * np.nanmean(Cf[i, held] / base) if len(held) else nav[e]
        t = nxt
        if t + 1 >= T - 1:
            break
    end = T - 1
    while np.isnan(nav[end]):
        end -= 1
    return nav, i0, end, np.array(cap)


def sel_reversal(t, n):
    u = small_mask(t)
    r5 = Cf[t] / Cf[t - 5] - 1
    r5 = np.where(u & ~np.isnan(r5), r5, np.inf)
    o = np.argsort(r5)[:n]
    return o[np.isfinite(r5[o])]


def sel_momentum(t, n):
    u = small_mask(t)
    m = Cf[t - 21] / Cf[t - 252] - 1
    m = np.where(u & ~np.isnan(m), m, -np.inf)
    o = np.argsort(-m)[:n]
    return o[np.isfinite(m[o])]


# 재무 특성: 공시일(rcept) 기준으로만 사용
fin = rv.parse_financials(CACHE)
cidx = {c: j for j, c in enumerate(codes)}
FEAT = collections.defaultdict(list)  # j → [(rcept, growth, roe)]
for c, L in fin.items():
    if c not in cidx:
        continue
    q = {(r["y"], r["q"]): r for r in L}
    for r in L:
        keys = [(r["y"], r["q"])]
        y, qq = r["y"], r["q"]
        for _ in range(7):
            qq -= 1
            if qq == 0:
                y, qq = y - 1, 4
            keys.append((y, qq))
        rows = [q.get(k) for k in keys]
        if any(x is None or x.get("op_q") is None or x.get("ni_q") is None for x in rows):
            continue
        eq = r.get("eq")
        if not eq or eq <= 0:
            continue
        op_now = sum(x["op_q"] for x in rows[:4])
        op_prev = sum(x["op_q"] for x in rows[4:])
        ni = sum(x["ni_q"] for x in rows[:4])
        rc = max(x["rcept"] for x in rows[:4])
        FEAT[cidx[c]].append((rc, (op_now - op_prev) / eq, ni / eq))
for j in FEAT:
    FEAT[j].sort()
FEAT_KEYS = {j: [x[0] for x in L] for j, L in FEAT.items()}


def feats_at(t):
    d = dates[t]
    import datetime as dt
    dd = dt.date(int(d[:4]), int(d[4:6]), int(d[6:]))
    g = np.full(N, np.nan)
    roe = np.full(N, np.nan)
    for j, L in FEAT.items():
        k = bisect.bisect_left(FEAT_KEYS[j], d) - 1  # 신호일 '전'까지 공시
        if k < 0:
            continue
        rc = L[k][0]
        if (dd - dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:]))).days > 200:
            continue
        g[j], roe[j] = L[k][1], L[k][2]
    return g, roe


def rank(x, asc):
    r = np.full(len(x), np.nan)
    ok = ~np.isnan(x)
    o = np.argsort(x[ok] if asc else -x[ok])
    rr = np.empty(ok.sum())
    rr[o] = np.arange(ok.sum())
    r[ok] = rr / max(ok.sum() - 1, 1)
    return r


def sel_quality(t, n):
    u = small_mask(t)
    g, roe = feats_at(t)
    v = vol60(t)
    ok = u & ~np.isnan(g) & ~np.isnan(roe) & ~np.isnan(v)
    if ok.sum() < n * 3:
        return np.array([], int)
    s = np.full(N, np.inf)
    s[ok] = rank(g[ok], False) + rank(roe[ok], False) + rank(v[ok], True)
    return np.argsort(s)[:n]


# ── T4 사건 매매 (5칸) ───────────────────────────────────

def t4_events(jump, vmult):
    ev = []
    for t in range(260, T - 12):
        ok = UNIV[t] & (C[t] / Cf[t - 1] - 1 >= jump) & (V[t] >= vmult * V20[t - 1]) & (C[t] >= 0.95 * H[t])
        for j in np.where(ok)[0]:
            if np.isnan(O[t + 1, j]):
                continue
            ev.append((t + 1, j, V[t, j] / V20[t - 1, j]))
    return ev


def run_t4(ev, hold, slots=5):
    """현금 + 포지션 금액 추적. 시가 매수, 진입 후 hold번째 날 종가 매도(hold=1이면 당일 종가)."""
    by = collections.defaultdict(list)
    for e, j, s in ev:
        by[e].append((s, j))
    i_start = min(by) if by else 260
    nav = np.full(T, np.nan)
    cash, pos, trades, cap = 1.0, [], [], []
    for i in range(i_start, T):
        for p in pos:
            if p["ei"] < i:
                p["val"] *= Cf[i, p["j"]] / Cf[i - 1, p["j"]]
        keep = []
        for p in pos:
            if i >= p["xi"]:
                c_out = (COMM + TAX) * COST_ON + slip(np.nan_to_num(TV20[p["ei"] - 1, p["j"]]))
                cash += p["val"] * (1 - c_out)
                trades.append((p["ei"], p["val"] * (1 - c_out) / p["amt"] - 1, KI[i] / KI[p["ei"] - 1] - 1))
            else:
                keep.append(p)
        pos = keep
        free = slots - len(pos)
        if free > 0 and i in by and i + hold - 1 < T:
            total = cash + sum(p["val"] for p in pos)
            for s, j in sorted(by[i], reverse=True)[:free]:
                amt = min(total / slots, cash)
                if amt <= 1e-9:
                    break
                cash -= amt
                val = amt * (1 - COMM * COST_ON - slip(np.nan_to_num(TV20[i - 1, j]))) * Cf[i, j] / O[i, j]
                p = dict(j=j, ei=i, xi=i + hold - 1, amt=amt, val=val)
                cap.append(3e8 / slots / max(TV20[i - 1, j], 1))
                if p["xi"] <= i:  # 당일 청산
                    c_out = (COMM + TAX) * COST_ON + slip(np.nan_to_num(TV20[i - 1, j]))
                    cash += val * (1 - c_out)
                    trades.append((i, val * (1 - c_out) / amt - 1, KI[i] / KI[i - 1] - 1))
                else:
                    pos.append(p)
        nav[i] = cash + sum(p["val"] for p in pos)
    return nav, i_start, T - 1, trades, np.array(cap)


# ── 판정 ─────────────────────────────────────────────────
SPLIT = "202201"


def judge(name, nav, i0, i1, cap):
    sm = monthly_from_daily_nav(nav, i0, i1)
    bm = bench_monthly(i0, i1)
    ks = [k for k in sorted(set(sm) & set(bm))[1:-1] if not np.isnan(sm[k])]
    ex = np.array([sm[k] - bm[k] for k in ks])
    a = np.array([k < SPLIT for k in ks])
    yrs = len(ks) / 12
    cagr = np.prod([1 + sm[k] for k in ks]) ** (1 / yrs) - 1
    bc = np.prod([1 + bm[k] for k in ks]) ** (1 / yrs) - 1
    navk = np.cumprod([1 + sm[k] for k in ks])
    mdd = np.min(navk / np.maximum.accumulate(navk) - 1)
    res = dict(name=name, months=len(ks), cagr=cagr, bench=bc, ex=ex.mean() * 12, t=nw_t(ex),
               ex1=ex[a].mean() * 12 if a.any() else np.nan, ex2=ex[~a].mean() * 12 if (~a).any() else np.nan,
               mdd=mdd, cap_med=np.median(cap) if len(cap) else np.nan,
               cap_p90=np.percentile(cap, 90) if len(cap) else np.nan,
               series=np.array([sm[k] for k in ks]), bseries=np.array([bm[k] for k in ks]), ks=ks)
    print(f"  {name:<34} {ks[0]}~{ks[-1]} 연 {cagr*100:6.1f}% (기준 {bc*100:5.1f}%) 초과 {res['ex']*100:+6.1f}%p "
          f"t {res['t']:5.2f} | 전반 {res['ex1']*100:+6.1f} 후반 {res['ex2']*100:+6.1f} | MDD {mdd*100:5.0f}% | "
          f"3억 종목당/거래대금 중앙 {res['cap_med']*100:4.1f}% p90 {res['cap_p90']*100:5.1f}%", flush=True)
    return res


def ruin(series, seed, wd=3e6, years=10, sims=4000, block=12):
    """월초 wd 인출 후 그 달 수익. 12개월 블록 부트스트랩. → (파산 확률, 끝 잔고 중앙값)"""
    rng = np.random.default_rng(7)
    months = years * 12
    nb = -(-months // block)
    st = rng.integers(0, len(series) - block, size=(sims, nb))
    paths = series[(st[:, :, None] + np.arange(block)).reshape(sims, -1)[:, :months]]
    bal = np.full(sims, seed, float)
    dead = np.zeros(sims, bool)
    for m in range(months):
        bal = (bal - wd) * (1 + paths[:, m])
        dead |= bal <= 0
        bal = np.where(dead, 0, bal)
    return dead.mean(), np.median(bal)


def gross(fn):
    global COST_ON
    COST_ON = False
    try:
        return fn()
    finally:
        COST_ON = True


def sel_all_small(t, n):
    return np.where(small_mask(t))[0]


def diagnose():
    """비용 0 총수익과 소형주 전체 동일가중(T0)으로 '비용 탓인지, 신호 탓인지, 시장 탓인지' 나눈다."""
    start_px = 260
    start_fin = bisect.bisect_left(dates, "20170601")
    print("\n[진단: 소형주 전체 동일가중 T0, 월 교체]")
    judge("T0 소형주 전체 (비용 포함)", *run_rebal(sel_all_small, start_px, 21, 0))
    judge("T0 소형주 전체 (비용 0)", *gross(lambda: run_rebal(sel_all_small, start_px, 21, 0)))
    print("\n[진단: 비용 0 총수익]")
    judge("T1 N20 보유5일 (비용 0)", *gross(lambda: run_rebal(sel_reversal, start_px, 5, 20)))
    judge("T2 N20 교체21일 (비용 0)", *gross(lambda: run_rebal(sel_quality, start_fin, 21, 20)))
    judge("T3 N20 교체21일 (비용 0)", *gross(lambda: run_rebal(sel_momentum, start_px, 21, 20)))
    for hold in (1, 5):
        ev = t4_events(0.15, 5)
        nav, i0, i1, trades, cap = gross(lambda: run_t4(ev, hold))
        tr = np.array([x[1] for x in trades])
        exk = np.array([x[1] - x[2] for x in trades])
        judge(f"T4 +15% 보유{hold}일 (비용 0)", nav, i0, i1, cap)
        print(f"      거래당 평균 {tr.mean()*100:+.2f}% 승률 {(tr>0).mean()*100:.0f}% · 같은 기간 코스피 대비 {exk.mean()*100:+.2f}%")


def large_chase():
    """T4b: 거래대금 상위 300 안에서 급등 다음날 시가 진입의 코스피 대비 초과수익(날짜별 묶음)."""
    print("\n[T4b 대형·중형주 급등 다음날 시가 진입, 코스피 대비]")
    for jump in (0.08, 0.15):
        rows = collections.defaultdict(lambda: collections.defaultdict(list))
        cnt = 0
        for t in range(260, T - 22):
            u = UNIV[t].copy()
            tv = np.where(u, TV20[t - 1], -np.inf)  # 급등 당일 거래대금이 순위를 부풀리지 않게 전날까지
            top = np.zeros(N, bool)
            top[np.argsort(-tv)[:SEED_SMALL_RANK]] = True
            ok = u & top & (C[t] / Cf[t - 1] - 1 >= jump) & (V[t] >= 5 * V20[t - 1]) & (C[t] >= 0.95 * H[t])
            for j in np.where(ok)[0]:
                e = t + 1
                if np.isnan(O[e, j]):
                    continue
                cnt += 1
                for h in (1, 5, 20):
                    x = e + h - 1
                    rows[h][dates[e]].append(Cf[x, j] / O[e, j] - 1 - (KI[x] / KI[e - 1] - 1))
        yrs = (T - 282) / 250
        print(f"  +{int(jump*100)}% · 사건 {cnt}건 (연 {cnt/yrs:.0f}건)")
        for h in (1, 5, 20):
            ks = sorted(rows[h])
            m = np.array([np.mean(rows[h][k]) for k in ks])
            a = np.array([k < "20220101" for k in ks])
            print(f"    {h:>2}일: 초과 평균 {m.mean()*100:+.2f}% 중앙 {np.median(m)*100:+.2f}% t {nw_t(m, 5):5.2f} | "
                  f"전반 {m[a].mean()*100:+.2f}% ({a.sum()}일) 후반 {m[~a].mean()*100:+.2f}% ({(~a).sum()}일)")


def main():
    if "--diagnose" in sys.argv:
        return diagnose()
    if "--large" in sys.argv:
        return large_chase()
    start_px = 260
    start_fin = bisect.bisect_left(dates, "20170601")
    results = []
    print("\n[T1 소형주 단기 반전]")
    for n, step in ((20, 5), (10, 5), (30, 5), (20, 3), (20, 10)):
        nav, i0, i1, cap = run_rebal(sel_reversal, start_px, step, n)
        results.append(judge(f"T1 N{n} 보유{step}일", nav, i0, i1, cap))
    print("\n[T2 소형주 퀄리티]")
    for n, step in ((20, 21), (10, 21), (30, 21), (20, 63)):
        nav, i0, i1, cap = run_rebal(sel_quality, start_fin, step, n)
        results.append(judge(f"T2 N{n} 교체{step}일", nav, i0, i1, cap))
    print("\n[T3 소형주 12-1 모멘텀]")
    for n, step in ((20, 21), (10, 21), (30, 21), (20, 63)):
        nav, i0, i1, cap = run_rebal(sel_momentum, start_px, step, n)
        results.append(judge(f"T3 N{n} 교체{step}일", nav, i0, i1, cap))
    print("\n[T4 거래량 급증 장대양봉 다음날 시가]")
    for jump, vm, hold in ((0.15, 5, 1), (0.15, 5, 5), (0.15, 5, 3), (0.15, 5, 10), (0.10, 5, 5), (0.20, 5, 5)):
        ev = t4_events(jump, vm)
        nav, i0, i1, trades, cap = run_t4(ev, hold)
        tr = np.array([x[1] for x in trades])
        res = judge(f"T4 +{int(jump*100)}% 보유{hold}일 (사건 {len(ev)})", nav, i0, i1, cap)
        print(f"      거래 {len(tr)}건 · 거래당 순수익 평균 {tr.mean()*100:+.2f}% 중앙 {np.median(tr)*100:+.2f}% "
              f"승률 {(tr>0).mean()*100:.0f}%")
        results.append(res)

    print("\n[전업 판정: 월 300만원 인출, 10년, 12개월 블록 부트스트랩]")
    for r in results:
        line = f"  {r['name']:<34}"
        for seed in (1e8, 2e8, 3e8):
            p, med = ruin(r["series"], seed)
            pb, medb = ruin(r["bseries"], seed)
            line += f" | {int(seed/1e8)}억 파산 {p*100:4.1f}% (지수 {pb*100:4.1f}%) 끝 중앙 {med/1e8:5.2f}억 (지수 {medb/1e8:4.2f})"
        print(line, flush=True)


if __name__ == "__main__":
    main()
