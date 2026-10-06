# -*- coding: utf-8 -*-
"""
단기 매매 검증용 국내 ETF 일봉 OHLCV 수집 (2026-10-06).

국내 주식형 ETF는 매도 증권거래세가 없고 매매차익이 비과세라 단기 매매 비용이 개별주보다 훨씬 작다.
레버리지·인버스·코스닥·업종 ETF의 시가·고가·저가·종가·거래량을 받는다.
→ .research-cache/trading_etfs/px_<코드>.json  [[YYYYMMDD, 시가, 고가, 저가, 종가, 거래량], ...]
주의: 네이버 siseJson은 분배금 반영 수정주가(2026-10-02 확인).
"""
import json
import os
import re
import time
import urllib.request

OUT = ".research-cache/trading_etfs"
CODES = {
    "069500": "KODEX 200",
    "122630": "KODEX 레버리지",
    "114800": "KODEX 인버스",
    "252670": "KODEX 200선물인버스2X",
    "229200": "KODEX 코스닥150",
    "233740": "KODEX 코스닥150레버리지",
    "251340": "KODEX 코스닥150선물인버스",
    "091160": "KODEX 반도체",
    "091170": "KODEX 은행",
    "102970": "KODEX 증권",
    "117700": "KODEX 건설",
    "117460": "KODEX 에너지화학",
    "140700": "KODEX 보험",
    "266370": "KODEX IT",
    "091180": "KODEX 자동차",
    "305720": "KODEX 2차전지산업",
    "244580": "KODEX 바이오",
    "266410": "KODEX 필수소비재",
    "266390": "KODEX 경기소비재",
    "117680": "KODEX 철강",
    "139260": "TIGER 200 IT",
    "157450": "TIGER 단기통안채",
}


def http(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def fetch(code: str) -> list:
    text = http(f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
                f"&startTime=20000101&endTime=20261231&timeframe=day")
    rows = re.findall(r"\[\"(\d{8})\",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)", text)
    return [[d] + [float(x) for x in r] for d, *r in rows]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for code, name in CODES.items():
        try:
            px = fetch(code)
            json.dump(px, open(f"{OUT}/px_{code}.json", "w", encoding="utf-8"))
            print(f"{code} {name}: {len(px)}일 {px[0][0] if px else '-'}~{px[-1][0] if px else '-'}", flush=True)
        except Exception as e:
            print(f"{code} {name}: 실패 {e}", flush=True)
        time.sleep(0.5)


if __name__ == "__main__":
    main()
