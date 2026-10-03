# -*- coding: utf-8 -*-
"""
계획 점검 화면이 보여 주는 연구 숫자를 스크립트가 직접 계산해 web/src/data/researchFacts.ts로 내보낸다 (손으로 옮겨 적지 않는다).
대상: 코스피200 대 S&P500(원화) 비교, 인컴 슬리브 비용. 데이터가 바뀌면 이 스크립트를 다시 돌린다(분기 재검증 때).
나머지 표(감내 낙폭·분할·확인 빈도·인출 실패율)는 각 validate_*.py 출력을 옮긴 것이라 META에 출처 스크립트와 기준 시점을 적는다.
"""
import datetime, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import monthly  # noqa: E402

OUT = "web/src/data/researchFacts.ts"

# --- 코스피200 vs S&P500 (mixData 원화 환산 월말 수정주가)
txt = open("web/src/data/mixData.ts", encoding="utf-8").read()
asof = txt[txt.index("MIX_ASOF = '") + 12: txt.index("MIX_ASOF = '") + 19]
assets = {a["id"]: dict((m, v) for m, v in a["monthly"]) for a in json.loads(txt[txt.index("= [{") + 2: txt.rindex("]") + 1])}
k, u = assets["kospi200"], assets["sp500"]
ms = [m for m in sorted(k) if m in u]
rk = np.array([k[ms[i]] / k[ms[i-1]] - 1 for i in range(1, len(ms))])
ru = np.array([u[ms[i]] / u[ms[i-1]] - 1 for i in range(1, len(ms))])
rm = 0.5 * rk + 0.5 * ru
n = len(rk)

def mdd(r):
    p = np.cumprod(1 + r); pk = np.maximum.accumulate(np.concatenate(([1.0], p)))[1:]
    return float((p / pk - 1).min() * 100)

def hold(H):
    f = lambda r: np.array([np.prod(1 + r[s:s + H]) for s in range(n - H + 1)])
    a, b, c = f(rk), f(ru), f(rm)
    return dict(years=H // 12, starts=len(a), kMed=float(np.median(a)), uMed=float(np.median(b)), mixMed=float(np.median(c)),
                kMin=float(a.min()), uMin=float(b.min()), mixMin=float(c.min()), usWinPct=float((b > a).mean() * 100))

market = dict(period=f"{ms[0][:4]}-{ms[0][4:]}~{ms[-1][:4]}-{ms[-1][4:]}", months=n,
              kCagr=float((np.prod(1 + rk) ** (12 / n) - 1) * 100), uCagr=float((np.prod(1 + ru) ** (12 / n) - 1) * 100),
              corr=float(np.corrcoef(rk, ru)[0, 1]), mdd=dict(k=mdd(rk), u=mdd(ru), mix=mdd(rm)), hold=[hold(60), hold(120)])
y2025 = [i for i, m in enumerate(ms[1:]) if m[:4] == "2025"]
market["kospi2025Pct"] = float((np.prod(1 + rk[y2025]) - 1) * 100) if len(y2025) == 12 else None

# --- 인컴 슬리브 (커버드콜 2종 평균, 한국 강세장)
idx = monthly(".research-cache/index_etfs/px_069500.json")
cc_ratio = {w: [] for w in (0, 20, 40, 60, 100)}
sleeve_periods = []
for code in ("289480", "290080"):
    cc = monthly(f".research-cache/dividend_etfs/px_{code}.json")
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in json.load(open(f".research-cache/div_{code}.json", encoding="utf-8")))
    m2 = [m for m in sorted(cc) if m >= first and m in idx]
    ri = np.array([idx[m2[i]] / idx[m2[i-1]] - 1 for i in range(1, len(m2))])
    rc = np.array([cc[m2[i]] / cc[m2[i-1]] - 1 for i in range(1, len(m2))])
    sleeve_periods.append(f"{m2[0]}~{m2[-1]}")
    base = np.prod(1 + ri)
    for w in cc_ratio:
        cc_ratio[w].append(float(np.prod(1 + (1 - w / 100) * ri + w / 100 * rc) / base * 100))
sleeve = [dict(weight=w, endVsIndexPct=round(float(np.mean(v)))) for w, v in cc_ratio.items()]


# --- 감내 낙폭·분할·확인 빈도·인출 실패율 (각 validate_*.py의 함수를 그대로 호출)
import validate_lump_vs_split_tolerance as vt  # noqa: E402
import validate_checking_frequency as vc  # noqa: E402
import validate_retirement_withdrawal as vw  # noqa: E402

_ms, st, bd = vt.us_nominal()
tol = []
for w in vt.WEIGHTS:
    r = w / 100 * st + (1 - w / 100) * bd
    nn = len(st) - vt.H + 1
    d = []
    for s0 in range(nn):
        path = np.cumprod(1 + r[s0:s0 + vt.H]); pk = np.maximum.accumulate(np.concatenate(([1.0], path)))[1:]
        d.append((path / pk - 1).min() * 100)
    d = np.array(d)
    tol.append(dict(stock=w, bad10=round(float(-np.percentile(d, 10)), 1), worst=round(float(-d.min()), 1)))

