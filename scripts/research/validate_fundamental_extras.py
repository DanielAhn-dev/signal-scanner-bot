# -*- coding: utf-8 -*-
"""
H78 (2026-10-27): H74(연속 영업적자)를 뺀 나머지에서 재무 악화 신호 3종이 이후 60거래일 −20%↓ 손실을 더 설명하는가.
 a) 4분기 연속 매출 역성장  b) 유동비율 < 100%  c) 영업이익 4분기 합 > 0 이면서 순이익 4분기 합 < 0
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §27에 결과 보기 전 고정. 자료·유니버스는 H74·H75와 같다(금융·지주 제외, H74 켜짐 제외).

실행: python scripts/research/validate_fundamental_extras.py > .research-cache/fundamental_extras_out.txt
"""
import datetime as dt
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_operating_loss_avoid as base  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

T, N, Cf, TV20, first, last, dates, codes = base.T, base.N, base.Cf, base.TV20, base.first, base.last, base.dates, base.codes
HZ, BIG, MIN_FLAG, START, CACHE = base.HZ, base.BIG, base.MIN_FLAG, base.START, base.CACHE
QN = base.rv.QN
names = base.names
FIN_WORDS = ("은행", "금융", "증권", "보험", "카드", "캐피탈", "지주")
is_fin = {c: any(w in names.get(c, "") for w in FIN_WORDS) for c in codes}
T_CRIT = 2.4

# ── 분기 자료 적재: 매출액(없으면 영업수익), 유동자산, 유동부채
raw = defaultdict(dict)
for f in glob.glob(f"{CACHE}/fin/*.json"):
    for r in json.load(open(f, encoding="utf-8")):
        nm = str(r.get("account_nm", "")).replace(" ", "")
        if nm not in ("매출액", "영업수익", "유동자산", "유동부채"):
            continue
        try:
            v = float(str(r.get("thstrm_amount")).replace(",", ""))
        except Exception:
            continue
        k = (r["stock_code"], int(r["bsns_year"]), QN[r["reprt_code"]])
        e = raw[k].setdefault(r["fs_div"], {"rcept": r["rcept_no"][:8]})
        e.setdefault(nm, v)

REV = defaultdict(dict)   # code -> {(y,q): (rcept, rev_q)}
CUR = defaultdict(dict)   # code -> {(y,q): (rcept, ca, cl)}
rev_raw = defaultdict(dict)
for (code, y, q), v in raw.items():
    e = v.get("CFS") or v.get("OFS")
    if not e:
        continue
    rc = e["rcept"]
    lag = (dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:])) - base.qend_date(y, q)).days
    if not (0 < lag <= (110 if q == 4 else 75)):
        continue
    rev = e.get("매출액", e.get("영업수익"))
    if rev is not None:
        rev_raw[code][(y, q)] = (rc, rev, "CFS" if "CFS" in v else "OFS")
    if "유동자산" in e and "유동부채" in e:
        CUR[code][(y, q)] = (rc, e["유동자산"], e["유동부채"])
for code, d in rev_raw.items():
    for (y, q), (rc, rev, fs) in d.items():
        if q < 4:
            REV[code][(y, q)] = (rc, rev)
        else:
            qs = [d.get((y, i)) for i in (1, 2, 3)]
            if all(x and x[2] == fs for x in qs):
                REV[code][(y, q)] = (rc, rev - sum(x[1] for x in qs))

# 영업이익·순이익(분기) — H74와 같은 파서
NI = defaultdict(dict)
OP = defaultdict(dict)
for code, L in base.fin.items():
    for r in L:
        rc = r["rcept"]
        lag = (dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:])) - base.qend_date(r["y"], r["q"])).days
        if not (0 < lag <= (110 if r["q"] == 4 else 75)):
            continue
        if r.get("ni_q") is not None:
            NI[code][(r["y"], r["q"])] = (rc, r["ni_q"])
        if r.get("op_q") is not None:
            OP[code][(r["y"], r["q"])] = (rc, r["op_q"])


def prev(y, q):
    return (y, q - 1) if q > 1 else (y - 1, 4)


def latest(mapping, d):
    known = [(k, x) for k, x in mapping.items() if x[0] <= d]
    if not known:
        return None
    k = max(known, key=lambda t: t[0])[0]
    if (dt.date(int(d[:4]), int(d[4:6]), int(d[6:])) - base.qend_date(*k)).days > 200:
        return None
    return k


def chain(k, n=4):
    out = [k]
    for _ in range(n - 1):
        out.append(prev(*out[-1]))
    return out


def sig_rev_decline(code, d):
    m = REV.get(code, {})
    k = latest(m, d)
    if k is None:
        return None
    for kk in chain(k):
        yo = (kk[0] - 1, kk[1])
        if kk not in m or yo not in m or m[kk][0] > d or m[yo][0] > d or m[yo][1] <= 0:
            return None
    return all(m[kk][1] < m[(kk[0] - 1, kk[1])][1] for kk in chain(k))


