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
    # 일반계좌 세후: 코스피200은 매매차익 비과세·분배금(연 2.3% 가정)만 15.4% 과세, 국내 상장 미국 지수는 매도 시 차익의 15.4%(손익통산·종합과세 제외)
    kt = np.array([np.prod(1 + rk[s:s + H] - 0.154 * 0.023 / 12) for s in range(n - H + 1)])
    ut = np.where(b > 1, 1 + (b - 1) * (1 - 0.154), b)
    return dict(years=H // 12, starts=len(a), kMed=float(np.median(a)), uMed=float(np.median(b)), mixMed=float(np.median(c)),
                kMin=float(a.min()), uMin=float(b.min()), mixMin=float(c.min()), usWinPct=float((b > a).mean() * 100),
                kTaxMed=float(np.median(kt)), uTaxMed=float(np.median(ut)), kTaxMin=float(kt.min()), uTaxMin=float(ut.min()), usWinTaxPct=float((ut > kt).mean() * 100))

market = dict(period=f"{ms[0][:4]}-{ms[0][4:]}~{ms[-1][:4]}-{ms[-1][4:]}", months=n,
              kCagr=float((np.prod(1 + rk) ** (12 / n) - 1) * 100), uCagr=float((np.prod(1 + ru) ** (12 / n) - 1) * 100),
              corr=float(np.corrcoef(rk, ru)[0, 1]), mdd=dict(k=mdd(rk), u=mdd(ru), mix=mdd(rm)), hold=[hold(60), hold(120)])
y2025 = [i for i, m in enumerate(ms[1:]) if m[:4] == "2025"]
market["kospi2025Pct"] = float((np.prod(1 + rk[y2025]) - 1) * 100) if len(y2025) == 12 else None

# --- 환율 분해: S&P500 원화 환산 = 달러 총수익(SPY) + 원/달러 변동. 환율은 정상 확인된 일봉 파일의 월말값(야후 월봉 KRW=X는 이상값이 있어 쓰지 않음)
import time as _time
def _yh_adj(fn):
    d = json.load(open(f".research-cache/yh_{fn}.json")); o = {}
    for t, a in zip(d["t"], d["adj"]):
        if a is not None: o[_time.strftime("%Y%m", _time.gmtime(t))] = a
    return o
_spy = _yh_adj("SPY")
_fxd = json.load(open(".research-cache/allweather/us_KRW_X.json")); _fxd.sort(key=lambda r: r[0])
_fx = {r[0][:6]: float(r[-1]) for r in _fxd}
_mf = [m for m in ms if m in _spy and m in _fx]
_i0 = [i for i, m in enumerate(ms) if m == _mf[0]][0]
_ru = np.array([_spy[_mf[i]] / _spy[_mf[i-1]] - 1 for i in range(1, len(_mf))])
_rf = np.array([_fx[_mf[i]] / _fx[_mf[i-1]] - 1 for i in range(1, len(_mf))])
_rkrw = np.array([u[_mf[i]] / u[_mf[i-1]] - 1 for i in range(1, len(_mf))])
_rkk = np.array([k[_mf[i]] / k[_mf[i-1]] - 1 for i in range(1, len(_mf))])
_H = 120
_win = lambda r: np.array([np.prod(1 + r[s:s + _H]) for s in range(len(r) - _H + 1)])
_wu, _wk = _win(_ru), _win(_rkk)
_worst = np.argsort(_ru)[:12]
market["fx"] = dict(period=f"{_mf[0][:4]}-{_mf[0][4:]}~{_mf[-1][:4]}-{_mf[-1][4:]}", months=len(_ru),
                    krwCagr=round(float((np.prod(1 + _rkrw) ** (12 / len(_rkrw)) - 1) * 100), 1),
                    usdCagr=round(float((np.prod(1 + _ru) ** (12 / len(_ru)) - 1) * 100), 1),
                    fxCagr=round(float((np.prod(1 + _rf) ** (12 / len(_rf)) - 1) * 100), 1),
                    usdOnlyWinPct=round(float((_wu > _wk).mean() * 100)), corrFxUsd=round(float(np.corrcoef(_rf, _ru)[0, 1]), 2),
                    worstUsdAvg=round(float(_ru[_worst].mean() * 100), 1), worstFxAvg=round(float(_rf[_worst].mean() * 100), 1), worstKrwAvg=round(float(_rkrw[_worst].mean() * 100), 1))

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

