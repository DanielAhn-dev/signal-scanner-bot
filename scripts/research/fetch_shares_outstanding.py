# -*- coding: utf-8 -*-
"""DART 주식총수(보통주 유통주식수) 수집 — 거래대금 상위 300에 한 번이라도 든 종목 × 사업보고서 연도. 재개 가능.
출력: .research-cache/shares/{corp_code}_{year}.json ({"common": 정수 또는 null, "rcept": 접수번호})"""
import os, sys, json, time, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc
vt = lc.vt
KEY = os.environ["DART_API_KEY"]
OUT = ".research-cache/shares"
os.makedirs(OUT, exist_ok=True)
corps = {c[2]: c[0] for c in json.load(open(".research-cache/corps.json", encoding="utf-8"))}
ever = set()
for t in range(261, vt.T, 20):
    for j in np.where(lc.topm(t))[0]:
        ever.add(vt.codes[j])
print("대상 종목", len(ever), flush=True)
done = 0
for code in sorted(ever):
    cc = corps.get(code)
    if not cc:
        continue
    for y in range(2014, 2026):
        fn = f"{OUT}/{cc}_{y}.json"
        if os.path.exists(fn):
            continue
        u = f"https://opendart.fss.or.kr/api/stockTotqySttus.json?crtfc_key={KEY}&corp_code={cc}&bsns_year={y}&reprt_code=11011"
        for attempt in range(3):
            try:
                d = json.load(urllib.request.urlopen(u, timeout=30))
                break
            except Exception:
                time.sleep(2)
        else:
            continue
        if d.get("status") == "020":  # 일일 한도
            print("한도 도달, 중단", flush=True); sys.exit(0)
        common, rc = None, None
        for r in d.get("list", []) or []:
            if "보통" in r.get("se", ""):
                try:
                    common = int(r["istc_totqy"].replace(",", ""))
                    rc = r["rcept_no"]
                except Exception:
                    pass
        json.dump({"common": common, "rcept": rc, "status": d.get("status")}, open(fn, "w"))
        time.sleep(0.05)
    done += 1
    if done % 50 == 0:
        print("진행", done, flush=True)
print("완료", flush=True)
