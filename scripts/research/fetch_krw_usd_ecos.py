# -*- coding: utf-8 -*-
"""
원/달러 일별 매매기준율(한국은행 ECOS 731Y001, 0000001) 1996~ 수집.

왜: 야후 KRW=X는 2003-12부터라, 해외지수를 원화로 바꾼 장기 이력이 2003-12에서 끊긴다.
'앞으로 10년 경우의 수' 재료를 1999-04~로 넓히려면(닷컴 붕괴 포함) 그 이전 환율이 필요하다.
출력: .research-cache/longrun/krw_usd_ecos.json  [["YYYYMMDD", 원], ...]
키: .env ECOS_API_KEY
갱신: python scripts/research/fetch_krw_usd_ecos.py
"""
import json
import os
import time
import urllib.request
from datetime import datetime

OUT = ".research-cache/longrun/krw_usd_ecos.json"


def load_env_key(name):
    if os.environ.get(name):
        return os.environ[name]
    for line in open(".env", encoding="utf-8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit(f"{name} 필요")


def get(url):
    for attempt in range(3):
        try:
            return urllib.request.urlopen(url, timeout=60).read()
        except OSError:
            if attempt == 2:
                raise
            time.sleep(3)


def main():
    key = load_env_key("ECOS_API_KEY")
    rows = []
    # 한 번에 10만 행까지라 10년씩 나눠 받는다
    for y0 in range(1996, datetime.now().year + 1, 10):
        y1 = min(y0 + 9, datetime.now().year)
        url = f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/100000/731Y001/D/{y0}0101/{y1}1231/0000001"
        data = json.loads(get(url).decode("utf-8"))
        part = data.get("StatisticSearch", {}).get("row")
        if not part:
            raise SystemExit(f"ECOS 응답 이상: {str(data)[:200]}")
        rows += [[r["TIME"], float(r["DATA_VALUE"])] for r in part]
    rows.sort()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rows, open(OUT, "w", encoding="utf-8"))
    print(f"원/달러 ECOS: {rows[0][0]}~{rows[-1][0]} ({len(rows)}일) → {OUT}")


if __name__ == "__main__":
    main()
