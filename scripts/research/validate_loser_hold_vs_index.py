# -*- coding: utf-8 -*-
"""
H61 평단보다 크게 내린 개별주: 계속 보유 vs 그날 지수(KODEX 200)로 옮기기 (2026-10-20).

판정 기준은 docs/hypothesis-ledger.md H61 행에 결과 보기 전에 고정했다. 여기서는 그대로 계산만 한다.
데이터: .research-cache/px.pkl (네이버 수정주가, 상장폐지 포함), .research-cache/px_069500.json (KODEX 200 수정주가)
표본: 분기말(2015-03~2025-06) 직전 20일 평균 거래대금 상위 300 종목을 그날 종가에 샀다고 본다(스팩 제외).
      이후 250거래일 안에 매수가 대비 처음 −15%(−30%) 이하가 된 날 = '손실 중' 시점.
비교: 그날부터 250·500거래일 계속 보유(상장폐지면 마지막 가격) vs 지수로 옮김(전환 비용 0.25%: 거래세 0.20% + 수수료).
한계: 같은 종목이 여러 분기에 겹쳐 들어가 표본이 독립이 아니다(구간별로 나눠 본다). 거래대금 상위 300은 개인이 많이 사는 종목의 근사.
      KODEX 200 수정주가는 분배금이 반영돼 지수 쪽이 배당만큼 유리하고, 개별주 수정주가도 배당락 보정이 돼 있어 대체로 같은 기준이다.
"""
import bisect
import json
import pickle
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE = ".research-cache"
COST = 0.0025
px = pickle.load(open(f"{CACHE}/px.pkl", "rb"))
corps = json.load(open(f"{CACHE}/corps.json", encoding="utf-8"))
spac = {c[2] for c in corps if "스팩" in c[1] or "기업인수목적" in c[1]}
idx_rows = json.load(open(f"{CACHE}/px_069500.json"))
idx_dates = [r[0] for r in idx_rows]
idx_close = np.array([r[1] for r in idx_rows], float)


def idx_at(d):
    k = bisect.bisect_right(idx_dates, d) - 1
    return idx_close[k] if k >= 0 else None


all_dates = sorted({r[0] for v in px.values() for r in v})
last_common = min(all_dates[-1], idx_dates[-1])
all_dates = [d for d in all_dates if d <= last_common]
didx = {d: i for i, d in enumerate(all_dates)}

qends = []
for y in range(2015, 2026):
    for m in ("03", "06", "09", "12"):
        if (y, m) > (2025, "06"):
            continue
        ds = [d for d in all_dates if d.startswith(f"{y}{m}")]
        if ds:
            qends.append(ds[-1])

series = {}
for code, rows in px.items():
    if not rows or code in spac:
        continue
    rows = [r for r in rows if r[4] and r[4] > 0 and r[0] <= last_common]
    if len(rows) < 30:
        continue
    series[code] = ([r[0] for r in rows], np.array([r[4] for r in rows], float), np.array([r[4] * r[5] for r in rows], float))


def price_at_or_before(dates, closes, d):
    k = bisect.bisect_right(dates, d) - 1
    return (k, closes[k]) if k >= 0 else (None, None)


events = {15: [], 30: []}
for q in qends:
    cands = []
    for code, (dates, closes, tv) in series.items():
        k = bisect.bisect_right(dates, q) - 1
        if k < 19 or dates[k] != q:
            continue
        cands.append((tv[k - 19:k + 1].mean(), code, k))
    for _, code, k in sorted(cands, reverse=True)[:300]:
        dates, closes, _ = series[code]
        entry = closes[k]
        qi = didx[q]
        end_d = all_dates[min(qi + 250, len(all_dates) - 1)]
        for th in (15, 30):
            for j in range(k + 1, len(dates)):
                if dates[j] > end_d:
                    break
                if closes[j] / entry - 1 <= -th / 100:
                    events[th].append((q, code, j, entry))
                    break


def evaluate(th, horizon):
    out = []
    for q, code, j, entry in events[th]:
        dates, closes, _ = series[code]
        t0 = dates[j]
        ti = didx.get(t0)
        if ti is None or ti + horizon >= len(all_dates):
            continue
        t1 = all_dates[ti + horizon]
        k1, p1 = price_at_or_before(dates, closes, t1)
        i0, i1 = idx_at(t0), idx_at(t1)
        if not i0 or not i1:
            continue
        hold = p1 / closes[j] - 1
        switch = (1 - COST) * i1 / i0 - 1
        # 매수가 회복: 보유는 기간 중 종가가 매수가 이상인 날이 있었나, 옮김은 그 가치가 매수가 이상이 된 날이 있었나
        seg = closes[j:k1 + 1]
        hold_rec = bool((seg >= entry).any())
        a, b = bisect.bisect_left(idx_dates, t0), bisect.bisect_right(idx_dates, t1)
        sw_val = closes[j] * (1 - COST) * idx_close[a:b] / i0
        sw_rec = bool((sw_val >= entry).any())
        out.append(dict(q=q, hold=hold, switch=switch, diff=hold - switch, hold_rec=hold_rec, sw_rec=sw_rec,
                        hold_deep=hold <= -0.30, sw_deep=switch <= -0.30))
    return out


