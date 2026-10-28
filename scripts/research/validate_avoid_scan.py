# -*- coding: utf-8 -*-
"""
H84 (2026-10-28): 아직 시험 안 한 회피 신호 5종이 이후 60거래일 −20%↓ 큰 손실을 더 잦게 하는가.
정의·판정 기준은 docs/hypothesis-ledger.md H84에 결과 보기 전 고정. 기준값은 아래 상수에서 바꾸지 않는다.

  a 최근 60거래일 내 희석 공시(유상증자·CB·BW)   b 감자 결정 공시   c 불성실공시법인 지정 공시
  d 최근 분기 영업이익이 전년 동기 대비 −50%↓(둘 다 흑자)   e 최근 20거래일 안 투매일(일 −7%↓·거래대금 20일 평균 3배↑)
틀은 H74(validate_operating_loss_avoid.py)와 같다: 월말 코호트, 신호 다음 거래일 종가 진입, 60거래일 보유,
H74 켜짐(4분기 연속 영업적자) 종목은 제외. 공시 후보는 공시 캐시가 있는 종목만 대상.

실행: python scripts/research/validate_avoid_scan.py > .research-cache/avoid_scan_out.txt
"""
import bisect
import glob
import json
import math
import os
import re
import sys
import datetime as dt
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_operating_loss_avoid as base  # noqa: E402  (패널·재무·loss4·nw_t 공유)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

T, N, C, TV, TV20, Cf = base.T, base.N, base.C, base.TV, base.TV20, base.Cf
first, last, dates, codes = base.first, base.last, base.dates, base.codes
HZ, BIG, START, CACHE, VQ = base.HZ, base.BIG, base.START, base.CACHE, base.VQ
nw_t = base.nw_t

MIN_FLAG, MIN_OFF, MIN_MONTHS = 5, 8, 36
MIN_DIFF = 0.03
ALPHA = 0.05
T_CTRL = 2.0
CANDS = ["a", "b", "c", "d", "e"]
LABEL = {"a": "희석 공시(60일 내)", "b": "감자 결정 공시(60일 내)", "c": "불성실공시법인 지정(60일 내)",
         "d": "영업이익 전년 동기 −50%↓", "e": "투매일(20일 내)"}

# validate_disclosure_events.py와 같은 정의 (그 파일은 다른 가격 패널을 만들기 때문에 import하지 않고 복사)
PAT = {
    "a": r"유상증자결정|전환사채권발행결정|신주인수권부사채권발행결정",
    "b": r"^주요사항보고서\(감자결정\)$",
    "c": r"불성실공시법인\s*지정",
}
EXCLUDE = re.compile(r"철회|취소|자회사|종속회사|미지정|해제|제외|해당되지|해당없음|미해당|신탁")
cidx = {c: j for j, c in enumerate(codes)}


def load_disclosures():
    ev = {k: defaultdict(list) for k in PAT}  # 후보 → 종목 j → [진입 t]
    have = np.zeros(N, bool)
    for f in glob.glob(f"{CACHE}/disclosures/*.json"):
        d = json.load(open(f, encoding="utf-8"))
        j = cidx.get(d.get("stock_code") or "")
        if j is None:
            continue
        have[j] = True
        for r in d["rows"]:
            name = re.sub(r"\s+", " ", re.sub(r"^\[[^\]]+\]", "", r[1] or "")).strip()
            if EXCLUDE.search(name):
                continue
            for k, pat in PAT.items():
                if re.search(pat, name.replace(" (", "(")):
                    t = bisect.bisect_right(dates, r[0])  # 접수일 다음 거래일
                    if t < T - 1:
                        ev[k][j].append(t)
    for k in ev:
        for j in ev[k]:
            ev[k][j].sort()
    return ev, have


EV, HAVE = load_disclosures()


def recent_event(k, j, i):
    L = EV[k].get(j)
    if not L:
        return False
    p = bisect.bisect_right(L, i)
    return p > 0 and L[p - 1] > i - 60


def op_drop(j, i):
    """d: 가장 최근 공시 분기 영업이익이 전년 동기 대비 −50%↓(둘 다 흑자). 판단 불가면 None"""
    v = VQ[codes[j]]
    d = dates[i]
    known = [(k, x) for k, x in v.items() if x[0] <= d]
    if not known:
        return None
    k = max(known, key=lambda t: t[0])[0]
    if (dt.date(int(d[:4]), int(d[4:6]), int(d[6:])) - base.qend_date(*k)).days > 200:
        return None
    pk = (k[0] - 1, k[1])
    if pk not in v or v[pk][0] > d:
        return None
    now, prev = v[k][1], v[pk][1]
    if now is None or prev is None or now <= 0 or prev <= 0:
        return False
    return now <= 0.5 * prev


def panic_day(j, i):
    """e: 최근 20거래일 안에 일 −7%↓ & 거래대금이 직전 20일 평균의 3배↑인 날"""
    for t in range(i - 19, i + 1):
        c0, c1, tv, ref = C[t - 1, j], C[t, j], TV[t, j], TV20[t - 1, j]
        if np.isfinite(c0) and np.isfinite(c1) and np.isfinite(tv) and np.isfinite(ref) and ref > 0 and c0 > 0:
            if c1 / c0 - 1 <= -0.07 and tv / ref >= 3:
                return True
    return False


def flag(k, j, i):
    if k in PAT:
        return recent_event(k, j, i) if HAVE[j] else None
    return op_drop(j, i) if k == "d" else panic_day(j, i)


def months():
    return [i for i in range(61, T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]


def eligible(i, e):
    el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and np.isfinite(Cf[i, j])
          and np.isfinite(Cf[e, j]) and TV20[i, j] >= 1e9]
    return sorted(el, key=lambda j: -TV20[i, j])


