# -*- coding: utf-8 -*-
"""
보유 카드 "이 종목 대응" 문구가 종목마다 다르게 나오도록, ETF별 과거 숫자를 계산해 web/src/data/etfHistoryFacts.ts로 내보낸다.
(손으로 옮겨 적지 않는다. 분기 재검증 때 가격·분배금 캐시를 갱신하고 다시 돌린다.)

데이터
  - 가격: 네이버 수정주가(분배금 소급 반영 = 총수익 경로). .research-cache/px_*.json, dividend_etfs/, index_etfs/, trading_etfs/
  - 분배금: 운용사 실제 이력 .research-cache/div_<코드>.json (원/주). 없는 종목은 분배금 항목을 비운다.
  - 비교 기준: KODEX 200(069500) 수정주가 = 코스피200 총수익
계산
  - 최근 12개월 / 그 전 12개월 주당 분배금과 증감 (두 구간 모두 이력이 있을 때만)
  - 연도별 주당 분배금 합계(완결된 해만)로 '전년보다 줄어든 해' 수와 최대 감소폭
  - 분배 이력 구간의 실제 가격 변화(수정주가에서 역산, 근사)·분배 누적·총수익, 같은 기간 코스피200 총수익
  - 최근 3년 연 총수익과 코스피200, 상장 이후 최대 낙폭과 같은 기간 코스피200 최대 낙폭
한계: 가격 역산은 월말 근사, 대부분 2022~2026 한국 강세장 표본, 과거 수익 차이는 앞으로를 보장하지 않는다.

사용: python scripts/research/build_etf_history_facts.py [--fetch 0105E0 ...]   (--fetch: 네이버 일봉을 받아 dividend_etfs/에 저장)
"""
import ast, datetime, glob, json, os, sys, urllib.request
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_income_then_growth import reconstruct  # noqa: E402
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

C = ".research-cache"
OUT = "web/src/data/etfHistoryFacts.ts"
BENCH = "069500"
NAMES_EXTRA = f"{C}/dividend_etfs/names_extra.json"  # --fetch로 받은 신규 상장 종목 이름


