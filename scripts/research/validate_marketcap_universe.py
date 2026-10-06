# -*- coding: utf-8 -*-
"""C25 후보군 정의: 시가총액 상위 N vs 거래대금 상위 300. 기준은 hypothesis-ledger C25에 결과 보기 전 고정.
시총 근사 = 수정주가 × DART 최근 보고 보통주 주식수(분할은 수정주가에 반영). 비용·체결은 validate_composite_portfolio와 동일."""
import sys, os, json, glob
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_composite_portfolio as cps
cp = cps.cp; ef = cps.ef; lc = ef.lc; vt = ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
T, N, codes = vt.T, vt.N, vt.codes
corps = {c[0]: c[2] for c in json.load(open(".research-cache/corps.json", encoding="utf-8"))}  # corp_code → ticker
cidx = {c: j for j, c in enumerate(codes)}
SH = np.full(N, np.nan)
for fn in glob.glob(".research-cache/shares/*.json"):
    d = json.load(open(fn))
    if not d.get("common"):
        continue
    cc = os.path.basename(fn).split("_")[0]
    tk = corps.get(cc)
    if tk in cidx:
        SH[cidx[tk]] = d["common"]
print("주식수 확보 종목", int(np.isfinite(SH).sum()), "/", N, flush=True)
CAP = vt.Cf * SH[None, :]
_cache = {}
K = {"n": 200}
orig_topm = lc.topm


def capm(t):
    key = (t, K["n"])
    if key not in _cache:
        u = vt.UNIV[t] & np.isfinite(CAP[t - 1])
        v = np.where(u, CAP[t - 1], -np.inf)
        m = np.zeros(N, bool)
        m[np.argsort(-v)[:K["n"]]] = True
        _cache[key] = u & m
    return _cache[key]


def main():
    print("(연수익/최대낙폭) 비용 반영, 월(21일) 교체")
    cps.report("KODEX200 보유", np.array([lc.EC[i] / lc.EC[511] for i in range(T)]))
    cps.report("거래대금 상위300 동일가중", cps.simulate("all", 0, 21))
    for n in (100, 200, 300):
        K["n"] = n
        lc.topm = capm
        cps.report(f"시총 상위{n} 동일가중", cps.simulate("all", 0, 21))
        if n in (100, 200):
            cps.report(f"시총 상위{n} lv52 상위20", cps.simulate("lv52", 20, 21))
            cps.report(f"시총 상위{n} lv52 상위10", cps.simulate("lv52", 10, 21))
        lc.topm = orig_topm

if __name__ == "__main__":
    main()
