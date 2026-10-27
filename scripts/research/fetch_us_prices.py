# -*- coding: utf-8 -*-
"""
H80용 미국 일봉 수집 (2026-10-27). 분기 영업이익 자료가 있는 종목만 Yahoo chart API에서 받아
.research-cache/us/px/<ticker>.json에 {t:[epoch], adj:[수정종가], c:[종가], v:[거래량]}로 저장한다. 2014-01-01~.
 - 초당 약 1.5건, 이어받기 가능(이미 있는 파일은 건너뜀). 연락처 등 개인정보는 보내지 않는다.

실행: python -u scripts/research/fetch_us_prices.py [최대건수] [rev]   (rev: 목록 뒤에서부터)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OPS = ".research-cache/us/ops"
OUT = ".research-cache/us/px"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
MIN_GAP = 0.65
P1 = 1388534400          # 2014-01-01


def get(url, retries=4):
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b""
            if e.code in (429, 403, 503):
                time.sleep(20 * (k + 1))
                continue
            return e.code, b""
        except Exception:
            time.sleep(5 * (k + 1))
    return 0, b""


def main():
    os.makedirs(OUT, exist_ok=True)
    tickers = []
    for f in sorted(os.listdir(OPS)):
        d = json.load(open(f"{OPS}/{f}"))
        if d["rows"]:
            tickers.append(d["ticker"])
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(tickers)
    if len(sys.argv) > 2 and sys.argv[2] == "rev":     # 두 번째 작업이 목록 뒤에서부터 받아 속도를 두 배로
        tickers = tickers[::-1]
    done = skipped = failed = 0
    t0 = time.time()
    for tk in tickers[:limit]:
        path = f"{OUT}/{urllib.parse.quote(tk, safe='')}.json"
        if os.path.exists(path):
            skipped += 1
            continue
        time.sleep(MIN_GAP)
        now = int(time.time())
        st, body = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(tk)}?period1={P1}&period2={now}&interval=1d&events=div%2Csplit")
        if st != 200:
            if st == 404:
                json.dump(dict(t=[], adj=[], c=[], v=[]), open(path, "w"))
            else:
                failed += 1
                print(f"실패 {tk} {st}", flush=True)
            continue
        try:
            r = json.loads(body)["chart"]["result"][0]
            q = r["indicators"]["quote"][0]
            adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
            out = dict(t=r.get("timestamp", []), adj=adj, c=q["close"], v=q["volume"])
        except Exception:
            out = dict(t=[], adj=[], c=[], v=[])
        json.dump(out, open(path, "w"))
        done += 1
        if done % 200 == 0:
            print(f"{done}건 (건너뜀 {skipped}, 실패 {failed}) · {int(time.time() - t0)}초 · 마지막 {tk}", flush=True)
    print(f"끝: 새로 {done}건, 건너뜀 {skipped}, 실패 {failed}, 전체 {len(tickers)}", flush=True)


if __name__ == "__main__":
    main()
