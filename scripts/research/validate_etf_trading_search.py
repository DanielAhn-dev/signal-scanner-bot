# -*- coding: utf-8 -*-
"""
월 300만원 목표 단기 매매 탐색 S1~S6 (2026-10-06). 가설·판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

국내 주식형 ETF(매도세 없음·차익 비과세)로 비용을 줄인 단기 매매 계열을 넓게 시험한다.
과최적화 방지: 2021-12까지(표본 안)에서 계열마다 비용 후 샤프 1등 하나만 고르고, 2022-01~(표본 밖)은 고른 것만 한 번 본다.

계열
  S1 밤/낮 분리: 종가 매수→다음날 시가 매도(밤) / 시가 매수→종가 매도(낮)
  S2 추세 필터 레버리지: 기초지수 ETF가 SMA n 위면 레버리지, 아래면 통안채(롱숏 변형은 인버스)
  S3 하락 다음날 반등: 기초 ETF 하루 −k% 이하 & 200일선 위 → 레버리지 h일 보유
  S4 달력: 월말~월초 3일 / 연휴 전날 / 옵션만기일
  S5 업종 ETF 모멘텀 순환: 월말에 L일 수익 상위 k개(절대 모멘텀 필터 변형)
  S6 변동성 목표 레버리지: 레버리지 비중 = 목표변동성 / (2 × 기초 20일 변동성), 상한 1, 나머지 통안채
비용: 수수료 0.015%×2 + 한쪽 슬리피지(대형 지수류 0.03%, 업종 0.10%), 세금 0.
데이터: .research-cache/trading_etfs (fetch_trading_etfs.py), 코스피 1996~ (.research-cache/kospi.json)

실행: python scripts/research/validate_etf_trading_search.py
"""
import json, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
D = ".research-cache/trading_etfs"
COMM = 0.00015
LIQUID = {"069500", "122630", "114800", "252670", "229200", "233740", "251340", "157450"}
SECTORS = ["091160", "091170", "102970", "117700", "117460", "140700", "091180", "244580", "117680", "139260"]
IS_END = "20211231"
CASH_FALLBACK = 0.03 / 250

raw = {}
import glob, os
for f in glob.glob(f"{D}/px_*.json"):
    raw[os.path.basename(f)[3:9]] = json.load(open(f, encoding="utf-8"))
dates = sorted({r[0] for r in raw["069500"]})
di = {d: i for i, d in enumerate(dates)}
T = len(dates)
O, H, L, C = {}, {}, {}, {}
for code, rows in raw.items():
    o, h, l, c = (np.full(T, np.nan) for _ in range(4))
    for r in rows:
        if r[0] in di:
            i = di[r[0]]
            o[i], h[i], l[i], c[i] = r[1], r[2], r[3], r[4]
    o[o <= 0] = np.nan
    O[code], H[code], L[code], C[code] = o, h, l, c


def ret(code):
    c = C[code]
    r = np.full(T, np.nan)
    r[1:] = c[1:] / c[:-1] - 1
    return r


R = {k: ret(k) for k in C}
CASH = np.where(np.isnan(R["157450"]), CASH_FALLBACK, R["157450"])


def slip(code):
    return 0.0003 if code in LIQUID else 0.0010


def sma(x, n):
    out = np.full(T, np.nan)
    v = np.where(np.isnan(x), 0, x)
    cs = np.cumsum(v)
    cnt = np.cumsum(~np.isnan(x))
    for i in range(n - 1, T):
        k = cnt[i] - (cnt[i - n] if i >= n else 0)
        if k == n:
            out[i] = (cs[i] - (cs[i - n] if i >= n else 0)) / n
    return out


# ── 공통 엔진: 종가 t에 정한 비중 W[code][t]가 t→t+1 수익에 적용 ─────────────

def run_weights(W):
    """W: {code: 비중 배열(종가 t 결정)}. 남는 비중은 통안채. → 일별 순수익 배열(t+1 위치)"""
    codes = list(W)
    tot = sum(np.nan_to_num(W[c]) for c in codes)
    out = np.full(T, np.nan)
    prev = {c: 0.0 for c in codes}
    for t in range(T - 1):
        r = 0.0
        cost = 0.0
        ok = True
        for c in codes:
            w = W[c][t]
            if np.isnan(w):
                w = 0.0
            if w and np.isnan(R[c][t + 1]):
                ok = False
            cost += abs(w - prev[c]) * (COMM + slip(c))
            r += w * np.nan_to_num(R[c][t + 1])
            prev[c] = w
        if not ok:
            continue
        r += max(0.0, 1 - tot[t]) * CASH[t + 1]
        out[t + 1] = r - cost
    return out


