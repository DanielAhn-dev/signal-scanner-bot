# -*- coding: utf-8 -*-
"""
모아가기 3번 '앞으로 10년 경우의 수' 재료 생성 (web/src/data/futureMaterial.ts).

예측이 아니다. 과거 실제 달의 수익률(원화, 분배금 반영)을 재료로 두고, 화면 계산(web/src/lib/futurePaths.ts)이
그 달들을 1년 덩어리로 무작위로 이어 붙여 경우의 수를 만든다. 같은 달의 세 지수를 함께 뽑으므로 위기 때 같이 빠지는 관계가 남는다.

재료 (월말 기준, 원화, 해마다 빠지는 몫 반영):
  - 코스피200: KODEX 200 수정주가(분배금 반영, 2002-10~). 그 이전(1999-04~2002-10)은 코스피 종합 가격지수에
    2002-11~ 두 이력의 연 차이(배당 몫 근사)를 더한 근사.
  - S&P500: SPY 수정종가 × 원/달러(한국은행 ECOS 매매기준율), 연 0.9%p 차감(한국 상장 상품과의 격차, build_mix_data.py와 같은 값).
  - 나스닥100: QQQ 수정종가 × 원/달러, 연 0.9%p 차감. QQQ가 1999-03부터라 재료 시작은 1999-04.
사건(실제 경로를 그대로 끼워 넣기): 재료 안의 구간을 그대로 쓴다. '일본처럼'만 닛케이(엔화 가격지수, 배당 제외)를 세 지수에 똑같이 적용한 가정이다.
반례(살아남은 시장만 보면 안 되는 이유): 현지 통화 가격지수로 고점 → 그 값을 다시 넘은 달, 그 고점부터 10년 매달 모았다면 넣은 돈 대비.

입력: .research-cache/px_069500.json, kospi.json, allweather/us_SPY.json·us_QQQ.json·us__GSPC.json,
      longrun/krw_usd_ecos.json(fetch_krw_usd_ecos.py), macro_leading/indices.json(닛케이, fetch_macro_leading.py)
갱신: python scripts/research/fetch_krw_usd_ecos.py && python scripts/research/build_future_paths_data.py
"""
import json
import math
from datetime import date

OUT = "web/src/data/futureMaterial.ts"
DRAG = {"kospi200": 0.0, "sp500": 0.9, "nasdaq100": 0.9}
START = "199904"  # 첫 수익률 달(QQQ 첫 월말 1999-03 → 다음 달)


def load(path, col=1):
    return sorted((r[0], float(r[col])) for r in json.load(open(path, encoding="utf-8")))


def month_end(rows):
    """[(YYYYMMDD, v)] → {YYYYMM: (마지막 날짜, v)}"""
    by = {}
    for d, v in rows:
        by[d[:6]] = (d, v)
    return by


def prev_ym(ym):
    y, m = int(ym[:4]), int(ym[4:])
    return f"{y - 1}12" if m == 1 else f"{y}{m - 1:02d}"


def next_ym(ym):
    y, m = int(ym[:4]), int(ym[4:])
    return f"{y + 1}01" if m == 12 else f"{y}{m + 1:02d}"


def ym_range(a, b):
    out = [a]
    while out[-1] < b:
        out.append(next_ym(out[-1]))
    return out


fx = load(".research-cache/longrun/krw_usd_ecos.json")
fxd = [d for d, _ in fx]


def fx_at(d):
    lo, hi = 0, len(fx) - 1
    if d < fxd[0]:
        raise SystemExit(f"원/달러 이력 시작({fxd[0]})보다 이른 날짜 {d}")
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fxd[mid] <= d:
            lo = mid
        else:
            hi = mid - 1
    return fx[lo][1]


def krw_month_end(path):
    return {ym: (d, v * fx_at(d)) for ym, (d, v) in month_end(load(path, 1)).items() if d >= fxd[0]}


kodex = month_end(load(".research-cache/px_069500.json"))
kospi = month_end(load(".research-cache/kospi.json"))
spy = krw_month_end(".research-cache/allweather/us_SPY.json")
qqq = krw_month_end(".research-cache/allweather/us_QQQ.json")

# 마지막 완성 달: 모든 원천의 마지막 날짜가 그달 25일 이후여야 그달을 쓴다
last_days = [max(s.values())[0] for s in (kodex, kospi, spy, qqq)]
last = min(last_days)
END = last[:6] if last[6:8] >= "25" else prev_ym(last[:6])
months = ym_range(START, END)