def fetch_px(code):
    today = datetime.date.today().strftime("%Y%m%d")
    url = f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1&startTime=20020101&endTime={today}&timeframe=day"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    rows = ast.literal_eval(urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace").strip())[1:]
    out = [[str(r[0]), float(r[4])] for r in rows if r[4]]
    json.dump(out, open(f"{C}/dividend_etfs/px_{code}.json", "w"), ensure_ascii=False)
    req = urllib.request.Request(f"https://m.stock.naver.com/api/stock/{code}/integration", headers={"User-Agent": "Mozilla/5.0"})
    nm = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8")).get("stockName")
    extra = json.load(open(NAMES_EXTRA, encoding="utf-8")) if os.path.exists(NAMES_EXTRA) else {}
    if nm:
        extra[code] = nm
        json.dump(extra, open(NAMES_EXTRA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"받음 {code}: {len(out)}일 {out[0][0]}~{out[-1][0]}")


if "--fetch" in sys.argv:
    for c in sys.argv[sys.argv.index("--fetch") + 1:]:
        fetch_px(c)

# --- 이름
names = {}
for r in json.load(open("data/all_krx.json", encoding="utf-8")):
    names[r["code"]] = r["name"]
for r in json.load(open(f"{C}/dividend_etf_candidates.json", encoding="utf-8")):
    names.setdefault(r["code"], r["name"])
for code, v in json.load(open(f"{C}/index_etfs/info.json", encoding="utf-8")).items():
    names.setdefault(code, v.get("name"))
if os.path.exists(NAMES_EXTRA):
    for code, nm in json.load(open(NAMES_EXTRA, encoding="utf-8")).items():
        names.setdefault(code, nm)

# --- 가격 파일 (같은 코드가 여러 곳에 있으면 마지막 날짜가 늦은 것)
px_path = {}
for f in glob.glob(f"{C}/px_*.json") + glob.glob(f"{C}/*/px_*.json"):
    code = os.path.basename(f)[3:-5]
    try:
        rows = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    if not rows or not isinstance(rows[0], list):
        continue
    last = max(str(r[0]) for r in rows)
    if code not in px_path or last > px_path[code][1]:
        px_path[code] = (f, last)


def daily(code):
    rows = json.load(open(px_path[code][0], encoding="utf-8"))
    d = {}
    for r in rows:
        if r[1]:
            d[str(r[0])] = float(r[1])
    ks = sorted(d)
    return ks, np.array([d[k] for k in ks])


def to_date(k):
    return datetime.date(int(k[:4]), int(k[4:6]), int(k[6:8]))


def mdd(v):
    pk = np.maximum.accumulate(v)
    return float((v / pk - 1).min() * 100)


bk, bv = daily(BENCH)
bmap = dict(zip(bk, bv))


def bench_between(k0, k1):
    """두 날짜 사이 코스피200 총수익(%)·최대 낙폭"""
    sel = [k for k in bk if k0 <= k <= k1]
    if len(sel) < 2:
        return None, None
    v = np.array([bmap[k] for k in sel])
    return float((v[-1] / v[0] - 1) * 100), mdd(v)


def r1(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 1)


facts = {}
for code in sorted(px_path):
    if code == BENCH or not names.get(code):
        continue
    ks, v = daily(code)
    if len(ks) < 120:
        continue
    as_of, first = ks[-1], ks[0]
    f = {"name": names[code], "first": f"{first[:4]}-{first[4:6]}", "asOf": f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:]}"}
    # 상장 이후 최대 낙폭과 같은 기간 지수
    f["mdd"] = r1(mdd(v))
    _, f["benchMdd"] = bench_between(first, as_of)
    f["benchMdd"] = r1(f["benchMdd"])
    # 최근 3년 연 총수익
    d_end = to_date(as_of)
    k3 = (d_end - datetime.timedelta(days=365 * 3)).strftime("%Y%m%d")
    if first <= k3:
        i0 = next(i for i, k in enumerate(ks) if k >= k3)
        f["tr3y"] = r1(((v[-1] / v[i0]) ** (1 / 3) - 1) * 100)
        bt, _ = bench_between(ks[i0], as_of)
        f["benchTr3y"] = r1(((1 + bt / 100) ** (1 / 3) - 1) * 100) if bt is not None else None
    # 분배금
    dpath = f"{C}/div_{code}.json"
    if os.path.exists(dpath):
        divs = [x for x in json.load(open(dpath, encoding="utf-8")) if x.get("amount")]
        divs.sort(key=lambda x: x["recordDate"])
        if divs:
            k_ttm = (d_end - datetime.timedelta(days=365)).isoformat()
            k_prev = (d_end - datetime.timedelta(days=730)).isoformat()
            asof_iso = f["asOf"]
            ttm = sum(x["amount"] for x in divs if k_ttm < x["recordDate"] <= asof_iso)
            n_ttm = sum(1 for x in divs if k_ttm < x["recordDate"] <= asof_iso)
            div_first = divs[0]["recordDate"]
            f["divFirst"] = div_first[:7]
            f["divTtm"] = round(ttm)
            f["payPerYear"] = n_ttm
            f["divYieldTtm"] = r1(ttm / v[-1] * 100) if ttm else None
            if div_first <= k_prev:
                prev = sum(x["amount"] for x in divs if k_prev < x["recordDate"] <= k_ttm)
                f["divPrev"] = round(prev)
                f["divChgPct"] = r1((ttm / prev - 1) * 100) if prev > 0 else None
            # 완결된 해의 연간 합계 (첫 해는 중간부터일 수 있어 빼고, 올해도 뺀다)
            # 지급 횟수가 바뀐 해(연 1회→월배당 전환 등)는 합계가 일시적으로 튀므로 비교에서 뺀다. 연 합계의 5% 미만 소액 지급은 횟수에 넣지 않는다.
            by_year, pays = {}, {}
            for x in divs:
                by_year[int(x["recordDate"][:4])] = by_year.get(int(x["recordDate"][:4]), 0) + x["amount"]
            for x in divs:
                y = int(x["recordDate"][:4])
                if x["amount"] >= by_year[y] * 0.05:
                    pays[y] = pays.get(y, 0) + 1
            yrs = [y for y in sorted(by_year) if int(div_first[:4]) < y < d_end.year]
            if len(yrs) >= 2:
                pairs = [(p, y) for p, y in zip(yrs, yrs[1:]) if pays[p] == pays[y]]
                changed = [y for p, y in zip(yrs, yrs[1:]) if pays[p] != pays[y]]
                if changed:
                    f["scheduleChangeYears"] = changed
                f["comparedYears"] = len(pairs)
                cuts = [(y, (by_year[y] / by_year[p] - 1) * 100) for p, y in pairs if by_year[y] < by_year[p] * 0.98]
                f["divYears"] = len(yrs)
                f["divYearRange"] = f"{yrs[0]}~{yrs[-1]}"
                f["cutYears"] = len(cuts)
                if cuts:
                    wy, wc = min(cuts, key=lambda t: t[1])
                    f["worstCutPct"], f["worstCutYear"] = r1(wc), wy
            # 분배 이력 구간: 실제 가격 변화(역산)·분배 누적·총수익 vs 지수
            mon = {}
            for k, val in zip(ks, v):
                mon[k[:6]] = val
            start_m = div_first[:4] + div_first[5:7]
            sub = {m: mon[m] for m in sorted(mon) if m >= start_m}
            if len(sub) >= 13:
                ms, real, _ = reconstruct(sub, divs)
                cum = sum(x["amount"] for x in divs if (x["recordDate"][:4] + x["recordDate"][5:7]) in set(ms[1:]))
                f["since"] = f"{ms[0][:4]}-{ms[0][4:]}"
                f["years"] = round((len(ms) - 1) / 12, 1)
                f["priceChgPct"] = r1((real[ms[-1]] / real[ms[0]] - 1) * 100)
                f["divCumPct"] = r1(cum / real[ms[0]] * 100)
                f["trPct"] = r1((sub[ms[-1]] / sub[ms[0]] - 1) * 100)
                bm = {k[:6]: bmap[k] for k in bk}
                if ms[0] in bm and ms[-1] in bm:
                    f["benchTrPct"] = r1((bm[ms[-1]] / bm[ms[0]] - 1) * 100)
    facts[code] = {k: val for k, val in f.items() if val is not None}