def stats(r, lo, hi):
    m = np.array([lo <= d <= hi for d in dates]) & ~np.isnan(r)
    x = r[m]
    if len(x) < 120:
        return None
    nav = np.cumprod(1 + x)
    yrs = len(x) / 250
    cagr = nav[-1] ** (1 / yrs) - 1
    sh = x.mean() / x.std() * np.sqrt(250) if x.std() > 0 else 0
    mdd = np.min(nav / np.maximum.accumulate(nav) - 1)
    first = [d for d, k in zip(dates, m) if k][0]
    return dict(cagr=cagr, sharpe=sh, mdd=mdd, start=first, days=len(x))


def fmt(s):
    if not s:
        return "데이터 부족"
    return f"{s['start'][:6]}~ 연 {s['cagr']*100:6.1f}% 샤프 {s['sharpe']:5.2f} MDD {s['mdd']*100:5.0f}%"


# ── 계열별 설정 ─────────────────────────────────────────────

def s1(code, mode):
    """밤: C[t]→O[t+1], 낮: O[t]→C[t]. 매일 왕복, 나머지 시간 현금 이자는 무시."""
    o, c = O[code], C[code]
    out = np.full(T, np.nan)
    rt = 2 * (COMM + slip(code))
    for t in range(1, T):
        if mode == "night":
            v = o[t] / c[t - 1] - 1
        else:
            v = c[t] / o[t] - 1
        if not np.isnan(v):
            out[t] = v - rt
    return out


def s2(lev, base, n, short=None):
    above = C[base] > sma(C[base], n)
    valid = ~np.isnan(sma(C[base], n))
    W = {lev: np.where(valid & above, 1.0, 0.0)}
    if short:
        W[short] = np.where(valid & ~above, 1.0, 0.0)
    return run_weights(W)


def s3(lev, base, k, h):
    rb = R[base]
    up = C[base] > sma(C[base], 200)
    w = np.zeros(T)
    for t in range(T):
        if rb[t] <= -k and up[t]:
            w[t:t + h] = 1.0
    return run_weights({lev: w})


def month_end_flags():
    me = np.zeros(T, bool)
    for i in range(T - 1):
        me[i] = dates[i][:6] != dates[i + 1][:6]
    return me


ME = month_end_flags()


def s4(kind, lev="122630"):
    w = np.zeros(T)
    if kind == "tom":  # 월 마지막 거래일 종가 매수 → 다음 달 3번째 거래일 종가 매도
        for i in np.where(ME)[0]:
            w[i:i + 3] = 1.0
    elif kind == "preholiday":  # 다음 거래일까지 달력 4일 이상 → 그 전날 종가 매수, 다음 거래일 종가 매도
        import datetime as dt
        for i in range(T - 1):
            a = dt.date(int(dates[i][:4]), int(dates[i][4:6]), int(dates[i][6:]))
            b = dt.date(int(dates[i + 1][:4]), int(dates[i + 1][4:6]), int(dates[i + 1][6:]))
            if (b - a).days >= 4:
                w[i] = 1.0
    elif kind == "expiry":  # 둘째 목요일(옵션만기) 전날 종가 → 만기일 종가
        import datetime as dt
        for i in range(T - 1):
            b = dt.date(int(dates[i + 1][:4]), int(dates[i + 1][4:6]), int(dates[i + 1][6:]))
            if b.weekday() == 3 and 8 <= b.day <= 14:
                w[i] = 1.0
    return run_weights({lev: w})


def s5(lb, k, absf):
    W = {c: np.zeros(T) for c in SECTORS}
    cur = []
    for t in range(T):
        if ME[t] and t >= lb:
            mom = []
            for c in SECTORS:
                a, b = C[c][t - lb], C[c][t]
                if not (np.isnan(a) or np.isnan(b)):
                    mom.append((b / a - 1, c))
            mom.sort(reverse=True)
            cur = [c for m, c in mom[:k] if (m > 0 or not absf)]
        for c in cur:
            W[c][t] = 1.0 / k
    return run_weights(W)


def s6(tv, lev="122630", base="069500"):
    rb = R[base]
    w = np.zeros(T)
    last = 0.0
    for t in range(21, T):
        x = rb[t - 19:t + 1]
        if np.isnan(x).any():
            continue
        rv = x.std() * np.sqrt(250)
        target = min(1.0, tv / (2 * rv)) if rv > 0 else 0
        if abs(target - last) > 0.1:
            last = target
        w[t] = last
    return run_weights({lev: w})


