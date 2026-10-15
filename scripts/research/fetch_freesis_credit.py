# -*- coding: utf-8 -*-
"""
금융투자협회 FreeSIS 일별 증시자금·신용공여 이력 수집 (H47, 2026-10-15). 인증 불필요, 단위 백만원.
  .research-cache/freesis_funds.json  {"YYYYMMDD": [투자자예탁금, 장내파생 예수금, RP 매도잔고, 위탁매매 미수금, 실제 반대매매금액, 반대매매 비중%]}
  .research-cache/freesis_credit.json {"YYYYMMDD": [신용융자 전체, 유가증권, 코스닥, 신용대주 전체, 유가, 코스닥, 청약자금대출, 예탁증권담보융자]}
출처: POST https://freesis.kofia.or.kr/meta/getMetaDataList.do
  STATSCU0100000060BO = 증시자금추이, STATSCU0100000070BO = 신용공여 잔고 추이.
반대매매는 '위탁매매 미수금' 반대매매(신용융자 담보부족 반대매매는 FreeSIS에 없음).
1년씩 끊어 요청하고 실패하면 3번까지 다시 한다(큰 응답이 중간에 잘려 JSON이 깨진 적이 있다).
"""
import json, sys, time, urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
URL = "https://freesis.kofia.or.kr/meta/getMetaDataList.do"
SETS = {
    "freesis_funds.json": ("STATSCU0100000060BO", 6),
    "freesis_credit.json": ("STATSCU0100000070BO", 8),
}


def fetch(obj, start, end):
    body = json.dumps({"dmSearch": {"tmpV40": "1000000", "tmpV41": "1", "tmpV1": "D",
                                    "tmpV45": start, "tmpV46": end, "OBJ_NM": obj}}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json; charset=UTF-8", "User-Agent": "Mozilla/5.0",
        "Referer": "https://freesis.kofia.or.kr/"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["ds1"] or []


for out, (obj, ncol) in SETS.items():
    res = {}
    for y in range(1995, 2027):
        for attempt in range(3):
            try:
                rows = fetch(obj, f"{y}0101", f"{y}1231")
                break
            except (ValueError, OSError):
                time.sleep(3)
        else:
            raise SystemExit(f"{obj} {y} 3번 실패")
        for r in rows:
            res[r["TMPV1"]] = [r.get(f"TMPV{k}") for k in range(2, 2 + ncol)]
        print(out, y, len(rows), flush=True)
        time.sleep(1)
    json.dump(dict(sorted(res.items())), open(C + out, "w"))
    ks = sorted(res)
    print("done", out, len(ks), ks[0] if ks else None, ks[-1] if ks else None)
