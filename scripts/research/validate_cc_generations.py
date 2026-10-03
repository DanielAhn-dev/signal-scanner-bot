# -*- coding: utf-8 -*-
"""
커버드콜 '세대'별 비교 (2026-10-03) — 앞선 점검이 1세대형(지수 전체에 옵션을 파는 월물)에 한정됐다는 지적에 대한 확인.
세대 구분은 상품명으로 추정한 분류이며 운용사 설명서로 확인한 것이 아니다(미확인):
  1세대: 옵션을 지수 100%에 월물로 판매 — TIGER200커버드콜(289480), RISE200고배당커버드콜ATM(290080), TIGER미국나스닥100커버드콜(합성)(441680)
  2세대: 주간 옵션·타겟 커버율(일부만 커버) — RISE200위클리커버드콜(475720), KODEX200타겟위클리커버드콜(498400)
  3세대: 데일리·OTM — TIGER미국S&P500타겟데일리커버드콜(482730), TIGER미국나스닥100타겟데일리커버드콜(486290), KODEX미국나스닥100데일리커버드콜OTM(494300)
지표(같은 기간 기초지수 대비): 총수익, 최대낙폭, 상승월 포착률(지수가 오른 달 평균 수익 ÷ 지수 평균 수익), 하락월 포착률(지수가 내린 달).
하락월 포착률이 낮을수록 하락 방어, 상승월 포착률이 높을수록 상승 참여. 기초지수: 코스피200=KODEX200, 나스닥100·S&P500은 원화 환산(web/src/data/mixData.ts).
한계: 3세대는 상장 1~2년이라 하락장 경험이 짧고 대부분 강세장이다. 환헤지 여부는 이름에서 추정(미확인).
"""
import json, sys
import numpy as np
sys.path.insert(0, "scripts/research")
from validate_income_then_growth import monthly  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
mix = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(txt[txt.index("= [{") + 2: txt.rindex("]") + 1])}
bench = {"kospi200": monthly(".research-cache/index_etfs/px_069500.json"), "nasdaq100": mix["nasdaq100"], "sp500": mix["sp500"]}
PRODUCTS = [("289480", "TIGER200CC", 1, "kospi200"), ("290080", "RISE200고배당CC ATM", 1, "kospi200"), ("441680", "TIGER나스닥100CC(합성)", 1, "nasdaq100"),
            ("475720", "RISE200위클리CC", 2, "kospi200"), ("498400", "KODEX200타겟위클리CC", 2, "kospi200"),
            ("482730", "TIGER S&P500 타겟데일리CC", 3, "sp500"), ("486290", "TIGER나스닥100 타겟데일리CC", 3, "nasdaq100"), ("494300", "KODEX나스닥100 데일리CC OTM", 3, "nasdaq100")]
def load(code):
    for d in (".research-cache/dividend_etfs", ".research-cache"):
        try: return monthly(f"{d}/px_{code}.json")
        except FileNotFoundError: pass
    return None
print(f"{'세대':>3s} {'상품':28s} {'기간':>14s} {'총수익':>7s} {'지수':>7s} {'최대낙폭':>8s} {'지수낙폭':>8s} {'상승포착':>7s} {'하락포착':>7s} {'하락월 수':>8s}")
rows = []
for code, name, gen, bk in PRODUCTS:
    px = load(code)
    if not px: print(code, "가격 없음"); continue
    b = bench[bk]
    ms = [m for m in sorted(px) if m in b]
    if len(ms) < 13: print(code, name, "공통 기간 짧음", len(ms)); continue
    rp = np.array([px[ms[i]] / px[ms[i-1]] - 1 for i in range(1, len(ms))])
    rb = np.array([b[ms[i]] / b[ms[i-1]] - 1 for i in range(1, len(ms))])
    def mdd(r):
        p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]; return (p / pk - 1).min() * 100
    up, dn = rb > 0, rb < 0
    upc = rp[up].mean() / rb[up].mean() * 100 if up.any() else float('nan')
    dnc = rp[dn].mean() / rb[dn].mean() * 100 if dn.any() else float('nan')
    print(f"{gen:>3d} {name:28s} {ms[0]}~{ms[-1][2:]} {(np.prod(1+rp)-1)*100:+6.0f}% {(np.prod(1+rb)-1)*100:+6.0f}% {mdd(rp):7.1f}% {mdd(rb):7.1f}% {upc:6.0f}% {dnc:6.0f}% {int(dn.sum()):>8d}")