# ── 코스피 1996~ 합성 2배 (S2·S6 내구성) ────────────────────────────

def synth_trend(n, short=False):
    k = json.load(open(".research-cache/kospi.json"))
    kd = [d for d, _ in k]
    kc = np.array([v for _, v in k], float)
    r = np.r_[np.nan, kc[1:] / kc[:-1] - 1]
    cash, fee = 0.03 / 250, 0.0064 / 250
    lev = 2 * r - cash - fee
    inv = -2 * r + cash - fee
    m = np.full(len(kc), np.nan)
    cs = np.cumsum(kc)
    m[n - 1:] = (cs[n - 1:] - np.r_[0, cs[:-n]]) / n
    sig = kc > m
    out = np.full(len(kc), np.nan)
    prev = 0
    for t in range(n, len(kc) - 1):
        pos = 1 if sig[t] else (-1 if short else 0)
        g = lev[t + 1] if pos == 1 else (inv[t + 1] if pos == -1 else cash)
        out[t + 1] = g - (abs(pos - prev) * (COMM + 0.0003))
        prev = pos
    bh = 2 * r - cash - fee
    return kd, out, r, bh


def synth_report(n, short):
    kd, out, r1, bh = synth_trend(n, short)
    print(f"\n  [합성 코스피 2배, SMA{n}{' 롱숏' if short else ''}] 구간별 (전략 / 코스피 1배 보유)")
    for lo, hi, nm in (("19970101", "19981231", "1997~98 외환위기"), ("20000101", "20021231", "2000~02 닷컴"),
                       ("20070101", "20091231", "2007~09 금융위기"), ("19961211", "20261231", "전체 1996~2026")):
        idx = [i for i, d in enumerate(kd) if lo <= d <= hi]
        x = out[idx]; x = x[~np.isnan(x)]
        y = r1[idx]; y = y[~np.isnan(y)]
        nav, navb = np.cumprod(1 + x), np.cumprod(1 + y)
        yrs = len(x) / 250
        print(f"    {nm:<16} 전략 연 {(nav[-1]**(1/yrs)-1)*100:6.1f}% MDD {np.min(nav/np.maximum.accumulate(nav)-1)*100:5.0f}% "
              f"| 1배 보유 연 {(navb[-1]**(1/yrs)-1)*100:6.1f}% MDD {np.min(navb/np.maximum.accumulate(navb)-1)*100:5.0f}%")
    idx = [i for i, d in enumerate(kd) if d >= "19961211"]
    x = out[idx]; x = x[~np.isnan(x)]
    nav = np.cumprod(1 + x)
    y = r1[idx]; y = y[~np.isnan(y)]
    navb = np.cumprod(1 + y)
    yrs = len(x) / 250
    return (nav[-1] ** (1 / yrs) - 1, np.min(nav / np.maximum.accumulate(nav) - 1),
            navb[-1] ** (1 / len(y) * 250) - 1)


# ── 필요 투자금 ─────────────────────────────────────────────

def monthly(r, lo, hi):
    out, cur, acc = [], None, 1.0
    for d, x in zip(dates, r):
        if not (lo <= d <= hi) or np.isnan(x):
            continue
        if cur and d[:6] != cur:
            out.append(acc - 1); acc = 1.0
        cur = d[:6]; acc *= 1 + x
    out.append(acc - 1)
    return np.array(out[1:-1])


def ruin(series, seed, wd=3e6, years=10, sims=4000, block=12):
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


def required_capital(series):
    for seed in np.arange(1e8, 40.01e8, 0.5e8):
        p, med = ruin(series, seed)
        if p < 0.10:
            return seed, p, med
    return None, None, None


