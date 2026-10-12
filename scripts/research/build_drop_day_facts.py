# -*- coding: utf-8 -*-
"""
하락일 설명 카드용 기초 수치 (2026-10-12). 예측이 아니라 '설명·빈도' 수치다. 매매 규칙에 쓰지 않는다.

1) 빈도: 코스피 하루 하락폭별 연평균 발생 횟수 (전체 1997~, 최근 10년 2016~)
2) 간밤 미국 영향: 코스피 당일 수익률 = a + b × (직전 미국 거래일 S&P500 수익률). 구간별 b·R²
   — R²가 '하루 등락 중 간밤 미국으로 설명되는 비율'의 근사치
3) 큰 하락 뒤: 하락일 종가에서 20·60·250거래일 뒤 수익률 중앙값과 플러스 비율 (독립 사건 = 20거래일 간격)

실행: python scripts/research/build_drop_day_facts.py
"""
import sys, json
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
END = "20260930"  # 월말 고정(재실행 시 같은 숫자)


def load_pairs(path, col=1):
    raw = json.load(open(path, encoding="utf-8"))
    rows = raw.items() if isinstance(raw, dict) else raw
    return {r[0]: r[col] for r in rows} if not isinstance(raw, dict) else dict(rows)


kospi = load_pairs(C + "kospi.json")
spx = {r[0]: r[2] for r in json.load(open(C + "allweather/us__GSPC.json", encoding="utf-8"))}
kd = sorted(d for d in kospi if d <= END)
K = np.array([kospi[d] for d in kd], float)
kr = K[1:] / K[:-1] - 1
kr_dates = kd[1:]

# 1) 빈도
print("[1] 코스피 하루 하락 빈도 (연평균 횟수)")
for label, start in (("1997~", "19970101"), ("2016~", "20160101")):
    sel = np.array([d >= start for d in kr_dates])
    years = sel.sum() / 250
    parts = [f"≤{t}%: {((kr[sel] <= t / 100).sum() / years):.1f}회" for t in (-1, -1.5, -2, -3, -5)]
    print(f"  {label} ({years:.1f}년): " + ", ".join(parts))

# 2) 간밤 미국 영향 (KR 날짜 d에 대해 d보다 이른 마지막 미국 거래일의 수익률)
sd = sorted(spx)
S = np.array([spx[d] for d in sd], float)
sr = dict(zip(sd[1:], S[1:] / S[:-1] - 1))
sd_ret = sd[1:]
j, xs, ys, ds = 0, [], [], []
for d, r in zip(kr_dates, kr):
    while j + 1 < len(sd_ret) and sd_ret[j + 1] < d:
        j += 1
    if sd_ret[j] < d:
        xs.append(sr[sd_ret[j]]); ys.append(r); ds.append(d)
xs, ys = np.array(xs), np.array(ys)
print("\n[2] 코스피 당일 = a + b × 간밤 S&P500")
for label, lo, hi in (("2006~2015", "20060101", "20160101"), ("2016~2026-09", "20160101", "20991231"), ("2021~2026-09", "20210101", "20991231")):
    m = np.array([lo <= d < hi for d in ds])
    x, y = xs[m], ys[m]
    b, a = np.polyfit(x, y, 1)
    r2 = np.corrcoef(x, y)[0, 1] ** 2
    big = y <= -0.02
    share = np.median(np.clip(b * x[big] / y[big], -1, 2)) if big.any() else np.nan
    print(f"  {label}: b={b:.2f}, R²={r2:.2f}, 표본 {m.sum()}일 | 코스피 −2% 이하인 날 {big.sum()}일, 그날 간밤 미국 몫 중앙 {share*100:.0f}%")

# 3) 큰 하락 뒤
print("\n[3] 큰 하락일 뒤 코스피 (독립 사건, 20거래일 간격)")
for label, start in (("1997~", "19970101"), ("2016~", "20160101")):
    for t in (-2, -3, -5):
        ev, last = [], -999
        for i, (d, r) in enumerate(zip(kr_dates, kr)):
            if d >= start and r <= t / 100:
                if i - last > 20:
                    ev.append(i + 1)  # K 인덱스(하락일 종가)
                last = i
        out = []
        for h in (20, 60, 250):
            v = np.array([K[e + h] / K[e] - 1 for e in ev if e + h < len(K)])
            out.append(f"{h}일 뒤 중앙 {np.median(v)*100:+.1f}%·플러스 {(v>0).mean()*100:.0f}%({len(v)})")
        print(f"  {label} ≤{t}%: 사건 {len(ev)}건 | " + " | ".join(out))


# ---- 웹 데이터 파일 (web/src/data/dropDayFacts.ts) ----
def further(i, h=60):
    """K 인덱스 i 종가 대비 이후 h거래일 최저 종가까지의 하락률"""
    return K[i + 1:i + h + 1].min() / K[i] - 1


def event_stats(days_k):
    """K 인덱스 목록(오래된 순) → 20거래일 간격 독립 사건의 3개월 안 추가 하락 비율·1년 뒤 수익"""
    ev, last = [], -999
    for i in days_k:
        if i - last > 20:
            ev.append(i)
        last = i
    f = np.array([further(e) for e in ev if e + 60 < len(K)])
    v = np.array([K[e + 250] / K[e] - 1 for e in ev if e + 250 < len(K)])
    return {
        "events": len(ev),
        "further60": {"down5Pct": int(round((f <= -0.05).mean() * 100)), "down10Pct": int(round((f <= -0.10).mean() * 100))},
        "h250": {"n": int(len(v)), "medianPct": round(float(np.median(v) * 100), 1), "upPct": int(round((v > 0).mean() * 100))},
    }


