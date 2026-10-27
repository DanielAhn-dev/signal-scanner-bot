# -*- coding: utf-8 -*-
"""
H80용 미국 분기 영업이익 수집 (2026-10-27). SEC EDGAR companyfacts(OperatingIncomeLoss, USD)를 회사별로 받아
.research-cache/us/ops/<cik>.json에 (시작일, 종료일, 값, 최초 공시일) 목록으로 저장한다.
 - 같은 기간이 정정·재공시로 여러 번 나오면 **최초 공시일** 값만 쓴다(정정 반영으로 인한 미래 정보 혼입 방지).
 - 분기(80~100일)와 연간(350~380일) 기간만 저장. 4분기 = 연간 − (1~3분기)는 검증 스크립트가 계산한다.
 - SEC 요청은 초당 4건 이하, User-Agent에 연락처 포함(SEC 정책). 이어받기 가능(이미 있는 파일은 건너뜀).

실행: python -u scripts/research/fetch_us_fundamentals.py [최대건수]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date

UA = "NexoraResearch/1.0 starrich.universe@gmail.com"      # SEC 요구: 요청자 식별(사용자 동의 2026-10-27)
OUT = ".research-cache/us/ops"
TICKERS = ".research-cache/us/tickers.json"
MIN_GAP = 0.27                                             # 초당 약 3.7건
EXCH = {"NYSE", "Nasdaq", "NYSE American", "NYSE Arca", "CBOE"}


def get(url, retries=4):
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b""
            if e.code in (403, 429, 503):
                time.sleep(15 * (k + 1))
                continue
            return e.code, b""
        except Exception:
            time.sleep(5 * (k + 1))
    return 0, b""


def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def extract(raw):
    d = json.loads(raw)
    items = d.get("facts", {}).get("us-gaap", {}).get("OperatingIncomeLoss", {}).get("units", {}).get("USD", [])
    first = {}
    for x in items:
        if "start" not in x or "end" not in x or x.get("val") is None:
            continue
        g = days(x["start"], x["end"])
        if not (80 <= g <= 100 or 350 <= g <= 380):
            continue
        k = (x["start"], x["end"])
        if k not in first or x["filed"] < first[k][3]:
            first[k] = (x["start"], x["end"], x["val"], x["filed"])
    return sorted(first.values())


def main():
    os.makedirs(OUT, exist_ok=True)
    if not os.path.exists(TICKERS):
        st, body = get("https://www.sec.gov/files/company_tickers_exchange.json")
        if st != 200:
            sys.exit(f"티커 목록 실패: {st}")
        d = json.loads(body)
        f = d["fields"]
        rows = [dict(zip(f, r)) for r in d["data"]]
        keep = {}
        for r in rows:
            if r.get("exchange") in EXCH and r.get("ticker") and r["cik"] not in keep:
                keep[r["cik"]] = r["ticker"]
        json.dump(keep, open(TICKERS, "w"))
    tick = json.load(open(TICKERS))
    ciks = sorted(tick, key=lambda c: int(c))
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(ciks)
    done = skipped = empty = 0
    t0 = time.time()
    for cik in ciks[:limit]:
        path = f"{OUT}/{int(cik)}.json"
        if os.path.exists(path):
            skipped += 1
            continue
        time.sleep(MIN_GAP)
        st, body = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json")
        if st == 200:
            try:
                rows = extract(body)
            except Exception:
                rows = []
        elif st == 404:
            rows = []
        else:
            print(f"실패 {cik} {st}", flush=True)
            continue
        json.dump(dict(ticker=tick[cik], rows=rows), open(path, "w"))
        done += 1
        empty += (not rows)
        if done % 200 == 0:
            print(f"{done}건 (건너뜀 {skipped}, 빈 자료 {empty}) · {int(time.time() - t0)}초 · 마지막 {tick[cik]}", flush=True)
    print(f"끝: 새로 {done}건, 건너뜀 {skipped}, 빈 자료 {empty}, 전체 {len(ciks)}", flush=True)


if __name__ == "__main__":
    main()
