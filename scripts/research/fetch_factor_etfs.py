# -*- coding: utf-8 -*-
"""
V1(코스피200 동일가중)·V2(미국 팩터 ETF)·V9(TDF) 검증용 가격 수집 (2026-10-15). → .research-cache/factor_etfs/
  kr_<코드>.json : 네이버 일봉 [[YYYYMMDD, 종가], ...] (분배금 소급 반영 수정주가 — 분배금을 따로 더하지 않는다)
  us_<심볼>.json : 야후 일봉 [[YYYYMMDD, 수정종가, 종가], ...] (수정종가 = 분배금 재투자 총수익)
  info.json      : 이름·총보수(네이버 etfKeyIndicator.totalFee, 없으면 fundPay)·첫날·마지막날·일수
비교 기준(SPY, KODEX 200)은 allweather/ 에 이미 있다. 받는 함수는 fetch_allweather_data.py와 같은 것을 쓴다.
한계: 팩터 ETF는 2011~2013년 상장이라 표본이 13~15년, 한국 TDF ETF는 2022년 이후 상장이라 성과 비교보다 보수 비교용.
"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from fetch_allweather_data import fetch_kr, fetch_us, http  # noqa: E402

OUT = ".research-cache/factor_etfs"
KR = {
    # V1 동일가중 vs 시총가중
    "252650": "KODEX 200동일가중", "252000": "TIGER 200동일가중",
    # 한국 팩터(V2 국내 대조)
    "174350": "TIGER 로우볼", "215620": "HK S&P코리아로우볼", "223190": "KODEX 200가치저변동",
    "147970": "TIGER 모멘텀", "275280": "KODEX 모멘텀주", "244660": "KODEX 퀄리티Plus", "244670": "KODEX 밸류Plus",
    # V9 TDF(ETF형)
    "433970": "KODEX TDF2030액티브", "433980": "KODEX TDF2040액티브", "434060": "KODEX TDF2050액티브",
    "442550": "RISE TDF2030액티브", "442560": "RISE TDF2040액티브", "442570": "RISE TDF2050액티브",
    "0025N0": "TIGER TDF2045", "329650": "KODEX TRF3070", "329660": "KODEX TRF5050", "329670": "KODEX TRF7030",
}
# 미국 팩터: 저변동(USMV·SPLV), 모멘텀(MTUM), 퀄리티(QUAL·SPHQ), 가치(VLUE·IWD), 성장(IWF), 동일가중(RSP), 소형(IWM)
US = ["USMV", "SPLV", "MTUM", "QUAL", "SPHQ", "VLUE", "IWD", "IWF", "RSP", "IWM"]


def main():
    os.makedirs(OUT, exist_ok=True)
    info = {}
    for code, name in KR.items():
        try:
            px = fetch_kr(code)
            json.dump(px, open(f"{OUT}/kr_{code}.json", "w", encoding="utf-8"))
            meta = json.loads(http(f"https://m.stock.naver.com/api/stock/{code}/integration"))
            infos = {i["code"]: i["value"] for i in meta.get("totalInfos", [])}
            fee = (meta.get("etfKeyIndicator") or {}).get("totalFee")  # fundPay는 보수 인하가 늦게 반영된다
            info[code] = {"name": name, "fee": f"{fee}%" if fee is not None else infos.get("fundPay"), "first": px[0][0] if px else None,
                          "last": px[-1][0] if px else None, "n": len(px)}
            print(f"kr {code} {name}: {info[code]['first']}~{info[code]['last']} ({len(px)}일) 보수 {info[code]['fee']}")
        except Exception as e:
            print(f"kr {code} 실패: {e}")
        time.sleep(0.3)
    for sym in US:
        try:
            rows = fetch_us(sym)
            json.dump(rows, open(f"{OUT}/us_{sym}.json", "w", encoding="utf-8"))
            info[sym] = {"first": rows[0][0], "last": rows[-1][0], "n": len(rows)}
            print(f"us {sym}: {rows[0][0]}~{rows[-1][0]} ({len(rows)}일)")
        except Exception as e:
            print(f"us {sym} 실패: {e}")
        time.sleep(0.5)
    json.dump(info, open(f"{OUT}/info.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
