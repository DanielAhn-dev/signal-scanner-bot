# -*- coding: utf-8 -*-
"""
분배금 지속 가능성 점검 (2026-10-03) — 분배금을 받은 만큼 '기준가'(실제 가격)가 깎였나, 아니면 올랐나.
분배율이 높아도 실제 가격이 계속 내려가면 받은 돈의 일부는 내 원금을 돌려받은 것(원금 잠식)이다.
방법: 수정주가에서 실제 가격 경로와 분배율을 역산(validate_income_then_growth.reconstruct)해, 기간 내 실제 가격 변화, 분배금 누적(시작 가격 대비), 총수익을 비교.
        실제 가격 변화 + 분배 누적 = 총수익에 가깝다. 실제 가격이 내려간 만큼이 '잠식'이고, 같은 기간 지수 가격 변화와 비교한다.
한계: 역산 근사, 기간 약 4.5년·한국 강세장, 운용 규칙이 상품마다 다르다.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly, reconstruct  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
P = {"161510": ("고배당 PLUS", ".research-cache/px_161510.json"), "104530": ("고배당 KIWOOM", ".research-cache/dividend_etfs/px_104530.json"),
     "210780": ("고배당 TIGER", ".research-cache/dividend_etfs/px_210780.json"), "289480": ("커버드콜 TIGER200", ".research-cache/dividend_etfs/px_289480.json"),
     "290080": ("커버드콜 RISE ATM", ".research-cache/dividend_etfs/px_290080.json")}
idx = monthly(".research-cache/index_etfs/px_069500.json")
print(f"{'상품':18s} {'기간':>14s} {'실제가격 변화':>12s} {'분배 누적(시작가 대비)':>20s} {'총수익':>7s} {'연 분배율':>8s}  | 같은 기간 지수: 가격변화(근사)/총수익")
for c, (nm, path) in P.items():
    adj = monthly(path)
    divs = json.load(open(f".research-cache/div_{c}.json", encoding="utf-8"))
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
    sub = {m: adj[m] for m in sorted(adj) if m >= first and m in idx}
    ms, real, y = reconstruct(sub, divs)
    r0, r1 = real[ms[0]], real[ms[-1]]
    cum = sum(x["amount"] for x in divs if (x["recordDate"][:4] + x["recordDate"][5:7]) in set(ms[1:]))
    tot = sub[ms[-1]] / sub[ms[0]] - 1
    yrs = (len(ms) - 1) / 12
    ix_tot = idx[ms[-1]] / idx[ms[0]] - 1
    print(f"{nm:18s} {ms[0]}~{ms[-1][2:]} {(r1/r0-1)*100:+11.0f}% {cum / r0 * 100:19.0f}% {tot*100:+6.0f}% {cum / r0 / yrs * 100:7.1f}%  | 지수 총수익 {ix_tot*100:+.0f}% (지수 분배 약 연 2.3%)")
