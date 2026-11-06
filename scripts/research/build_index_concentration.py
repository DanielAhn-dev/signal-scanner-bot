# -*- coding: utf-8 -*-
"""
코스피200 ETF의 반도체 두 종목 쏠림 안내용 수치 (2026-11-06). 예측이 아니라 '구성과 과거 동반 낙폭' 설명 자료다. 매매 규칙에 쓰지 않는다.

1) 지금 구성: 네이버 ETF 구성종목(constituentWeight, 장중 기준)에서 삼성전자·SK하이닉스 비중 (KODEX 200 등)
2) 과거 코스피 −20% 이상 하락 사건별 코스피·삼성전자·SK하이닉스·S&P500 낙폭 (2001-09~, 가격 캐시 필요)
   — 캐시 준비: .research-cache/{ks11_all,samsung,hynix,gspc_1950}.json ([epoch, close] 목록, Yahoo chart API)
출력: web/src/data/indexConcentration.ts (직접 고치지 말고 이 스크립트를 다시 돌린다)
실행: python scripts/research/build_index_concentration.py
"""
import datetime as D
import json
import sys
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
ETFS = [("069500", "KODEX 200"), ("102110", "TIGER 200"), ("278530", "KODEX 200TR")]
TOP2 = ("005930", "000660")


def fetch_etf(code):
    req = urllib.request.Request(f"https://m.stock.naver.com/api/etf/{code}/basic", headers={"User-Agent": UA})
    d = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
    cl = d.get("constituentList") or []
    w = {c["itemCode"]: float(c["constituentWeight"]) for c in cl if c.get("constituentWeight") is not None}
    return {
        "code": code,
        "name": d.get("stockName") or code,
        "samsung": w.get("005930"),
        "hynix": w.get("000660"),
        "listedTop": len(cl),
        "listedSum": round(sum(w.values()), 1),
    }


etfs = []
for code, nm in ETFS:
    try:
        r = fetch_etf(code)
        if r["samsung"] is None or r["hynix"] is None:
            print(f"  {code} {nm}: 구성종목에 두 종목이 없음(상위 {r['listedTop']}개만 제공) → 건너뜀")
            continue
        r["top2"] = round(r["samsung"] + r["hynix"], 1)
        etfs.append(r)
        print(f"  {r['code']} {r['name']}: 삼성전자 {r['samsung']}% + SK하이닉스 {r['hynix']}% = {r['top2']}% (상위 {r['listedTop']}개 합 {r['listedSum']}%)")
    except Exception as e:  # 한 상품이 실패해도 나머지는 쓴다
        print(f"  {code} {nm}: 실패 {e}")
if not etfs:
    sys.exit("구성종목을 하나도 못 받음 — 파일을 쓰지 않음")


def ld(n):
    return {(D.datetime(1970, 1, 1) + D.timedelta(seconds=t)).date(): c for t, c in json.load(open(C + n + ".json"))}


S = {"kospi": ld("ks11_all"), "samsung": ld("samsung"), "hynix": ld("hynix"), "spx": ld("gspc_1950")}
kd = sorted(S["kospi"])


def near(s, d, before):
    ds = [x for x in s if (x <= d if before else x >= d)]
    if not ds:
        return None
    x = max(ds) if before else min(ds)
    return x if abs((x - d).days) < 10 else None


def chg(k, a, b):
    x, y = near(S[k], a, True), near(S[k], b, True)
    return None if not x or not y else round((S[k][y] / S[k][x] - 1) * 100)


# 코스피 −20% 이상 하락 사건 (2001-09~ 가격이 있는 구간만)
START = D.date(2001, 9, 10)
ev, pk = [], None
for d in kd:
    if d < START:
        continue
    if pk is None or S["kospi"][d] > S["kospi"][pk]:
        pk = d
    elif S["kospi"][d] / S["kospi"][pk] - 1 <= -0.20 and (not ev or ev[-1][0] != pk):
        tr = min((x for x in kd if pk <= x <= pk + D.timedelta(days=500)), key=lambda x: S["kospi"][x])
        ev.append((pk, tr))
episodes = []
for pk_, tr in ev:
    row = {"from": pk_.isoformat()[:7], "to": tr.isoformat()[:7], "ongoing": tr >= kd[-1] - D.timedelta(days=5)}
    for k in S:
        row[k] = chg(k, pk_, tr)
    episodes.append(row)
    print(f"  {row['from']}~{row['to']} 코스피 {row['kospi']}% 삼성 {row['samsung']}% 하이닉스 {row['hynix']}% S&P500 {row['spx']}%")

today = D.date.today().isoformat()
data = {
    "asOf": today,
    "etfs": etfs,
    "episodes": episodes,
    "priceEnd": kd[-1].isoformat(),
}
meta = {
    "title": "코스피200의 반도체 쏠림",
    "asOf": today,
    "generated": today,
    "script": "scripts/research/build_index_concentration.py",
    "sample": f"비중은 {today} 네이버 ETF 구성종목(장중), 낙폭은 코스피 −20% 이상 하락 사건 {len(episodes)}건(2001-09~{kd[-1].isoformat()[:7]}) 고점→저점, 가격은 수정주가",
    "caveat": "비중은 지금 한 시점뿐이라 과거 비중과는 다름(과거엔 더 낮았을 수 있음), 사건 표본이 적고 마지막 사건은 진행 중이라 저점이 더 낮아질 수 있음, 원인을 단정하지 않음",
}
out = "web/src/data/indexConcentration.ts"
with open(out, "w", encoding="utf-8") as f:
    f.write("// 자동 생성 — scripts/research/build_index_concentration.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n")
    f.write("import type { FactMeta } from './researchFacts'\n")
    f.write(f"export const INDEX_CONCENTRATION = {json.dumps(data, ensure_ascii=False)} as const\n")
    f.write(f"export const INDEX_CONCENTRATION_META: FactMeta = {json.dumps(meta, ensure_ascii=False)}\n")
print("저장:", out)
