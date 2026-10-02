# -*- coding: utf-8 -*-
"""
웹 '섞어보기' 화면용 정적 데이터 생성 (web/src/data/mixData.ts).

입력: .research-cache/allweather/ (fetch_allweather_data.py 결과) + .research-cache/px_069500.json
출력: 자산별 월말 가격(원화, 분배금 반영 총수익) 시계열.
  - 한국 상장 ETF(네이버 수정주가): 코스피200 KODEX200, 나스닥100 TIGER, 국고채10년 KIWOOM, 금 KODEX골드선물(H)
  - 미국 원지수 ETF(SPY·TLT, 야후 수정종가 × 원/달러): 한국 상장 상품이 짧아 원지수로 장기 이력을 보충.
    한국 상장 상품은 같은 지수를 따라가도 원본보다 연 약 0.7~0.9%p 낮게 나왔다(TIGER 나스닥100 vs QQQ 2010~, TIGER S&P500 vs SPY 2020~)
    → dragPct로 화면 계산에서 차감한다.
미완성 달은 뺀다(야후 마지막 일자가 월말이 아니면 그 달 제외).
갱신: python scripts/research/fetch_allweather_data.py && python scripts/research/build_mix_data.py
"""
import json

D = ".research-cache/allweather/"
OUT = "web/src/data/mixData.ts"


def load(path, col=1):
    return sorted([r[0], r[col]] for r in json.load(open(path, encoding="utf-8")))


def monthly(rows):
    by = {}
    for d, v in rows:
        by[d[:6]] = (d, float(v))
    return by


fx = load(D + "us_KRW_X.json", 2)
fxd = [d for d, _ in fx]


def fx_at(d):
    lo, hi = 0, len(fx) - 1
    if d < fxd[0]:
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fxd[mid] <= d:
            lo = mid
        else:
            hi = mid - 1
    return fx[lo][1]


def us_krw(sym):
    rows = []
    for d, v in load(D + f"us_{sym}.json", 1):
        f = fx_at(d)
        if f:
            rows.append([d, v * f])
    return rows


ASSETS = [
    # id, 이름, 설명, 원천 행, dragPct(원본 대비 한국 상장 격차)
    ("kospi200", "코스피200", "KODEX 200", load(".research-cache/px_069500.json"), 0.0),
    ("nasdaq100", "미국 나스닥100", "TIGER 미국나스닥100", load(D + "kr_133690.json"), 0.0),
    ("sp500", "미국 S&P500", "SPY 원화 환산(한국 상장은 2020~)", us_krw("SPY"), 0.9),
    ("kbond10", "한국 국고채10년", "KIWOOM 국고채10년", load(D + "kr_148070.json"), 0.0),
    ("usbond20", "미국 장기채(20년+)", "TLT 원화 환산(한국 상장은 2018~, 환헤지 상품 많음)", us_krw("TLT"), 0.9),
    ("gold", "금", "KODEX 골드선물(H)", load(D + "kr_132030.json"), 0.0),
]

series, last_ok = {}, None
for aid, name, src, rows, drag in ASSETS:
    m = monthly(rows)
    series[aid] = m
# 마지막 달: 어느 자산이든 마지막 일자가 25일 이전이면 그 달은 미완성
all_last = min(max(m.values())[0] for m in series.values())
cut = all_last[:6] if all_last[6:8] >= "25" else str(int(all_last[:6]) - 1 if all_last[4:6] != "01" else int(all_last[:4]) * 100 - 88)
out = []
for aid, name, src, rows, drag in ASSETS:
    pts = [[ym, round(v, 4)] for ym, (d, v) in sorted(series[aid].items()) if ym <= cut]
    out.append({"id": aid, "name": name, "source": src, "dragPct": drag, "first": pts[0][0], "monthly": pts})

body = (
    "// 자동 생성 — scripts/research/build_mix_data.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "export type MixAsset = {\n  id: string; name: string; source: string; dragPct: number; first: string\n"
    "  /** [YYYYMM, 원화 환산 월말 수정주가(분배금 반영)] */\n  monthly: Array<[string, number]>\n}\n\n"
    f"export const MIX_ASOF = '{cut[:4]}-{cut[4:]}'\n\n"
    f"export const MIX_ASSETS: MixAsset[] = {json.dumps(out, ensure_ascii=False)}\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print(OUT, cut, [(a['id'], a['first'], len(a['monthly'])) for a in out])