def report(th, horizon):
    r = evaluate(th, horizon)
    if not r:
        print(f"−{th}% · {horizon}일: 표본 없음")
        return None
    d = np.array([x["diff"] for x in r])
    front = np.array([x["diff"] for x in r if x["q"] < "20200101"])
    back = np.array([x["diff"] for x in r if x["q"] >= "20200101"])
    hold = np.array([x["hold"] for x in r])
    sw = np.array([x["switch"] for x in r])
    print(f"\n== 매수가 대비 −{th}% 시점부터 {horizon}거래일 (건 {len(r):,}) ==")
    print(f"  보유 수익  중앙 {np.median(hold)*100:+6.1f}%  평균 {hold.mean()*100:+6.1f}%  하위10% {np.percentile(hold,10)*100:+6.1f}%")
    print(f"  지수 옮김  중앙 {np.median(sw)*100:+6.1f}%  평균 {sw.mean()*100:+6.1f}%  하위10% {np.percentile(sw,10)*100:+6.1f}%")
    print(f"  보유−옮김  중앙 {np.median(d)*100:+6.1f}%p (앞 15~19 {np.median(front)*100:+6.1f}%p {len(front)}건 · 뒤 20~25 {np.median(back)*100:+6.1f}%p {len(back)}건)  보유가 이긴 비율 {(d>0).mean()*100:4.1f}%")
    print(f"  추가 −30% 이하: 보유 {np.mean([x['hold_deep'] for x in r])*100:4.1f}% vs 옮김 {np.mean([x['sw_deep'] for x in r])*100:4.1f}%")
    print(f"  기간 안 매수가 회복: 보유 {np.mean([x['hold_rec'] for x in r])*100:4.1f}% vs 옮김 {np.mean([x['sw_rec'] for x in r])*100:4.1f}%")
    return dict(front=np.median(front), back=np.median(back),
                hd=np.mean([x['hold_deep'] for x in r]), sd=np.mean([x['sw_deep'] for x in r]))


print(f"분기 {len(qends)}개 ({qends[0]}~{qends[-1]}), −15% 사건 {len(events[15]):,}건, −30% 사건 {len(events[30]):,}건, 데이터 끝 {last_common}")
main = report(15, 250)
report(15, 500)
report(30, 250)
report(30, 500)
if main:
    a = main["front"] <= 0 and main["back"] <= 0
    b = main["hd"] > main["sd"]
    print(f"\n판정(사전 기준, −15%·250일): ⓐ 두 구간 보유−옮김 중앙값 ≤ 0 {a} ⓑ 추가 −30% 보유가 더 잦음 {b} → "
          + ("채택" if a and b else ("ⓐ 실패: '보유도 나쁘지 않다'로 문구만" if b else "기각")))

# 화면용 숫자(web/src/data/loserSwitchFacts.ts) — −15%·250거래일 기준. 손으로 고치지 않는다.
if "--write" in sys.argv:
    import datetime
    r = evaluate(15, 250)
    pre = [x for x in r if x["q"] < "20221001"]  # 측정이 2024년 전에 끝나는 사건(2025~26 급등 제외)
    f = {
        "period": f"{qends[0][:4]}~{qends[-1][:4]}",
        "events": len(r),
        "triggerPct": -15,
        "days": 250,
        "holdMedPct": round(float(np.median([x["hold"] for x in r])) * 100, 1),
        "switchMedPct": round(float(np.median([x["switch"] for x in r])) * 100, 1),
        "holdWinPct": round(float(np.mean([x["diff"] > 0 for x in r])) * 100),
        "holdDeepPct": round(float(np.mean([x["hold_deep"] for x in r])) * 100),
        "switchDeepPct": round(float(np.mean([x["sw_deep"] for x in r])) * 100),
        "holdRecoverPct": round(float(np.mean([x["hold_rec"] for x in r])) * 100),
        "preRallyDiffMedPp": round(float(np.median([x["diff"] for x in pre])) * 100, 1),
        "generatedAt": datetime.date.today().isoformat(),
    }
    out = ("// 생성 파일 — 손으로 고치지 않는다. scripts/research/validate_loser_hold_vs_index.py --write (C69)\n"
           f"export const LOSER_SWITCH_FACTS = {json.dumps(f, ensure_ascii=False)} as const\n")
    open(__file__.rsplit("scripts", 1)[0] + "web/src/data/loserSwitchFacts.ts", "w", encoding="utf-8").write(out)
    print("wrote web/src/data/loserSwitchFacts.ts", f)
