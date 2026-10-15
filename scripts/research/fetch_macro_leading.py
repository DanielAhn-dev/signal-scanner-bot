# -*- coding: utf-8 -*-
"""
R3(수출·경기선행지수 → 지수) 검증용 월별 거시 데이터 수집 (2026-10-15). 결과는 .research-cache/macro_leading/.
  ecos_kr.json   {"선행지수순환변동치": {"YYYYMM": v}, "수출금액": ..., "수출_중화학": ...}
                 ECOS 901Y067(경기종합지수, 1970~), 901Y092(성질별 수출, 2000~, 천달러). 키는 .env ECOS_API_KEY.
  oecd_cli.json  {"KOR": {"YYYY-MM": v}, ...}  OECD SDMX DF_CLI 진폭조정(AA) 지수, 전 국가.
  indices.json   {"KOR": {"YYYYMM": 월말 종가}, ...}  야후 일봉에서 월말값(월봉은 간격이 어긋나서 쓰지 않는다).
한계: 둘 다 현재 시점 수정치다(발표 당시 값이 아님). 선행지수는 발표가 약 1개월 늦으므로 검증할 때 1~2개월 늦춰 쓴다.
야후 지수는 가격지수(배당 제외)이고 국가마다 시작 연도가 다르다.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/macro_leading"
UA = {"User-Agent": "Mozilla/5.0"}

# OECD 국가 코드 → 야후 대표 지수
INDEX_TICKERS = {
    "KOR": "^KS11", "USA": "^GSPC", "JPN": "^N225", "DEU": "^GDAXI", "GBR": "^FTSE", "FRA": "^FCHI",
    "CAN": "^GSPTSE", "AUS": "^AXJO", "ITA": "FTSEMIB.MI", "ESP": "^IBEX", "NLD": "^AEX", "CHE": "^SSMI",
    "BEL": "^BFX", "AUT": "^ATX", "MEX": "^MXX", "BRA": "^BVSP", "IND": "^BSESN", "CHN": "000001.SS",
    "IDN": "^JKSE", "TUR": "XU100.IS", "NZL": "^NZ50", "NOR": "OSEBX.OL", "SWE": "^OMX", "DNK": "^OMXC25",
}


def get(url, headers=UA, timeout=60):
    for attempt in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout).read()
        except OSError:
            if attempt == 2:
                raise
            time.sleep(3)


def load_env_key(name):
    if os.environ.get(name):
        return os.environ[name]
    for line in open(".env", encoding="utf-8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{name} 필요")


def fetch_ecos():
    key = load_env_key("ECOS_API_KEY")
    series = {
        "선행지수순환변동치": ("901Y067", "I16E", "197001"),
        "선행종합지수": ("901Y067", "I16A", "197001"),
        "동행지수순환변동치": ("901Y067", "I16D", "197001"),
        "수출금액": ("901Y092", "E100", "200001"),
        "수출_중화학": ("901Y092", "E104", "200001"),
        "수입금액": ("901Y092", "I100", "200001"),
    }
    end = datetime.now().strftime("%Y%m")
    res = {}
    for name, (table, item, start) in series.items():
        url = f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/10000/{table}/M/{start}/{end}/{item}"
        rows = json.loads(get(url).decode("utf-8"))["StatisticSearch"]["row"]
        res[name] = {r["TIME"]: float(r["DATA_VALUE"]) for r in rows}
        ks = sorted(res[name])
        print(f"  ECOS {name}: {ks[0]}~{ks[-1]} ({len(ks)}개월)")
    return res


def fetch_oecd_cli():
    url = ("https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/"
           ".M.LI...AA...H?startPeriod=1955-01")
    text = get(url, {**UA, "Accept": "application/vnd.sdmx.data+csv"}, 180).decode("utf-8")
    lines = text.strip().splitlines()
    head = lines[0].split(",")
    ia, it, iv = head.index("REF_AREA"), head.index("TIME_PERIOD"), head.index("OBS_VALUE")
    res = {}
    for ln in lines[1:]:
        c = ln.split(",")
        if c[iv]:
            res.setdefault(c[ia], {})[c[it]] = float(c[iv])
    for k in sorted(res):
        ks = sorted(res[k])
        print(f"  CLI {k}: {ks[0]}~{ks[-1]} ({len(ks)}개월)")
    return res


def fetch_index(ticker):
    now = int(time.time())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(ticker)}"
           f"?period1=0&period2={now}&interval=1d")
    r = json.loads(get(url))["chart"]["result"][0]
    month_end = {}
    for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
        if c:
            month_end[datetime.fromtimestamp(t, timezone.utc).strftime("%Y%m")] = c
    # 진행 중인 이번 달은 월말값이 아니므로 뺀다
    month_end.pop(datetime.now().strftime("%Y%m"), None)
    return month_end


def main():
    os.makedirs(OUT, exist_ok=True)
    print("1) ECOS")
    json.dump(fetch_ecos(), open(f"{OUT}/ecos_kr.json", "w", encoding="utf-8"), ensure_ascii=False)
    print("2) OECD CLI")
    json.dump(fetch_oecd_cli(), open(f"{OUT}/oecd_cli.json", "w", encoding="utf-8"))
    print("3) 국가별 지수(야후)")
    idx = {}
    for cc, tk in INDEX_TICKERS.items():
        try:
            idx[cc] = fetch_index(tk)
            ks = sorted(idx[cc])
            print(f"  {cc} {tk}: {ks[0]}~{ks[-1]} ({len(ks)}개월)")
        except Exception as e:
            print(f"  {cc} {tk}: 실패 {e}")
        time.sleep(0.5)
    json.dump(idx, open(f"{OUT}/indices.json", "w", encoding="utf-8"))


if __name__ == "__main__":
    main()