# --- 인컴 상품 12개월 분배율(분배금 합 ÷ 당시 실제 가격) 분포 — 커버드콜 1세대형 2종 / 고배당 3종
from validate_income_then_growth import reconstruct  # noqa: E402

def yield12(code, path):
    adj = monthly(path)
    divs = json.load(open(f".research-cache/div_{code}.json", encoding="utf-8"))
    first = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
    sub = {m: adj[m] for m in sorted(adj) if m >= first}
    ms, real, _y = reconstruct(sub, divs)
    by = {}
    for x in divs:
        k = x["recordDate"][:4] + x["recordDate"][5:7]
        by[k] = by.get(k, 0) + x["amount"]
    out = {}
    for i in range(12, len(ms)):
        out[ms[i]] = sum(by.get(m, 0) for m in ms[i - 11:i + 1]) / real[ms[i]] * 100
    return out

def bucket(items):
    ys = [yield12(c, p) for c, p in items]
    common = sorted(set.intersection(*[set(y) for y in ys]))
    arr = np.array([np.mean([y[m] for y in ys]) for m in common])
    return dict(period=f"{common[0][:4]}-{common[0][4:]}~{common[-1][:4]}-{common[-1][4:]}", months=len(common),
                min=round(float(arr.min()), 1), p25=round(float(np.percentile(arr, 25)), 1), median=round(float(np.median(arr)), 1),
                p75=round(float(np.percentile(arr, 75)), 1), max=round(float(arr.max()), 1), last=round(float(arr[-1]), 1))

income_yield = dict(
    cc=bucket([("289480", ".research-cache/dividend_etfs/px_289480.json"), ("290080", ".research-cache/dividend_etfs/px_290080.json")]),
    cc2=bucket([("475720", ".research-cache/dividend_etfs/px_475720.json"), ("498400", ".research-cache/dividend_etfs/px_498400.json")]),
    cc3=bucket([("482730", ".research-cache/dividend_etfs/px_482730.json"), ("486290", ".research-cache/dividend_etfs/px_486290.json"), ("494300", ".research-cache/dividend_etfs/px_494300.json")]),
    hd=bucket([("161510", ".research-cache/px_161510.json"), ("104530", ".research-cache/dividend_etfs/px_104530.json"), ("210780", ".research-cache/dividend_etfs/px_210780.json")]),
)

# --- 금리 환경별 성과(1962~2023 미국) + 현재 금리 스냅샷 (validate_rates_regimes.py와 같은 정의)
import xlrd  # noqa: E402
from validate_long_run import R as LR, bond_returns  # noqa: E402

def _shiller():
    sh = xlrd.open_workbook(LR + "longrun/ie_data.xls").sheet_by_name("Data")
    rows = {}
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float): continue
        y, m = int(v), int(round((v - int(v)) * 100))
        if not 1 <= m <= 12: continue
        vals = [sh.cell_value(r, c) for c in (1, 2, 6, 4)]
        if all(isinstance(x, float) for x in vals):
            rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], gs10=vals[2], cpi=vals[3])
    ms_ = sorted(rows)
    b10 = bond_returns({m: rows[m]["gs10"] for m in ms_}, ms_, 10)
    return {ms_[i]: dict(stock=rows[ms_[i]]["p"] / rows[ms_[i-1]]["p"] - 1 + rows[ms_[i]]["d"] / 12 / rows[ms_[i-1]]["p"], bond=b10[ms_[i]], gs10=rows[ms_[i]]["gs10"], cpi=rows[ms_[i]]["cpi"] / rows[ms_[i-1]]["cpi"] - 1) for i in range(1, len(ms_))}