asof_all = max(x["asOf"] for x in facts.values())
meta = {
    "generated": datetime.date.today().isoformat(),
    "asOf": asof_all,
    "source": "네이버 수정주가(총수익) · 운용사 분배금 이력 · 비교 기준 KODEX 200(코스피200 총수익)",
    "limits": "가격 역산은 월말 근사, 대부분 2022~2026 한국 강세장 표본. 과거 차이는 앞으로를 보장하지 않습니다.",
    "script": "scripts/research/build_etf_history_facts.py",
}
with open(OUT, "w", encoding="utf-8", newline="\n") as fo:
    fo.write("// 자동 생성 — scripts/research/build_etf_history_facts.py. 손으로 고치지 말고 스크립트를 다시 돌린다.\n")
    fo.write("export type EtfHistoryFact = {\n  name: string; first: string; asOf: string; mdd?: number; benchMdd?: number; tr3y?: number; benchTr3y?: number\n"
             "  divFirst?: string; divTtm?: number; payPerYear?: number; divYieldTtm?: number; divPrev?: number; divChgPct?: number\n"
             "  divYears?: number; divYearRange?: string; comparedYears?: number; scheduleChangeYears?: number[]; cutYears?: number; worstCutPct?: number; worstCutYear?: number\n"
             "  since?: string; years?: number; priceChgPct?: number; divCumPct?: number; trPct?: number; benchTrPct?: number\n}\n")
    fo.write(f"export const ETF_HISTORY_META = {json.dumps(meta, ensure_ascii=False)} as const\n")
    fo.write("export const ETF_HISTORY: Record<string, EtfHistoryFact> = " + json.dumps(facts, ensure_ascii=False, indent=0).replace("\n", "") + "\n")
print(f"{len(facts)}종목 → {OUT} (기준일 {asof_all})")
for c in ("161510", "0105E0", "289480", "290080", "498400", "441680"):
    if c in facts:
        print(c, json.dumps(facts[c], ensure_ascii=False))