def ret(series, ym):
    a, b = series.get(prev_ym(ym)), series.get(ym)
    if not a or not b:
        return None
    return b[1] / a[1] - 1


# 코스피200 2002-10 이전 근사: 두 이력이 겹치는 기간(2002-11~)의 연 로그 차이
kodex_first = min(kodex)  # 첫 달(10월 중순 시작) — 그 달 월말부터 수익률 계산 가능
overlap = [ym for ym in ym_range(next_ym(kodex_first), END)]
log_gap = sum(math.log(1 + ret(kodex, ym)) - math.log(1 + ret(kospi, ym)) for ym in overlap)
gap_m = math.exp(log_gap / len(overlap)) - 1
gap_y = (1 + gap_m) ** 12 - 1

returns = {"kospi200": [], "sp500": [], "nasdaq100": []}
for ym in months:
    k = ret(kodex, ym)
    if k is None:
        k = (1 + ret(kospi, ym)) * (1 + gap_m) - 1
    s, q = ret(spy, ym), ret(qqq, ym)
    if s is None or q is None:
        raise SystemExit(f"{ym} 해외 수익률 없음")
    returns["kospi200"].append(k)
    returns["sp500"].append((1 + s) * (1 - DRAG["sp500"] / 100 / 12) - 1)
    returns["nasdaq100"].append((1 + q) * (1 - DRAG["nasdaq100"] / 100 / 12) - 1)


def slice_months(a, b):
    i, j = months.index(a), months.index(b)
    return {k: v[i:j + 1] for k, v in returns.items()}


# 닛케이(엔화 가격지수) — 월 값
jpn = json.load(open(".research-cache/macro_leading/indices.json", encoding="utf-8"))["JPN"]
jpn_months = ym_range("199001", "199912")
jpn_ret = [jpn[ym] / jpn[prev_ym(ym)] - 1 for ym in jpn_months]

EVENTS = [
    ("gfc", "금융위기", "200711", "200912", "2007-11~2009-12 실제 경로(세 지수 함께). 원화가 크게 약해져 해외 지수 손실이 원화로는 달러보다 작았다"),
    ("covid", "코로나 급락·급반등", "202002", "202012", "2020-02~2020-12 실제 경로"),
    ("rate2022", "2022 금리 급등", "202201", "202212", "2022-01~2022-12 실제 경로"),
    ("tariff2025", "2025 관세 충격", "202502", "202506", "2025-02~2025-06 실제 경로"),
    ("dotcom", "닷컴 거품 붕괴 (AI 거품 비유)", "200004", "200209", "2000-04~2002-09 실제 경로, 나스닥100이 가장 크게 빠졌다"),
    ("kospiBox", "코스피 10년 박스권", "201101", "202012", "2011~2020 실제 경로 — 같은 기간 미국은 올랐다"),
]
events = []
for key, label, a, b, note in EVENTS:
    events.append({"key": key, "label": label, "from": a, "to": b, "note": note, "assumed": False,
                   "returns": {k: [round(x, 5) for x in v] for k, v in slice_months(a, b).items()}})


def trough_pct(rs):
    """한 번에 넣었을 때 사건 안에서 가장 깊었던 손실(%)"""
    v, low = 1.0, 1.0
    for x in rs:
        v *= 1 + x
        low = min(low, v)
    return round((low - 1) * 100, 1)
events.append({"key": "japan", "label": "일본처럼 10년 하락·정체", "from": "199001", "to": "199912",
               "note": "닛케이 1990~1999(엔화 가격지수, 배당 제외)를 세 지수에 똑같이 적용 — 세 시장이 한꺼번에 이렇게 된 적은 없는 가정",
               "assumed": True, "returns": {k: [round(x, 5) for x in jpn_ret] for k in returns}})
for e in events:
    e["troughPct"] = {k: trough_pct(v) for k, v in e["returns"].items()}
    e["endPct"] = {k: round((math.prod(1 + x for x in v) - 1) * 100, 1) for k, v in e["returns"].items()}


def dca_ratio(prices):
    """매달 초 1씩 넣고 마지막 달 값 / 넣은 돈"""
    units = sum(1 / p for p in prices[:-1])
    return units * prices[-1] / (len(prices) - 1)