nn = len(st) - vt.H + 1
arr = {k: np.array([vt.run_plan(st, s0, k) for s0 in range(nn)]) for _, k in vt.PLANS}
split = [dict(months=k, label=("한 번에" if k == 1 else label), avgCostPct=abs(round(float(-np.mean(arr[k][:, 0] / arr[1][:, 0] - 1) * 100), 1)),
              firstYearLowBad10=round(float(np.percentile(arr[k][:, 1], 10)), 2), firstYearLowWorst=round(float(arr[k][:, 1].min()), 2)) for label, k in vt.PLANS]

def _check(px):
    n0 = len(px) - vc.HOLD
    paths = np.array([px[s0 + 1:s0 + vc.HOLD + 1] / px[s0] - 1 for s0 in range(0, n0, 5)])
    out = {}
    for label, step in vc.FREQS:
        idx = np.arange(step - 1, vc.HOLD, step)
        out[label] = int(np.median((paths[:, idx] < 0).sum(axis=1)))
    return out
ck, cs = _check(vc.load_kospi()), _check(vc.load_spx())
checking = [dict(label=l, kospi=ck[l], sp500=cs[l]) for l, _ in vc.FREQS if l in ("매일", "주 1회", "월 1회", "분기 1회")]

wms, wrs, wrb = vw.us_shiller("192601")
mans = [50, 60, 70, 80, 100]
rates = [round(m * 12 / vw.TOTAL_MAN * 100, 2) for m in mans]
w25 = vw.sweep(wrs, wrb, 0.6, 25 * 12, "prop", rates)
w30 = vw.sweep(wrs, wrb, 0.6, 30 * 12, "prop", rates)
withdrawal = [dict(ratePct=r, fail25=round(w25[r]["fail"]), fail30=round(w30[r]["fail"])) for r in rates]

today = datetime.date.today().isoformat()
meta = {
    "market": dict(title="코스피200 대 S&P500", asOf=asof, generated=today, script="scripts/research/build_research_facts.py", sample=f"{market['period']} {n}개월, 원화 환산·분배금 반영", caveat="2025년 한국 급등 포함, 표본 짧음"),
    "sleeve": dict(title="인컴(커버드콜) 몫 비용", asOf=asof, generated=today, script="scripts/research/build_research_facts.py", sample="한국 커버드콜 2종 " + " / ".join(sleeve_periods), caveat="한국 강세장 4~5년, 방향만 참고"),
    "tolerance": dict(title="감내 낙폭 표", asOf="2023-06", generated=today, script="scripts/research/validate_lump_vs_split_tolerance.py", sample="미국 1926~2023, 주식+합성 10년 국채, 시작 후 5년", caveat="월 평균 가격이라 낙폭이 약간 얕음, 시작 시대에 따라 크게 다름"),
    "split": dict(title="일시금 대 분할", asOf="2023-06", generated=today, script="scripts/research/validate_lump_vs_split_tolerance.py", sample="미국 1926~2023 주식 100%, 시작 후 5년", caveat="겹치는 창"),
    "checking": dict(title="확인 빈도", asOf="2026-09", generated=today, script="scripts/research/validate_checking_frequency.py", sample="코스피·S&P500 3년 보유 창", caveat="일시금 보유만 본 값"),
    "saving": dict(title="필요 월 적립", asOf="2023-06", generated="화면에서 계산", script="web/src/lib/planGuide.ts", sample="미국 주식 100% 실질 1926~2023", caveat="세금·수수료·임금 상승 제외, 시작 시대 편차 큼"),
    "withdrawal": dict(title="인출 실패율", asOf="2023-06", generated=today, script="scripts/research/validate_retirement_withdrawal.py", sample="미국 60/40 실질 1926~2023, 25·30년", caveat="부트스트랩으로 보면 더 나쁨, 건보 재산 점수 근사"),
}
out = "// 자동 생성 — scripts/research/build_research_facts.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
out += "export type FactMeta = { title: string; asOf: string; generated: string; script: string; sample: string; caveat: string }\n"
out += f"export const MARKET_PICK = {json.dumps(market, ensure_ascii=False)} as const\n"
out += f"export const TOLERANCE_TABLE = {json.dumps(tol)} as const\n"
out += f"export const SPLIT_TABLE = {json.dumps(split, ensure_ascii=False)} as const\n"
out += f"export const CHECKING_TABLE = {json.dumps(checking, ensure_ascii=False)} as const\n"
out += f"export const WITHDRAWAL_TABLE = {json.dumps(withdrawal)} as const\n"
out += f"export const SLEEVE_COST_DATA = {json.dumps(sleeve)} as const\n"
out += f"export const FACT_META: Record<string, FactMeta> = {json.dumps(meta, ensure_ascii=False, indent=2)}\n"
open(OUT, "w", encoding="utf-8").write(out)
print(json.dumps(market, ensure_ascii=False)[:600]); print(sleeve)