_S = _shiller()
_irx = json.load(open(".research-cache/yh_IRX_me.json")); _tnx = json.load(open(".research-cache/yh_TNX_me.json"))
_mB = [m for m in sorted(_S) if m >= "196201" and m in _irx]
_st = np.array([_S[m]["stock"] for m in _mB]); _bd = np.array([_S[m]["bond"] for m in _mB]); _gs = np.array([_S[m]["gs10"] for m in _mB])
_ir = np.array([_irx[m] for m in _mB]); _cash = _ir / 100 / 12
_d12 = np.full(len(_mB), np.nan); _d12[12:] = _ir[12:] - _ir[:-12]
_slope = _gs - _ir
_ann = lambda a: float((np.prod(1 + a) ** (12 / len(a)) - 1) * 100)

def _row(mask):
    return dict(months=int(mask.sum()), stock=round(_ann(_st[mask]), 1), bond=round(_ann(_bd[mask]), 1), cash=round(_ann(_cash[mask]), 1))

_ok = ~np.isnan(_d12)
rates_regimes = dict(
    period=f"{_mB[0][:4]}-{_mB[0][4:]}~{_mB[-1][:4]}-{_mB[-1][4:]}",
    hiking=_row(_ok & (_d12 > 1.0)), flat=_row(_ok & (np.abs(_d12) <= 1.0)), cutting=_row(_ok & (_d12 < -1.0)),
    inverted=_row(_slope < 0), normal=_row(_slope >= 1),
)
_ks = sorted(_irx)
_last = _ks[-1]; _prev = _ks[-13]
rates_now = dict(asOf=f"{_last[:4]}-{_last[4:]}", short=round(_irx[_last], 2), long=round(_tnx[_last], 2), spread=round(_tnx[_last] - _irx[_last], 2),
                 shortChg12=round(_irx[_last] - _irx[_prev], 2), longChg12=round(_tnx[_last] - _tnx[_prev], 2))

# --- 시작 시점 10년 금리 3분위별 60/40 30년 인출 실패율(실질, 비례 인출) — 1961~2023 미국
_mS = [m for m in sorted(_S) if m >= "196102"]
_gsS = np.array([_S[m]["gs10"] for m in _mS])
_rsS = np.array([(1 + _S[m]["stock"]) / (1 + _S[m]["cpi"]) - 1 for m in _mS]); _rbS = np.array([(1 + _S[m]["bond"]) / (1 + _S[m]["cpi"]) - 1 for m in _mS])
_gq = np.quantile(_gsS, [1 / 3, 2 / 3]); _months = 360
_tiers = []
for _nm, _lo, _hi in (("낮음", -1, _gq[0]), ("중간", _gq[0], _gq[1]), ("높음", _gq[1], 99)):
    _idx = [i for i in range(0, len(_mS) - _months + 1) if _lo < _gsS[i] <= _hi]
    _f = lambda rate: round(sum(vw.simulate(_rsS[i:i + _months], _rbS[i:i + _months], 0.6, rate, _months, "prop")[0] is not None for i in _idx) / len(_idx) * 100)
    _tiers.append(dict(label=_nm, minYield=round(float(_gsS[_idx].min()), 1), maxYield=round(float(_gsS[_idx].max()), 1), starts=len(_idx), fail40=_f(4.0), fail45=_f(4.5)))
start_yield = dict(period=f"{_mS[0][:4]}-{_mS[0][4:]}~{_mS[-1][:4]}-{_mS[-1][4:]}", tiers=_tiers)