def main():
    fam = {}
    fam["S1 밤/낮"] = [(f"{c} {m}", (lambda c=c, m=m: s1(c, m))) for c in ("069500", "122630", "233740") for m in ("night", "day")]
    fam["S2 추세 레버리지"] = (
        [(f"코스피 레버리지 SMA{n}", (lambda n=n: s2("122630", "069500", n))) for n in (20, 50, 100, 200)]
        + [(f"코스피 레버리지 SMA{n} 롱숏", (lambda n=n: s2("122630", "069500", n, "252670"))) for n in (20, 50, 100, 200)]
        + [(f"코스닥 레버리지 SMA{n}", (lambda n=n: s2("233740", "229200", n))) for n in (20, 50, 100, 200)]
        + [(f"코스닥 레버리지 SMA{n} 롱숏", (lambda n=n: s2("233740", "229200", n, "251340"))) for n in (20, 50, 100, 200)])
    fam["S3 하락 반등"] = [(f"{nm} -{k*100:.1f}% {h}일", (lambda lv=lv, b=b, k=k, h=h: s3(lv, b, k, h)))
                          for nm, lv, b in (("코스피", "122630", "069500"), ("코스닥", "233740", "229200"))
                          for k in (0.01, 0.015, 0.02) for h in (1, 3, 5)]
    fam["S4 달력"] = [(k, (lambda k=k: s4(k))) for k in ("tom", "preholiday", "expiry")]
    fam["S5 업종 순환"] = [(f"L{lb} 상위{k}{' 절대' if a else ''}", (lambda lb=lb, k=k, a=a: s5(lb, k, a)))
                          for lb in (21, 63, 126) for k in (1, 2) for a in (False, True)]
    fam["S6 변동성 목표"] = [(f"목표 {int(tv*100)}%", (lambda tv=tv: s6(tv))) for tv in (0.15, 0.20, 0.25, 0.30)]

    bench = run_weights({"069500": np.ones(T)})
    print("기준 KODEX 200 보유")
    print(f"  표본 안 {fmt(stats(bench, '20100101', IS_END))}")
    print(f"  표본 밖 {fmt(stats(bench, '20220101', '20261231'))}")

    chosen = {}
    print("\n=== 표본 안(~2021-12) 전체 설정, 계열별 샤프 1등만 표본 밖으로 ===")
    cache = {}
    for f, cfgs in fam.items():
        print(f"\n[{f}]")
        best = None
        for name, fn in cfgs:
            r = fn()
            cache[(f, name)] = r
            s = stats(r, "20000101", IS_END)
            print(f"  {name:<28} {fmt(s)}")
            if s and (best is None or s["sharpe"] > best[1]["sharpe"]):
                best = (name, s)
        chosen[f] = best

    print("\n=== 표본 밖(2022-01~) — 고른 설정만, 한 번 ===")
    bo = stats(bench, "20220101", "20261231")
    passed = []
    for f, (name, si) in chosen.items():
        r = cache[(f, name)]
        so = stats(r, "20220101", "20261231")
        c1 = so["cagr"] > bo["cagr"]
        c2 = so["sharpe"] >= 0.5 * si["sharpe"]
        c3 = so["mdd"] >= -0.45
        print(f"  {f:<12} {name:<26} 표본 안 {fmt(si)}")
        print(f"  {'':<12} {'':<26} 표본 밖 {fmt(so)} | ①{'O' if c1 else 'X'} ②{'O' if c2 else 'X'} ③{'O' if c3 else 'X'}")
        if c1 and c2 and c3:
            passed.append((f, name, r))

    print("\n=== ④ 추세·변동성 레버리지 내구성: 코스피 1996~ 합성 2배 ===")
    for f, (name, si) in chosen.items():
        if f.startswith("S2") and "코스피" in name:
            n = int(name.split("SMA")[1].split()[0])
            cg, mdd, b1 = synth_report(n, "롱숏" in name)
            print(f"    → 1996~2026 연 {cg*100:.1f}% MDD {mdd*100:.0f}% (코스피 1배 {b1*100:.1f}%) "
                  f"④ {'O' if (cg > b1 and mdd >= -0.45) else 'X'}")

    print("\n=== 월 300만원 인출 10년 파산 < 10% 필요 투자금 (표본 밖 월수익, 12개월 블록) ===")
    bm = monthly(bench, "20220101", "20261231")
    seed, p, med = required_capital(bm)
    print(f"  KODEX 200 보유: {seed/1e8 if seed else '40억 초과'}억 (파산 {p*100 if p is not None else float('nan'):.1f}%)")
    for f, name, r in passed:
        m = monthly(r, "20220101", "20261231")
        seed, p, med = required_capital(m)
        mi = monthly(r, "20000101", IS_END)
        seed2, p2, _ = required_capital(np.r_[mi, m])
        print(f"  {f} {name}: 표본 밖 기준 {seed/1e8 if seed else '40억 초과'}억 · 전체 기간 기준 {seed2/1e8 if seed2 else '40억 초과'}억")
    if not passed:
        print("  통과한 계열 없음")


if __name__ == "__main__":
    main()
