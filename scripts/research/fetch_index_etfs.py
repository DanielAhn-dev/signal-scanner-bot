# -*- coding: utf-8 -*-
"""
코스피200 추종 ETF(일반·TR) 후보의 가격 이력과 비용 지표 수집 (2026-10-02).

목적: "KODEX 200 vs 200TR, 그리고 다른 운용사 동일 지수 상품 중 장기 적립에 가장 확실한 것"을 고르기 위한 재료.
같은 지수를 추종하므로 수익률 순위가 아니라 구조적 요소(보수·순자산·거래대금·NAV 괴리·추적오차)로 판단한다.

수집:
  - 가격: 네이버 siseJson 일봉(상장일~현재) → .research-cache/index_etfs/px_<코드>.json  [[YYYYMMDD, 종가], ...]
  - 지표: 네이버 모바일 integration(펀드보수·NAV·운용사) + etfItemList(시총·거래대금) → info.json
주의: 네이버 siseJson 가격은 분배금이 소급 반영된 수정주가다(분배락일 가격 계단 없음, 2026-10-02 확인).
      일반 ETF 가격에 분배금을 또 더하면 이중 계산이 된다.
"""
import json
import os
import re
import time
import urllib.request

OUT = ".research-cache/index_etfs"

# (코드, 구분). 이름은 목록에서 읽는다.
PLAIN = ["069500", "102110", "148020", "105190", "152100", "069660", "293180"]
TR = ["278530", "294400", "295040", "361580", "310960", "332930", "332500", "491220"]


def http(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def fetch_prices(code: str) -> list:
    url = (f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
           f"&startTime=20000101&endTime=20261231&timeframe=day")
    text = http(url)
    rows = re.findall(r"\[\"(\d{8})\",\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+),", text)
    return [[d, float(c) if "." in c else int(c)] for d, c in rows]


def fetch_info(code: str) -> dict:
    data = json.loads(http(f"https://m.stock.naver.com/api/stock/{code}/integration"))
    infos = {i["code"]: i["value"] for i in data.get("totalInfos", [])}
    return {"name": data.get("stockName"), "fee": infos.get("fundPay"), "nav": infos.get("nav"),
            "issuer": infos.get("issueName"), "base_index": infos.get("etfBaseIdx"),
            "last_close": infos.get("lastClosePrice")}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    listing = json.loads(http("https://finance.naver.com/api/sise/etfItemList.nhn"))["result"]["etfItemList"]
    by_code = {it["itemcode"]: it for it in listing}
    info = {}
    for kind, codes in (("plain", PLAIN), ("tr", TR)):
        for code in codes:
            try:
                px = fetch_prices(code)
                json.dump(px, open(f"{OUT}/px_{code}.json", "w", encoding="utf-8"))
                meta = fetch_info(code)
                li = by_code.get(code, {})
                meta.update({"kind": kind, "first_date": px[0][0] if px else None, "last_date": px[-1][0] if px else None,
                             "days": len(px), "market_cap_eok": li.get("marketSum"), "trading_value_mil": li.get("amonut"),
                             "now": li.get("nowVal"), "nav_list": li.get("nav")})
                info[code] = meta
                print(code, meta["name"], kind, meta["first_date"], len(px), "fee", meta["fee"], "시총(억)", meta["market_cap_eok"])
            except Exception as e:  # noqa: BLE001 — 한 종목 실패가 전체를 막지 않게
                print(code, "FAIL", e)
            time.sleep(0.3)
    json.dump(info, open(f"{OUT}/info.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