# --- 하락장·박스권 합성 분배금/원금(validate_cc_downturn_payout.py)
import validate_cc_downturn_payout as _dp  # noqa: E402
_want = {"2008~2009-03 금융위기": "crisis2008", "2015~2016 박스권": "sideways", "2022 금리 급등": "rates2022"}
_struct = {"월물 ATM 100%(1세대형)": "gen1", "주간 ATM 50%(2세대형)": "gen2", "데일리 ATM 30%(3세대형 근사)": "gen3"}
downturn = {}
for _r in _dp.regime_rows():
    if _r["regime"] in _want and _r["structure"] in _struct:
        downturn.setdefault(_struct[_r["structure"]], {})[_want[_r["regime"]]] = dict(index=_r["index"], nav=_r["nav"], yield_=_r["yield_"], total=_r["total"])

# --- 한국 금리(CD91)·환율 환경별 성과(validate_kr_rates_fx.py)
import validate_kr_rates_fx as _kr  # noqa: E402
kr_rates_fx = _kr.export()

# --- 장기금리 6개월 변화별 원화 환산 자산 성과(2010-10~, mixData + ^TNX)
_ids = ["kospi200", "sp500", "usbond20", "kbond10", "gold"]
_mC = [m for m in sorted(assets["kospi200"]) if m >= "201010" and all(m in assets[i] for i in _ids) and m in _tnx]
_rC = {i: np.array([assets[i][_mC[k]] / assets[i][_mC[k - 1]] - 1 for k in range(1, len(_mC))]) for i in _ids}
_t10 = np.array([_tnx[m] for m in _mC])[1:]
_c6 = np.full(len(_t10), np.nan); _c6[6:] = _t10[6:] - _t10[:-6]
_vv = ~np.isnan(_c6)
def _rowC(mask):
    return dict(months=int(mask.sum()), **{i: round(_ann(_rC[i][mask]), 1) for i in _ids})
rates_long = dict(period=f"{_mC[0][:4]}-{_mC[0][4:]}~{_mC[-1][:4]}-{_mC[-1][4:]}", rising=_rowC(_vv & (_c6 > 0.5)), flat=_rowC(_vv & (np.abs(_c6) <= 0.5)), falling=_rowC(_vv & (_c6 < -0.5)))

# --- 사용 시점 계좌 단계 전환(글라이드 패스, validate_glide_path.py)
import validate_glide_path as _gp  # noqa: E402
glide = _gp.export()

