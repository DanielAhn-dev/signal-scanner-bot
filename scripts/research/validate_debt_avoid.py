# -*- coding: utf-8 -*-
"""
H75 (2026-10-27): 부채비율 상위 10% 종목(금융·지주 제외, 거래대금 상위 300)은 이후 60거래일 −20% 이하 손실이 더 잦은가 — 변동성을 맞춘 뒤에도.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §23에 결과 보기 전 고정. H74(validate_operating_loss_avoid.py)의 자료·정의를 그대로 쓴다.

실행: python scripts/research/validate_debt_avoid.py > .research-cache/debt_avoid_out.txt
"""
import datetime as dt
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_operating_loss_avoid as base  # noqa: E402  (자료 적재·loss4 재사용)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

T, N, Cf, TV20, first, last, dates, codes = base.T, base.N, base.Cf, base.TV20, base.first, base.last, base.dates, base.codes
HZ, BIG, MIN_FLAG, START = base.HZ, base.BIG, base.MIN_FLAG, base.START
CACHE = base.CACHE
QN = base.rv.QN
FIN_WORDS = ("은행", "금융", "증권", "보험", "카드", "캐피탈", "지주")
names = base.names

# ── 분기별 부채총계·자본총계 (공시일 포함)
raw = defaultdict(dict)
for f in glob.glob(f"{CACHE}/fin/*.json"):
    for r in json.load(open(f, encoding="utf-8")):
        nm = str(r.get("account_nm", "")).replace(" ", "")
        if nm not in ("부채총계", "자본총계"):
            continue
        try:
            v = float(str(r.get("thstrm_amount")).replace(",", ""))
        except Exception:
            continue
        k = (r["stock_code"], int(r["bsns_year"]), QN[r["reprt_code"]])
        e = raw[k].setdefault(r["fs_div"], {"rcept": r["rcept_no"][:8]})
        e.setdefault(nm, v)
BS = defaultdict(dict)   # code -> {(y,q): (rcept, debt, eq)}
for (code, y, q), v in raw.items():
    e = v.get("CFS") or v.get("OFS")
    if e and "부채총계" in e and "자본총계" in e:
        rc = e["rcept"]
        lag = (dt.date(int(rc[:4]), int(rc[4:6]), int(rc[6:])) - base.qend_date(y, q)).days
        if 0 < lag <= (110 if q == 4 else 75):
            BS[code][(y, q)] = (rc, e["부채총계"], e["자본총계"])


def debt_ratio(code, d):
    known = [(k, x) for k, x in BS.get(code, {}).items() if x[0] <= d]
    if not known:
        return None
    k, x = max(known, key=lambda t: t[0])
    if (dt.date(int(d[:4]), int(d[4:6]), int(d[6:])) - base.qend_date(*k)).days > 200:
        return None
    debt, eq = x[1], x[2]
    return float("inf") if eq <= 0 else debt / eq


is_fin = {c: any(w in names.get(c, "") for w in FIN_WORDS) for c in codes}


def main():
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= START]
    rows, vc = [], []
    overlap = []
    for i in me:
        e = i + 1
        if e + HZ >= T or i < 61:
            continue
        el = [j for j in range(N) if first[j] + 250 <= i <= last[j] and not np.isnan(Cf[i, j]) and not np.isnan(Cf[e, j])
              and TV20[i, j] >= 1e9 and not is_fin[codes[j]]]
        el = sorted(el, key=lambda j: -TV20[i, j])[:300]
        rec = []
        for j in el:
            r = debt_ratio(codes[j], dates[i])
            if r is None:
                continue
            seg = Cf[i - 60:i + 1, j]
            vol = np.std(np.diff(np.log(seg))) if not np.isnan(seg).any() else np.nan
            rec.append((r, vol, Cf[e + HZ, j] / Cf[e, j] - 1 <= BIG, base.loss4(codes[j], dates[i])))
        if len(rec) < 60:
            continue
        ratio = np.array([x[0] for x in rec])
        cut = np.quantile(ratio[np.isfinite(ratio)], 0.9) if np.isfinite(ratio).any() else np.inf
        flag = ratio >= cut
        big = np.array([x[2] for x in rec])
        if flag.sum() < MIN_FLAG or (~flag).sum() < MIN_FLAG:
            continue
        rows.append((dates[i], int(flag.sum()), big[flag].mean(), big[~flag].mean(), big[flag].mean() - big[~flag].mean()))
        vol = np.array([x[1] for x in rec])
        okv = np.isfinite(vol)
        if okv.sum() >= 60 and (flag & okv).sum() >= 2:
            g = np.digitize(vol[okv], np.quantile(vol[okv], [1 / 3, 2 / 3]))
            fo, bo = flag[okv], big[okv]
            num = den = 0.0
            for k in range(3):
                on, off = fo & (g == k), (~fo) & (g == k)
                if on.sum() >= 2 and off.sum() >= 2:
                    num += on.sum() * (bo[on].mean() - bo[off].mean())
                    den += on.sum()
            if den:
                vc.append(num / den)
        l4 = [x[3] for x, f in zip(rec, flag) if f and x[3] is not None]
        if l4:
            overlap.append(np.mean(l4))
    d = np.array([r[4] for r in rows])
    h = len(d) // 2
    print("H75 — 부채비율 상위 10%(금융·지주 제외, 거래대금 상위 300), 진입 신호 다음 거래일 종가, 보유 60거래일, 큰 손실 ≤ −20%")
    print(f"포함 월 {len(rows)}개 ({rows[0][0]}~{rows[-1][0]}) · 월평균 켜짐 {np.mean([r[1] for r in rows]):.1f}종목")
    t = base.nw_t(d)
    print(f"−20% 이하 비율 켜짐 {np.mean([r[2] for r in rows]):.1%} vs 꺼짐 {np.mean([r[3] for r in rows]):.1%} · 월별 차이 평균 {d.mean():+.2%}p "
          f"(NW t {t:+.2f}) · 양(+)인 달 {np.mean(d > 0):.0%} · 전반 {d[:h].mean():+.2%}p / 후반 {d[h:].mean():+.2%}p")
    v = np.array(vc)
    tv = base.nw_t(v) if len(v) > 5 else float("nan")
    print(f"변동성 3분위 통제 후 차이 월평균 {v.mean():+.2%}p (NW t {tv:+.2f}, 월 {len(v)}개, 양(+)인 달 {np.mean(v > 0):.0%})")
    print(f"[기술] 켜짐 종목 중 4분기 연속 영업적자(H74)와 겹치는 비율 평균 {np.mean(overlap):.1%}")
    print("\n===== 판정 =====")
    if len(rows) < 36:
        res = f"보류 (포함 월 {len(rows)}개 < 36)"
    elif d.mean() <= 0:
        res = "기각 (월별 차이 평균 ≤ 0)"
    elif t >= 2 and d[:h].mean() > 0 and d[h:].mean() > 0 and v.mean() > 0 and tv >= 2:
        res = "성립"
    else:
        res = "미달 (일부만 충족)"
    print(res)


if __name__ == "__main__":
    main()
