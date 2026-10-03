# -*- coding: utf-8 -*-
"""
신형 커버드콜 분배금 점검 (2026-10-03) — 사용자가 받은 운용사 분배금 이력(.research-cache/div_<코드>.json)으로 세대별 분배율·원금 잠식·분배 안정성·총수익을 비교.
수정주가(분배금 소급 반영)에서 실제 가격과 분배 수익률을 역산(validate_income_then_growth.reconstruct). 기간은 상품별 분배 이력 시작~2026-09(약 2~4년).
세대 구분은 상품명 기반 추정(미확인): 1세대 441680·289480·290080, 2세대 475720·498400, 3세대 482730·486290·494300, 배당다우존스 타겟커버드콜 458750·458760·483290(구조 미확인).
기준지수 비교: 코스피200(KODEX200), 나스닥100·S&P500은 원화 환산(mixData). 배당다우존스는 기준지수 자료가 없어 생략.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly, reconstruct  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
mix = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(txt[txt.index("= [{") + 2: txt.rindex("]") + 1])}
bench = {"kospi200": monthly(".research-cache/index_etfs/px_069500.json"), "nasdaq100": mix["nasdaq100"], "sp500": mix["sp500"]}
P = [("289480", "TIGER200CC", 1, "kospi200"), ("290080", "RISE200고배당CC ATM", 1, "kospi200"), ("441680", "TIGER나스닥100CC(합성)", 1, "nasdaq100"),
     ("475720", "RISE200위클리CC", 2, "kospi200"), ("498400", "KODEX200타겟위클리CC", 2, "kospi200"),
     ("482730", "TIGER S&P500타겟데일리CC", 3, "sp500"), ("486290", "TIGER나스닥100타겟데일리CC", 3, "nasdaq100"), ("494300", "KODEX나스닥100데일리CC OTM", 3, "nasdaq100"),
     ("458750", "TIGER 배당다우존스타겟CC 1호", 0, None), ("458760", "TIGER 배당다우존스타겟CC 2호", 0, None), ("483290", "KODEX 배당다우존스타겟CC", 0, None)]
def load(code):
    for d in (".research-cache/dividend_etfs", ".research-cache"):
        p = f"{d}/px_{code}.json"
        if os.path.exists(p): return monthly(p)
    return None
print(f"{'세대':>3s} {'상품':28s} {'분배기간':>14s} {'분배건':>5s} {'연 분배율':>8s} {'12개월 분배율(최근)':>16s} {'실제가격변화':>10s} {'총수익':>7s} {'지수총수익':>9s} {'월분배 변동계수':>12s} {'최저/평균':>8s}")
rows = []
for code, name, gen, bk in P:
    px = load(code)
    if px is None: print(code, name, "가격 없음"); continue
    divs = json.load(open(f".research-cache/div_{code}.json", encoding="utf-8"))
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
    sub = {m: px[m] for m in sorted(px) if m >= first}
    if len(sub) < 8: print(code, name, "공통 기간 짧음", len(sub)); continue
    ms, real, y = reconstruct(sub, divs)
    by = {}
    for x in divs:
        k = x["recordDate"][:4] + x["recordDate"][5:7]; by[k] = by.get(k, 0) + x["amount"]
    amts = np.array([by[m] for m in sorted(by) if m in set(ms)])
    r0, r1 = real[ms[0]], real[ms[-1]]
    yrs = (len(ms) - 1) / 12
    cum = amts.sum()
    ann_y = cum / r0 / yrs * 100
    last12 = sum(by.get(m, 0) for m in ms[-12:]) / r1 * 100
    tot = (sub[ms[-1]] / sub[ms[0]] - 1) * 100
    bt = None
    if bk:
        b = bench[bk]; mm = [m for m in ms if m in b]
        if len(mm) > 6: bt = (b[mm[-1]] / b[mm[0]] - 1) * 100
    print(f"{gen:>3d} {name:28s} {ms[0]}~{ms[-1][2:]} {len(amts):>5d} {ann_y:7.1f}% {last12:15.1f}% {(r1/r0-1)*100:+9.0f}% {tot:+6.0f}% " + (f"{bt:+8.0f}%" if bt is not None else "       -") + f" {amts.std()/amts.mean():11.2f} {amts.min()/amts.mean():8.2f}")