today = datetime.date.today().isoformat()
meta = {
    "glide": dict(title="사용 시점 단계 전환", asOf="2023-06", generated=today, script="scripts/research/validate_glide_path.py", sample=f"미국 {glide['markets']['us']['period']}(주식 총수익, 안전자산 연 3% 현금) / 한국 코스피 {glide['markets']['kr']['period']}(배당 제외), 일시금·월 리밸런싱", caveat="겹치는 창이라 독립 표본이 적음, 안전자산 연 3% 가정, 대공황 시작 15년 창에서는 폭락 뒤 비중을 내려 보유보다 나빴음(최악 0.78 대 0.95)"),
    "market": dict(title="코스피200 대 S&P500", asOf=asof, generated=today, script="scripts/research/build_research_facts.py", sample=f"{market['period']} {n}개월, 원화 환산·분배금 반영", caveat="2025년 한국 급등 포함, 표본 짧음"),
    "income": dict(title="인컴 상품 12개월 분배율", asOf=asof, generated=today, script="scripts/research/build_research_facts.py", sample=f"1세대 한국 {income_yield['cc']['period']} / 2세대 한국 위클리 {income_yield['cc2']['period']} / 3세대 미국 데일리 {income_yield['cc3']['period']} / 고배당 {income_yield['hd']['period']}, 실제 분배금 이력과 역산 실제 가격", caveat="신형은 이력 2년 안팎(12개월 분배율 표본 10~12개, 범위가 실제보다 좁게 나옴), 한국 강세장, 분배율은 시장 변동성에 따라 크게 변함"),
    "rates": dict(title="금리 환경별 성과", asOf=rates_now["asOf"], generated=today, script="scripts/research/build_research_facts.py (validate_rates_regimes.py와 같은 정의)", sample=f"미국 {rates_regimes['period']}, 주식(S&P500 총수익)·10년 합성 국채·3개월물 현금성, 명목", caveat="겹치는 창, 금리 변화는 경기·물가와 겹쳐 있어 인과가 아님, 인상기 168개월·역전 75개월로 표본 짧음"),
    "ratesLong": dict(title="장기금리 방향별 자산 성과", asOf=rates_long["period"].split("~")[1], generated=today, script="scripts/research/build_research_facts.py (validate_rates_regimes.py C)", sample=f"{rates_long['period']} 원화 환산, ^TNX 6개월 변화 기준", caveat="상승 41개월·하락 20개월로 짧음, 금리 변화는 인과가 아님"),
    "krRatesFx": dict(title="한국 금리·환율 환경별 성과", asOf=kr_rates_fx["now"]["asOf"], generated=today, script="scripts/research/validate_kr_rates_fx.py", sample=f"{kr_rates_fx['period']} 월말 수정주가, 코스피200·S&P500(SPY×환율)·금(GLD×환율) 원화 환산, 현금=CD91", caveat="12개월 변화 겹치는 구간, 금리 인상기는 독립 구간 5개 안팎, 경기와 겹쳐 인과 아님, 인하기 수익은 위기 직후 반등이 섞임"),
    "startYield": dict(title="시작 금리별 인출 실패율", asOf="2023-06", generated=today, script="scripts/research/build_research_facts.py (validate_rates_rules.py와 같은 정의)", sample=f"미국 {start_yield['period']} 시작, 60/40 실질, 30년 비례 인출", caveat="중간 구간은 1966~82년 스태그플레이션 시작이 대부분이라 독립 표본이 2~3개, 겹치는 창"),
    "downturn": dict(title="신형 구조 하락장·박스권 분배금과 원금(합성)", asOf="2026-10", generated=today, script="scripts/research/validate_cc_downturn_payout.py", sample="S&P500 가격지수 1990~2026, 실제 VIX×0.9로 가격 매긴 옵션 프리미엄을 전부 분배한다고 가정", caveat="합성 모델(분배율이 실제보다 높음, 평활화·스큐 미반영), 한국 지수 옵션 아님, 방향만 참고"),
    "sleeve": dict(title="인컴(커버드콜) 몫 비용", asOf=asof, generated=today, script="scripts/research/build_research_facts.py", sample="한국 커버드콜 2종 " + " / ".join(sleeve_periods), caveat="1세대형(전체 월물 커버) 기준 — 주간·데일리·OTM 최신 구조는 상승 참여가 훨씬 높음(docs 부록 4), 한국 강세장 4~5년, 방향만 참고"),
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
out += f"export const INCOME_YIELD = {json.dumps(income_yield)} as const\n"
out += f"export const RATES_REGIMES = {json.dumps(rates_regimes)} as const\n"
out += f"export const RATES_LONG = {json.dumps(rates_long)} as const\n"
out += f"export const START_YIELD = {json.dumps(start_yield)} as const\n"
out += f"export const DOWNTURN = {json.dumps(downturn)} as const\n"
out += f"export const KR_RATES_FX = {json.dumps(kr_rates_fx)} as const\n"
out += f"export const RATES_NOW = {json.dumps(rates_now)} as const\n"
out += f"export const SLEEVE_COST_DATA = {json.dumps(sleeve)} as const\n"
out += f"export const GLIDE_FACTS = {json.dumps(glide, ensure_ascii=False)} as const\n"
out += f"export const FACT_META: Record<string, FactMeta> = {json.dumps(meta, ensure_ascii=False, indent=2)}\n"
open(OUT, "w", encoding="utf-8").write(out)
print(json.dumps(market, ensure_ascii=False)[:600]); print(sleeve)
