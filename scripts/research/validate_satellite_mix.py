# -*- coding: utf-8 -*-
"""
'재미 슬리브' 비용 점검 (2026-10-03) — 지수를 기본으로 두고 커버드콜 등 인컴 상품을 일부(0/20/40/60/100%)만 섞으면 지수 단독 대비 무엇을 얻고 잃나.
분배금 이력이 있는 2021-12~2026-10 구간(한국 강세장 포함, 4~5년뿐)의 수정주가 월수익률, 월 리밸런싱, 세금·수수료 없음. 표본이 짧아 일반화 금지.
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def monthly(path):
    rows = json.load(open(path, encoding="utf-8")); rows.sort(key=lambda r: r[0])
    d = {}
    for dt, c in rows: d[dt[:6]] = float(c)
    return d

idx = monthly(".research-cache/index_etfs/px_069500.json")
for name, code in (("TIGER200CC", "289480"), ("RISE200ATM", "290080")):
    cc = monthly(f".research-cache/dividend_etfs/px_{code}.json")
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in json.load(open(f".research-cache/div_{code}.json", encoding="utf-8")))
    ms = [m for m in sorted(cc) if m >= first and m in idx]
    ri = np.array([idx[ms[i]] / idx[ms[i-1]] - 1 for i in range(1, len(ms))])
    rc = np.array([cc[ms[i]] / cc[ms[i-1]] - 1 for i in range(1, len(ms))])
    print(f"\n{name} {ms[0]}~{ms[-1]} ({len(ri)}개월)")
    print(f"{'인컴 비중':>8s} {'총수익':>8s} {'최대낙폭':>8s} {'월 변동성':>9s} {'하락월(-5%↓) 수':>14s}")
    for w in (0, 20, 40, 60, 100):
        r = (1 - w / 100) * ri + w / 100 * rc
        path = np.cumprod(1 + r); peak = np.maximum.accumulate(np.concatenate(([1.0], path)))[1:]
        print(f"{w:7d}% {(path[-1]-1)*100:+7.0f}% {((path/peak-1).min())*100:7.1f}% {r.std()*100:8.1f}% {int((r<-0.05).sum()):>14d}")