def build_rally_facts(years):
    """급등일(+3% 이상)·52주 신고가 날. 오를 때 몰아서 사고 싶은 순간에 보여 줄 수치"""
    up = [i + 1 for i, (d, r) in enumerate(zip(kr_dates, kr)) if d >= "19970101" and r >= 0.03]
    hi = [j for j in range(250, len(K)) if kd[j] >= "19970101" and K[j] >= K[j - 250:j].max()]
    base_days = [j for j in range(len(K)) if kd[j] >= "19970101"]
    v = np.array([K[j + 250] / K[j] - 1 for j in base_days if j + 250 < len(K)])
    return {
        "surge": {"threshold": 3, "perYear": round(len(up) / years, 1), **event_stats(up)},
        "newHigh": {"perYear": round(len(hi) / years, 1), **event_stats(hi)},
        # 평소 아무 날 1년 뒤(겹치는 창 전체, 사건 단위 아님)
        "baseH250": {"medianPct": round(float(np.median(v) * 100), 1), "upPct": int(round((v > 0).mean() * 100))},
    }


def build_web_facts():
    sel = np.array([d >= "19970101" for d in kr_dates])
    years = sel.sum() / 250
    buckets = []
    for t in (-1.5, -2, -3, -5):
        ev, last = [], -999
        for i, (d, r) in enumerate(zip(kr_dates, kr)):
            if d >= "19970101" and r <= t / 100:
                if i - last > 20:
                    ev.append(i + 1)
                last = i
        row = {"threshold": t, "perYear": round(float((kr[sel] <= t / 100).sum() / years), 1), "events": len(ev)}
        for h in (60, 250):
            v = np.array([K[e + h] / K[e] - 1 for e in ev if e + h < len(K)])
            row[f"h{h}"] = {"n": int(len(v)), "medianPct": round(float(np.median(v) * 100), 1), "upPct": int(round((v > 0).mean() * 100))}
        # 바닥은 모른다: 하락일 종가에서 이후 60거래일 안에 추가로 더 빠진 비율
        f = np.array([further(e) for e in ev if e + 60 < len(K)])
        row["further60"] = {"down5Pct": int(round((f <= -0.05).mean() * 100)), "down10Pct": int(round((f <= -0.10).mean() * 100))}
        buckets.append(row)
    base = np.array([further(i) for i in range(len(K) - 60) if kd[i] >= "19970101"])
    base_further = {"down5Pct": int(round((base <= -0.05).mean() * 100)), "down10Pct": int(round((base <= -0.10).mean() * 100))}
    m = np.array([d >= "20160101" for d in ds])
    b, _a = np.polyfit(xs[m], ys[m], 1)
    r2 = float(np.corrcoef(xs[m], ys[m])[0, 1] ** 2)
    facts = {
        "period": f"{kr_dates[0][:4]}-{kr_dates[0][4:6]}~{END[:4]}-{END[4:6]}",
        "buckets": buckets,
        "baseFurther60": base_further,
        "rally": build_rally_facts(years),
        "us": {"period": f"2016-01~{END[:4]}-{END[4:6]}", "beta": round(float(b), 2), "r2Pct": int(round(r2 * 100))},
    }
    from datetime import date
    meta = {
        "title": "코스피 큰 하락·급등일 빈도·이후 흐름",
        "asOf": f"{END[:4]}-{END[4:6]}",
        "generated": date.today().isoformat(),
        "script": "scripts/research/build_drop_day_facts.py",
        "sample": f"코스피 종가 {facts['period']}(배당 제외), 큰 하락·급등·신고가 뒤 수익은 20거래일 안에 다시 난 같은 날을 한 번으로 센 독립 사건",
        "caveat": "과거 평균일 뿐 이번에도 같다는 뜻이 아님. 약 3번 중 1번은 1년 뒤에도 마이너스. 미국 몫은 간밤 S&P500 하나로만 본 근사(장중 선물·아시아 시장은 반영 안 됨). 추가 하락 비율은 평소 아무 날과 큰 차이가 없고(−3% 이하만 다소 높음), 2016년 이후로는 그 차이도 없음. +3% 급등일은 뒤에 흔들림이 평소보다 컸고(급등은 변동성이 큰 시기의 신호), 52주 신고가 날은 평소보다 나빴던 적이 없음 — 오를 때 몰아 사는 근거도, 고점이라 피하는 근거도 없음. 1997~98 외환위기 반등을 빼면 급등일 1년 뒤 수치는 더 좋아짐(표본 민감)",
    }
    out = "web/src/data/dropDayFacts.ts"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("// 자동 생성 — scripts/research/build_drop_day_facts.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n")
        f.write("import type { FactMeta } from './researchFacts'\n")
        f.write(f"export const DROP_DAY_FACTS = {json.dumps(facts, ensure_ascii=False)} as const\n")
        f.write(f"export const DROP_DAY_META: FactMeta = {json.dumps(meta, ensure_ascii=False, indent=2)}\n")
    print(f"\n→ {out} 생성")


build_web_facts()