def stagnation(key, label, by_ym, peak_from, peak_to, currency):
    yms = sorted(by_ym)
    window = [ym for ym in yms if peak_from <= ym <= peak_to]
    peak = max(window, key=lambda ym: by_ym[ym])
    after = [ym for ym in yms if ym > peak]
    rec = next((ym for ym in after if by_ym[ym] > by_ym[peak]), None)
    # 처음 넘은 뒤 다시 밑으로 내려간 적이 있으면(S&P500 2007 → 2008) 그 뒤로 계속 위에 머문 첫 달을 따로 본다
    below = [ym for ym in after if by_ym[ym] <= by_ym[peak]]
    stayed = next_ym(below[-1]) if below and below[-1] < yms[-1] else None

    def gap(ym):
        return round((int(ym[:4]) * 12 + int(ym[4:]) - int(peak[:4]) * 12 - int(peak[4:])) / 12, 1) if ym else None

    ten = [ym for ym in yms if ym >= peak][:121]
    return {"key": key, "label": label, "peak": peak, "recovered": rec, "years": gap(rec), "stayed": stayed, "stayedYears": gap(stayed),
            "dca10": round(dca_ratio([by_ym[ym] for ym in ten]), 3) if len(ten) == 121 else None,
            "basis": f"{currency} 가격지수(배당 제외), 월말"}


kospi_m = {ym: v for ym, (_, v) in kospi.items()}
gspc_m = {ym: v for ym, (_, v) in month_end(load(".research-cache/allweather/us__GSPC.json")).items()}
facts = [
    stagnation("japan", "일본 닛케이", jpn, "198901", "199012", "엔화"),
    stagnation("kospi", "코스피", kospi_m, "201101", "201112", "원화"),
    stagnation("sp500", "미국 S&P500", gspc_m, "200001", "200012", "달러"),
]

material = {
    "from": months[0], "to": months[-1], "months": len(months), "dragPct": DRAG,
    "kospiGapPct": round(gap_y * 100, 2),
    "returns": {k: [round(x, 5) for x in v] for k, v in returns.items()},
}
body = (
    "// 자동 생성 — scripts/research/build_future_paths_data.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "import type { MixIndex } from '../lib/planMix'\n\n"
    "export type FutureEvent = {\n  key: string; label: string; from: string; to: string; note: string\n"
    "  /** true면 실제로 함께 일어난 적 없는 가정(일본 경로를 세 지수에 적용) */\n  assumed: boolean\n"
    "  /** 월 수익률(원화, 소수) */\n  returns: Record<MixIndex, number[]>\n"
    "  /** 한 번에 넣었을 때 사건 안 가장 깊은 손실·끝 수익(%) */\n  troughPct: Record<MixIndex, number>; endPct: Record<MixIndex, number>\n}\n\n"
    "export type StagnationFact = { key: string; label: string; peak: string; recovered: string | null; years: number | null\n"
    "  /** 처음 넘은 뒤 다시 밑으로 내려갔으면, 그 뒤로 계속 위에 머문 첫 달 */\n  stayed: string | null; stayedYears: number | null\n"
    "  /** 그 고점 달부터 10년 매달 모았다면 끝 평가금 / 넣은 돈 */\n  dca10: number | null; basis: string }\n\n"
    f"export const FUTURE_GENERATED = '{date.today().isoformat()}'\n\n"
    "/** 재료: 첫·끝 수익률 달(YYYYMM), 해외 연 차감(%p), 2002-10 이전 코스피200 근사에 더한 연 차이(%), 월 수익률 */\n"
    f"export const FUTURE_MATERIAL: {{ from: string; to: string; months: number; dragPct: Record<MixIndex, number>; kospiGapPct: number; returns: Record<MixIndex, number[]> }} = {json.dumps(material, ensure_ascii=False)}\n\n"
    f"export const FUTURE_EVENTS: FutureEvent[] = {json.dumps(events, ensure_ascii=False)}\n\n"
    f"export const STAGNATION_FACTS: StagnationFact[] = {json.dumps(facts, ensure_ascii=False)}\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print(OUT, material["from"], "~", material["to"], len(months), "개월, 코스피200 근사 연 차이", material["kospiGapPct"], "%")
for e in events:
    print(" 사건", e["key"], e["from"], e["to"], "가장 깊을 때", e["troughPct"], "끝", e["endPct"])
for f in facts:
    print(" 반례", f)
