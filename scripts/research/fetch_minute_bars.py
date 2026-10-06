# -*- coding: utf-8 -*-
"""
1분봉(종가·누적거래량) 전향 수집 → .research-cache/minute/<코드>.csv (2026-10-07).
출처: 네이버 api.finance.naver.com/siseJson.naver (timeframe=minute). 최근 약 5~7거래일치만 제공하므로
**최소 주 1회** 실행해야 빈틈이 없다. 시가·고가·저가는 제공되지 않는다(종가·누적거래량만).
대상: stock_caps.json에서 활성 종목 중 시총 3,000억 이상 상위 N(기본 250, 봇 유니버스 근사).
행: 시각(YYYYMMDDHHMM), 종가, 누적거래량. 같은 시각은 덮어써서 중복 없이 합친다.
사용: python scripts/research/fetch_minute_bars.py [--top 250]
"""
import argparse, ast, csv, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

sys.stdout.reconfigure(encoding="utf-8")
C = ".research-cache/"
OUT = C + "minute/"


def fetch(code: str):
    s = (date.today() - timedelta(days=14)).strftime("%Y%m%d")
    e = date.today().strftime("%Y%m%d")
    url = (f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
           f"&startTime={s}&endTime={e}&timeframe=minute")
    for _ in range(3):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read()
            rows = ast.literal_eval(b.decode("utf-8", "replace").strip().replace("null", "None"))[1:]
            return code, [(str(r[0]), r[4], r[5]) for r in rows if r[4]]
        except Exception:
            time.sleep(1)
    return code, None


def merge(code: str, rows: list) -> tuple[int, int]:
    path = f"{OUT}{code}.csv"
    cur = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.reader(f):
                cur[r[0]] = (r[1], r[2])
    before = len(cur)
    for t, c, v in rows:
        cur[t] = (c, v)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        for t in sorted(cur):
            w.writerow([t, *cur[t]])
    return before, len(cur)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=250)
    a = ap.parse_args()
    caps = json.load(open(C + "stock_caps.json", encoding="utf-8"))
    pool = [r for r in caps if r.get("is_active") and (r.get("market_cap") or 0) >= 3e11]
    codes = [r["code"] for r in sorted(pool, key=lambda r: -r["market_cap"])[: a.top]]
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(fetch, codes))
    fail = [c for c, r in res if r is None]
    added = 0
    first = last = None
    for c, r in res:
        if not r:
            continue
        b, n = merge(c, r)
        added += n - b
        first = min(first or r[-1][0], r[-1][0])
        last = max(last or r[0][0], r[0][0])
    print(f"대상 {len(codes)}종목, 실패 {len(fail)}, 새 행 {added:,}, 응답 최오래 {first}~최신 {last}, {time.time()-t0:.0f}초")
    if fail:
        print("실패:", fail[:20])


if __name__ == "__main__":
    main()
