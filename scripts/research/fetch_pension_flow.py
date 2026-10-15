# -*- coding: utf-8 -*-
"""
R5(연기금 매수의 하방 지지) 검증용 시장 전체 투자자 세부 일별 순매수 수집 (2026-10-15).
  .research-cache/market_investor_detail.json
  {"KOSPI": {"YYYYMMDD": {"PENSION_FUND": 원, "FOREIGN": 원, "INDIVIDUAL": 원, ...}}, "KOSDAQ": {...}}
출처: 다음 금융 /api/investor/{KOSPI|KOSDAQ}/days?details=true (Referer 필요, 인증 불필요).
  네이버 모바일 trend API는 개인·외국인·기관 3분류뿐이라 연기금이 없다. 이력은 2016-05부터(약 2,550거래일).
  세부 키: PENSION_FUND(연기금 등), FINANCIAL_INVESTOR, INSURANCE_COMPANIES, MUTUAL_FUND(투신),
  PRIVATE_EQUITY_FUND(사모), BANK, ETC_FINANCIAL_INSTITUTION, ETC_CORPORATION, FOREIGN, ETC_FOREIGN, INDIVIDUAL. 단위 원.
오늘(장중) 행은 확정값이 아니므로 저장하지 않는다. 다시 실행하면 전체를 새로 받는다(페이지 26개 × 2시장).
"""
import json, sys, time, urllib.request
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/market_investor_detail.json"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.daum.net/domestic/investors"}
PER_PAGE = 100


def page(market, n):
    url = (f"https://finance.daum.net/api/investor/{market}/days"
           f"?page={n}&perPage={PER_PAGE}&pagination=true&details=true")
    for attempt in range(3):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30).read())
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(3)


def main():
    today = datetime.now().strftime("%Y%m%d")
    res = {}
    for market in ("KOSPI", "KOSDAQ"):
        rows, n = {}, 1
        while True:
            d = page(market, n)
            for r in d["data"]:
                day = r["date"][:10].replace("-", "")
                if day < today and r.get("details"):
                    rows[day] = r["details"]
            if n >= d["totalPages"] or not d["data"]:
                break
            n += 1
            time.sleep(0.5)
        ks = sorted(rows)
        missing = d["totalCount"] - len(rows)
        print(f"  {market}: {ks[0]}~{ks[-1]} {len(ks)}일 (전체 {d['totalCount']}, 빠짐 {missing})")
        res[market] = rows
    json.dump(res, open(OUT, "w", encoding="utf-8"))


if __name__ == "__main__":
    main()