def study(k, lo, hi, excl21=False):
    rows, ctrl = [], []
    for i in months():
        e = i + 1
        if e + HZ >= T:
            continue
        el = eligible(i, e)[lo:hi]
        f, ret, vol = [], [], []
        for j in el:
            if base.loss4(codes[j], dates[i]):  # H74 켜짐 제외 (None=판단 불가는 유지)
                continue
            if excl21 and Cf[i, j] / Cf[i - 21, j] - 1 <= -0.15:  # 사후 점검용: 봇이 이미 피하는 '한 달 −15%' 제외
                continue
            x = flag(k, j, i)
            if x is None:
                continue
            seg = Cf[i - 60:i + 1, j]
            if np.isnan(seg).any():
                continue
            f.append(x)
            ret.append(Cf[e + HZ, j] / Cf[e, j] - 1)
            vol.append(np.std(np.diff(np.log(seg))))
        f, ret, vol = np.array(f, bool), np.array(ret), np.array(vol)
        if f.sum() < MIN_FLAG or (~f).sum() < MIN_OFF:
            continue
        big = ret <= BIG
        rows.append((dates[i], big[f].mean() - big[~f].mean(), big[f].mean(), big[~f].mean(), int(f.sum())))
        g = np.digitize(vol, np.quantile(vol, [1 / 3, 2 / 3]))
        num = den = 0.0
        for q in range(3):
            on, off = f & (g == q), (~f) & (g == q)
            if on.sum() >= 2 and off.sum() >= 2:
                num += on.sum() * (big[on].mean() - big[off].mean())
                den += on.sum()
        if den:
            ctrl.append(num / den)
    if not rows:
        return None
    d = np.array([r[1] for r in rows])
    h = len(d) // 2
    c = np.array(ctrl)
    return dict(n=len(d), first=rows[0][0], last=rows[-1][0], d=d.mean(), t=nw_t(d), h1=d[:h].mean(), h2=d[h:].mean(),
                on=np.mean([r[2] for r in rows]), off=np.mean([r[3] for r in rows]),
                nflag=np.mean([r[4] for r in rows]), cd=c.mean() if len(c) else np.nan,
                ct=nw_t(c) if len(c) > 10 else np.nan)


def pval(t):
    return math.erfc(abs(t) / math.sqrt(2))


def show(tag, k, r):
    if r is None:
        print(f"  [{tag}] {k} {LABEL[k]}: 포함 월 0개")
        return
    print(f"  [{tag}] {k} {LABEL[k]}: 월 {r['n']} · 월평균 켜짐 {r['nflag']:.1f}종목 · −20%↓ 켜짐 {r['on']:.1%} vs 꺼짐 {r['off']:.1%} · "
          f"차이 {r['d']:+.2%}p (t {r['t']:+.2f}) · 전반 {r['h1']:+.2%}/후반 {r['h2']:+.2%} · 변동성 통제 후 {r['cd']:+.2%}p (t {r['ct']:+.2f})")


def main():
    print(f"H84 — 보유 {HZ}거래일, 큰 손실 ≤ {BIG:.0%}, H74 켜짐 제외, 포함 월 기준 ≥ {MIN_MONTHS}")
    main_r, rep_r = {}, {}
    for k in CANDS:
        main_r[k] = study(k, 0, 300)
        rep_r[k] = study(k, 300, 600)
        show("상위300", k, main_r[k])
        show("301~600", k, rep_r[k])
    # Holm: 주 유니버스 t의 양측 p, 5후보
    ps = sorted((pval(main_r[k]["t"]) if main_r[k] else 1.0, k) for k in CANDS)
    holm = {}
    still = True
    for rank, (p, k) in enumerate(ps):
        still = still and p <= ALPHA / (len(CANDS) - rank)
        holm[k] = still
    print("\n===== 판정 =====")
    for k in CANDS:
        a, b = main_r[k], rep_r[k]
        if not a or a["n"] < MIN_MONTHS:
            print(f"{k} {LABEL[k]}: 보류 (포함 월 {a['n'] if a else 0} < {MIN_MONTHS})")
            continue
        ok = {
            "ⓑ 차이≥+3%p": a["d"] >= MIN_DIFF,
            "ⓒ 전·후반 양": a["h1"] > 0 and a["h2"] > 0,
            "ⓓ Holm": holm[k] and a["t"] > 0,
            "ⓔ 변동성 통제": a["cd"] > 0 and a["ct"] >= T_CTRL,
            "ⓕ 301~600 재현": bool(b) and b["d"] > 0 and b["t"] >= T_CTRL,
        }
        v = "성립" if all(ok.values()) else "기각/미달"
        print(f"{k} {LABEL[k]}: {v} — " + " · ".join(f"{n} {'O' if x else 'X'}" for n, x in ok.items()))
    print("\n===== 사후 점검(판정 아님): 한 달 −15% 종목(이미 회피 중)을 뺀 뒤에도 남는가, 상위 300 =====")
    for k in CANDS:
        if main_r[k] and main_r[k]["n"] >= MIN_MONTHS:
            show("한달−15% 제외", k, study(k, 0, 300, excl21=True))
    # 화면 표(build_disclosure_stats.py)용 요약 — 손으로 고치지 않는다
    summary = {"generated": dt.date.today().isoformat(), "horizon": HZ, "big": BIG, "cands": {}}
    for k in CANDS:
        r = main_r[k]
        if r:
            summary["cands"][k] = {n: (v if isinstance(v, (str, int)) else float(v)) for n, v in r.items()}
    json.dump(summary, open(f"{CACHE}/avoid_scan_summary.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
