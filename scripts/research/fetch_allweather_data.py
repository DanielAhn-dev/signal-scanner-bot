# -*- coding: utf-8 -*-
"""
올웨더·균형 프로필 검증용 데이터 수집 (2026-10-02).

수집 → .research-cache/allweather/
  - kr_<코드>.json : 한국 상장 ETF 네이버 일봉 [[YYYYMMDD, 종가], ...] (분배금 소급 반영 수정주가)
  - us_<심볼>.json : 야후 일봉 [[YYYYMMDD, 수정종가, 종가], ...] (adjclose=분배금 반영 총수익)
  - cd91.json      : ECOS CD(91일) 일별 금리 [[YYYYMMDD, %], ...] (ECOS_API_KEY 필요, 없으면 건너뜀)
  - info.json      : 한국 ETF 이름·보수·상장일·마지막일

목적: 한국 상장 ETF만으로는 장기채·물가채·원자재 이력이 4~6년뿐이라, 미국 원지수(SPY·TLT·IEF·TIP·GLD·DBC·VNQ)와
      원/달러 환율로 20년 구간을 검증하고 한국 ETF로는 가능한 구간만 교차 확인하기 위함.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/allweather"
KR = {
    "069500": "KODEX 200", "133690": "TIGER 미국나스닥100", "360750": "TIGER 미국S&P500", "379800": "KODEX 미국S&P500",
    "148070": "KIWOOM 국고채10년", "385560": "RISE KIS국고채30년Enhanced", "439870": "KODEX 국고채30년액티브",
    "305080": "TIGER 미국채10년선물", "308620": "KODEX 미국10년국채선물", "304660": "KODEX 미국30년국채울트라선물(H)",
    "453850": "ACE 미국30년국채액티브(H)", "484790": "KODEX 미국30년국채액티브(H)", "476760": "ACE 미국30년국채액티브",
    "430500": "KIWOOM 물가채KIS", "468370": "KODEX iShares미국인플레이션국채액티브",
    "132030": "KODEX 골드선물(H)", "411060": "ACE KRX금현물", "319640": "TIGER 골드선물(H)",
    "261220": "KODEX WTI원유선물(H)", "329200": "TIGER 리츠부동산인프라", "352560": "KODEX 미국부동산리츠(H)",
    "182480": "TIGER 미국MSCI리츠(합성 H)", "273130": "KODEX 종합채권(AA-이상)액티브",
}
US = ["SPY", "QQQ", "TLT", "IEF", "TIP", "GLD", "DBC", "VNQ", "SHY", "^GSPC", "^KS11", "KRW=X", "GC=F"]


def http(url, enc="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read().decode(enc, "replace")


def fetch_kr(code):
    t = http(f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1&startTime=20000101&endTime=20261231&timeframe=day")
    rows = re.findall(r"\[\"(\d{8})\",\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+),", t)
    return [[d, float(c)] for d, c in rows]


def fetch_us(sym):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=0&period2=1790000000&interval=1d&includeAdjustedClose=true"
    j = json.loads(http(u))["chart"]["result"][0]
    ts, q = j["timestamp"], j["indicators"]["quote"][0]["close"]
    adj = j["indicators"].get("adjclose", [{}])[0].get("adjclose") or q
    rows = []
    for t, c, a in zip(ts, q, adj):
        if c is None or a is None:
            continue
        rows.append([datetime.fromtimestamp(t, timezone.utc).strftime("%Y%m%d"), a, c])
    return rows


def env_key(name):
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in open(".env", encoding="utf-8"):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return None


def fetch_cd91(key):
    # 817Y002(시장금리 일별) 010502000 = CD(91일)
    rows, start = [], 1
    while True:
        u = f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/{start}/10000/817Y002/D/19980101/20261231/010502000"
        j = json.loads(http(u))
        if "StatisticSearch" not in j:
            print("  ECOS 응답:", str(j)[:200])
            break
        part = j["StatisticSearch"]["row"]
        rows += [[r["TIME"], float(r["DATA_VALUE"])] for r in part if r["DATA_VALUE"]]
        if len(part) < 10000:
            break
        start += 10000
    return rows


def main():
    os.makedirs(OUT, exist_ok=True)
    info = {}
    listing = {it["itemcode"]: it for it in json.loads(
        http("https://finance.naver.com/api/sise/etfItemList.nhn", "cp949"))["result"]["etfItemList"]}
    for code, name in KR.items():
        try:
            px = fetch_kr(code)
            json.dump(px, open(f"{OUT}/kr_{code}.json", "w", encoding="utf-8"))
            meta = json.loads(http(f"https://m.stock.naver.com/api/stock/{code}/integration"))
            infos = {i["code"]: i["value"] for i in meta.get("totalInfos", [])}
            info[code] = {"name": name, "fee": infos.get("fundPay"), "first": px[0][0] if px else None,
                          "last": px[-1][0] if px else None, "n": len(px), "marketSum": listing.get(code, {}).get("marketSum")}
            print(f"kr {code} {name}: {info[code]['first']}~{info[code]['last']} ({len(px)}일) 보수 {info[code]['fee']}")
        except Exception as e:
            print(f"kr {code} 실패: {e}")
        time.sleep(0.3)
    json.dump(info, open(f"{OUT}/info.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for sym in US:
        try:
            rows = fetch_us(sym)
            json.dump(rows, open(f"{OUT}/us_{sym.replace('^', '_').replace('=', '_')}.json", "w", encoding="utf-8"))
            print(f"us {sym}: {rows[0][0]}~{rows[-1][0]} ({len(rows)}일)")
        except Exception as e:
            print(f"us {sym} 실패: {e}")
        time.sleep(0.5)
    key = env_key("ECOS_API_KEY")
    if key:
        try:
            rows = fetch_cd91(key)
            json.dump(rows, open(f"{OUT}/cd91.json", "w", encoding="utf-8"))
            print(f"CD91: {rows[0][0]}~{rows[-1][0]} ({len(rows)}일)" if rows else "CD91 없음")
        except Exception as e:
            print("CD91 실패:", e)
    else:
        print("ECOS_API_KEY 없음 — CD금리 건너뜀")


if __name__ == "__main__":
    main()