def sig_current_ratio(code, d):
    m = CUR.get(code, {})
    k = latest(m, d)
    if k is None:
        return None
    ca, cl = m[k][1], m[k][2]
    return None if cl <= 0 else ca / cl < 1.0


def sig_earnings_quality(code, d):
    k = latest(OP.get(code, {}), d)
    if k is None:
        return None
    op, ni = OP[code], NI.get(code, {})
    ch = chain(k)
    if any(kk not in op or kk not in ni or op[kk][0] > d or ni[kk][0] > d for kk in ch):
        return None
    return sum(op[kk][1] for kk in ch) > 0 and sum(ni[kk][1] for kk in ch) < 0


FEATURES = (("a 4분기 연속 매출 역성장", sig_rev_decline), ("b 유동비율 100% 미만", sig_current_ratio), ("c 영업이익 흑자·순이익 적자(4분기 합)", sig_earnings_quality))


def study(label, fn):
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    rows, vc = [], []
    for i in me:
        e = i + 1
        if e + HZ >= T or i < 61:
            continue
        el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and not np.isnan(Cf[i, j]) and not np.isnan(Cf[e, j])
              and TV20[i, j] >= 1e9 and not is_fin[codes[j]]]
        el = sorted(el, key=lambda j: -TV20[i, j])[:300]
        rec = []
        for j in el:
            if base.loss4(codes[j], dates[i]) is not False:      # H74 켜짐·판정 불가 제외
                continue
            s = fn(codes[j], dates[i])
            if s is None:
                continue
            seg = Cf[i - 60:i + 1, j]
            vol = np.std(np.diff(np.log(seg))) if not np.isnan(seg).any() else np.nan
            rec.append((bool(s), vol, Cf[e + HZ, j] / Cf[e, j] - 1 <= BIG))
        flag = np.array([x[0] for x in rec], bool)
        if len(rec) < 40 or flag.sum() < MIN_FLAG or (~flag).sum() < MIN_FLAG:
            continue
        big = np.array([x[2] for x in rec])
        rows.append((dates[i], int(flag.sum()), big[flag].mean(), big[~flag].mean(), big[flag].mean() - big[~flag].mean()))
        vol = np.array([x[1] for x in rec])
        ok = np.isfinite(vol)
        if ok.sum() >= 40 and (flag & ok).sum() >= 2:
            g = np.digitize(vol[ok], np.quantile(vol[ok], [1 / 3, 2 / 3]))
            fo, bo = flag[ok], big[ok]
            num = den = 0.0
            for k in range(3):
                on, off = fo & (g == k), (~fo) & (g == k)
                if on.sum() >= 2 and off.sum() >= 2:
                    num += on.sum() * (bo[on].mean() - bo[off].mean())
                    den += on.sum()
            if den:
                vc.append(num / den)
    print(f"\n===== H78{label} =====")
    if len(rows) == 0:
        print("포함 월 0개 → 보류")
        return "보류"
    d = np.array([r[4] for r in rows])
    h = len(d) // 2
    t = base.nw_t(d)
    v = np.array(vc)
    tv = base.nw_t(v) if len(v) > 5 else float("nan")
    print(f"포함 월 {len(rows)}개 · 월평균 켜짐 {np.mean([r[1] for r in rows]):.1f}종목")
    print(f"−20% 이하 비율 켜짐 {np.mean([r[2] for r in rows]):.1%} vs 꺼짐 {np.mean([r[3] for r in rows]):.1%} · 월별 차이 평균 {d.mean():+.2%}p "
          f"(NW t {t:+.2f}) · 양(+)인 달 {np.mean(d > 0):.0%} · 전반 {d[:h].mean():+.2%}p / 후반 {d[h:].mean():+.2%}p")
    print(f"변동성 3분위 통제 후 {v.mean():+.2%}p (NW t {tv:+.2f}, 월 {len(v)}개)")
    if len(rows) < 36:
        res = "보류 (포함 월 < 36)"
    elif d.mean() <= 0:
        res = "기각 (평균 차이 ≤ 0)"
    elif t >= T_CRIT and d[:h].mean() > 0 and d[h:].mean() > 0 and v.mean() > 0 and tv >= T_CRIT:
        res = "성립"
    else:
        res = "미달 (일부만 충족)"
    print(f"판정: {res}")
    return res


def main():
    print("H78 — H74 켜짐 종목 제외, 금융·지주 제외, 거래대금 상위 300, 보유 60거래일, 큰 손실 ≤ −20%, 성립 기준 t ≥ 2.4(가족 3개)")
    out = [study(lab, fn) for lab, fn in FEATURES]
    print("\n===== 요약 =====")
    for (lab, _), r in zip(FEATURES, out):
        print(f"  {lab}: {r}")


if __name__ == "__main__":
    main()
