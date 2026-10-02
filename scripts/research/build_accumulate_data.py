# -*- coding: utf-8 -*-
"""
웹 '모아가기' 화면용 정적 데이터 생성 (web/src/data/accumulateData.ts).

입력: .research-cache/index_etfs/ (fetch_index_etfs.py 결과)
출력: KODEX 200 월말 수정주가(2002-10~, 분배금 반영 = 세전 재투자 수익) + 후보 ETF 비용·규모 스냅샷.
후보 지표(보수·시총·거래대금)는 시간이 지나면 낡는다 — asOf를 화면에 보여주고 오래되면 경고한다.
갱신: python scripts/research/fetch_index_etfs.py && python scripts/research/build_accumulate_data.py
"""
import json
import re

SRC = ".research-cache/index_etfs"
OUT = "web/src/data/accumulateData.ts"

px = sorted(json.load(open(f"{SRC}/px_069500.json", encoding="utf-8")))
by_month: dict[str, float] = {}
for d, c in px:
    by_month[d[:6]] = float(c)  # 월말값으로 덮어씀 (마지막 달은 진행 중이라 최신 종가)
months = [[m, by_month[m]] for m in sorted(by_month)]

info = json.load(open(f"{SRC}/info.json", encoding="utf-8"))


def pct(v: str | None) -> float | None:
    m = re.search(r"[\d.]+", v or "")
    return float(m.group()) if m else None


cands = []
for code, m in info.items():
    cands.append({
        "code": code, "name": m["name"], "kind": m["kind"], "feePct": pct(m["fee"]),
        "marketCapEok": m["market_cap_eok"], "tradingValueMil": m["trading_value_mil"],
        "listed": m["first_date"], "issuer": m["issuer"],
    })

as_of = px[-1][0]
as_of_iso = f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:]}"
body = (
    "// 자동 생성 — scripts/research/build_accumulate_data.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "export type IndexEtfCandidate = {\n  code: string; name: string; kind: 'plain' | 'tr'; feePct: number | null\n"
    "  marketCapEok: number; tradingValueMil: number; listed: string; issuer: string\n}\n\n"
    f"/** 후보 지표 기준일 (보수·시총·거래대금) */\nexport const ACCUMULATE_ASOF = '{as_of_iso}'\n\n"
    "/** KODEX 200 월말 수정주가 [YYYYMM, 가격] — 분배금 반영(세전 재투자). 모든 코스피200 추종 상품의 장기 이력 대용 */\n"
    f"export const KODEX200_MONTHLY: Array<[string, number]> = {json.dumps(months)}\n\n"
    f"export const INDEX_ETF_CANDIDATES: IndexEtfCandidate[] = {json.dumps(cands, ensure_ascii=False, indent=2)}\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print(OUT, len(months), "개월", len(cands), "후보", as_of_iso)
