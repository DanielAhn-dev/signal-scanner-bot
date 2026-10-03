# -*- coding: utf-8 -*-
"""
은퇴 인출 시뮬레이션 — 자산 1.8억(부부 합산), 일을 못 하게 됐을 때 월 얼마까지 꺼내 써도 몇 년을 버티는가 (2026-10-03).

질문: "인컴을 최대화"하려면 수익률을 올리는 게 아니라 얼마를 꺼내 쓰느냐가 먼저다. 모든 시작월에서 같은 금액을 매달 꺼냈을 때
      자산이 바닥나는 비율(=실패율)과 남는 돈을 본다.

핵심 사실: 네이버 수정주가는 분배금이 재투자된 총수익이라, 분배금으로 받든 팔아서 받든 같은 총수익에서 인출하는 것과 같다
          (세금 제외). 그래서 '분배금만 쓰기'는 따로 시뮬레이션하지 않는다 — 분배율을 올려도 꺼내 쓰는 총액이 같으면 결과가 같다.

A) 미국 장기 1972~2023 (validate_long_run.py와 같은 데이터: S&P500 총수익 + Shiller 합성 채권, 달러, CPI로 실질 환산).
   인출액은 시작 시점 자산의 일정 비율을 물가에 연동해 매달 꺼낸다(구매력 유지). 표본 개월 수는 많지만 겹치는 창이라 독립 표본은 훨씬 적다(약 50년).
B) 한국 2002-10~2026-10 (코스피200 ETF 수정주가 + CD91 금리를 현금성으로). 물가 데이터가 없어 연 2.5% 가정(한국 장기 평균 근사).
   표본이 24년뿐이라 20년 창은 시작월 몇십 개가 거의 같은 구간을 본다 — 결론이 아니라 참고로만.

규칙(전부 월 단위, 연 1회 비중 복원):
  prop   : 주식·채권 비중대로 같이 판다 (기본)
  bucket : 주식이 최근 고점 대비 -10% 이상 내려가 있으면 채권(현금성)에서 먼저 꺼낸다 — 하락 때 주식을 싸게 팔지 않기
  guard  : prop에 더해 자산이 시작의 75% 아래로 내려가면 인출을 20% 줄이고 90% 위로 회복하면 되돌린다 — 지출을 조정하는 대가로 얻는 방어
한계: 세금(분배금 15.4%·연금 수령세)·수수료·건강보험료는 반영하지 않는다. 월 인출액은 세후 실수령이 아니라 계좌에서 나가는 금액이다.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_long_run import R, bond_returns, load_gold, load_shiller, load_spx_month_end  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TOTAL_MAN = 18_000  # 1.8억(만원)
RATES = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0, 8.0, 10.0]  # 연 인출률(%) — 시작 자산 대비


def simulate(rs, rb, w_stock, annual_rate_pct, months, mode):
    """rs·rb: 월 실질 수익률 배열(창 시작부터). 반환: (바닥난 개월 or None, 끝 자산(시작=1), 감액 개월 비율, 중간 최저 자산(시작=1))"""
    S, B = w_stock, 1 - w_stock
    sidx, peak = 1.0, 1.0
    cut = False
    cut_months = 0
    trough = 1.0
    base = annual_rate_pct / 100 / 12
    for i in range(months):
        total = S + B
        if mode == "guard":
            if not cut and total < 0.75:
                cut = True
            elif cut and total > 0.9:
                cut = False
        need = base * (0.8 if cut else 1.0)
        if cut:
            cut_months += 1
        trough = min(trough, total)
        if need >= total:
            return i, 0.0, cut_months / months, 0.0
        if mode == "bucket" and w_stock < 1 and sidx < 0.9 * peak:
            take_b = min(B, need)
            B -= take_b
            S -= need - take_b
        else:
            share = S / total if total > 0 else 0
            S -= need * share
            B -= need * (1 - share)
        S *= 1 + rs[i]
        B *= 1 + rb[i]
        sidx *= 1 + rs[i]
        peak = max(peak, sidx)
        if (i + 1) % 12 == 0:
            total = S + B
            S, B = w_stock * total, (1 - w_stock) * total
            # 비중을 되돌린 뒤의 고점 기준도 이어간다
    return None, S + B, cut_months / months, min(trough, S + B)


def sweep(rs_all, rb_all, w_stock, months, mode, rates=RATES):
    """모든 시작월 창에서의 실패율·끝 자산 분포"""
    n = len(rs_all) - months + 1
    out = {}
    for r in rates:
        fails = 0
        ends = []
        cuts = []
        troughs = []
        for s in range(n):
            dep, end, cm, tr = simulate(rs_all[s:s + months], rb_all[s:s + months], w_stock, r, months, mode)
            troughs.append(tr)
            if dep is not None:
                fails += 1
                ends.append(0.0)
            else:
                ends.append(end)
            cuts.append(cm)
        ends = np.array(ends)
        out[r] = {"n": n, "fail": fails / n * 100, "med": float(np.median(ends)), "p10": float(np.percentile(ends, 10)),
                  "min": float(ends.min()), "cut": float(np.mean(cuts) * 100),
                  "tr_med": float(np.median(troughs)), "tr_p10": float(np.percentile(troughs, 10))}
    return out


def safe_rate(res, max_fail_pct):
    ok = [r for r in sorted(res) if res[r]["fail"] <= max_fail_pct]
    return max(ok) if ok else None


def us_series():
    sh = load_shiller()
    gold = load_gold()
    spx = load_spx_month_end()
    months = sorted(m for m in sh if m in gold and m in spx and sh[m]["gs10"] and sh[m]["cpi"] and m >= "197112")
    gs10 = {m: sh[m]["gs10"] for m in months}
    b10 = bond_returns(gs10, months, 10)
    rs, rb = [], []
    for i in range(1, len(months)):
        m, p = months[i], months[i - 1]
        d = (sh[m]["div"] or 0) / 12
        stock = spx[m] / spx[p] - 1 + d / spx[p]
        cpi = sh[m]["cpi"] / sh[p]["cpi"] - 1
        rs.append((1 + stock) / (1 + cpi) - 1)
        rb.append((1 + b10[m]) / (1 + cpi) - 1)
    return months[1:], np.array(rs), np.array(rb)


def us_shiller(start="192601"):
    """Shiller 월별(1871~2023-09) S&P 가격·배당·CPI·GS10 — 1929·1966·1973 코호트를 모두 포함한다. 월 평균 가격이라 변동성이 약간 작다."""
    import xlrd
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    rows = {}
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float):
            continue
        y = int(v)
        m = int(round((v - y) * 100))
        if m < 1 or m > 12:
            continue
        vals = [sh.cell_value(r, c) for c in (1, 2, 4, 6)]
        if all(isinstance(x, float) for x in vals):
            rows[f"{y}{m:02d}"] = dict(p=vals[0], d=vals[1], cpi=vals[2], gs10=vals[3])
    months = sorted(m for m in rows if m >= start)
    gs10 = {m: rows[m]["gs10"] for m in months}
    b10 = bond_returns(gs10, months, 10)
    rs, rb = [], []
    for i in range(1, len(months)):
        m, pm = months[i], months[i - 1]
        stock = rows[m]["p"] / rows[pm]["p"] - 1 + rows[m]["d"] / 12 / rows[pm]["p"]
        cpi = rows[m]["cpi"] / rows[pm]["cpi"] - 1
        rs.append((1 + stock) / (1 + cpi) - 1)
        rb.append((1 + b10[m]) / (1 + cpi) - 1)
    return months[1:], np.array(rs), np.array(rb)


def kr_series(inflation_pct=2.5):
    px = json.load(open(R + "index_etfs/px_069500.json", encoding="utf-8"))
    px.sort(key=lambda r: r[0])
    me = {}
    for d, c in px:
        me[d[:6]] = float(c)
    cd = json.load(open(R + "allweather/cd91.json", encoding="utf-8"))
    cd.sort(key=lambda r: r[0])
    cdm = {}
    for d, y in cd:
        cdm[d[:6]] = float(y)  # 월말 금리(연 %)
    months = sorted(m for m in me if m in cdm)
    infl = (1 + inflation_pct / 100) ** (1 / 12) - 1
    rs, rb = [], []
    for i in range(1, len(months)):
        stock = me[months[i]] / me[months[i - 1]] - 1
        cash = cdm[months[i - 1]] / 100 / 12
        rs.append((1 + stock) / (1 + infl) - 1)
        rb.append((1 + cash) / (1 + infl) - 1)
    return months[1:], np.array(rs), np.array(rb)


def table(title, rs, rb, horizons, configs):
    print(f"\n=== {title} ===")
    for years in horizons:
        months = years * 12
        print(f"\n[{years}년 버티기] 연 인출률별 실패율(%) / 끝 자산 중앙값(시작=100) / 하위10% — 구성별")
        header = f"{'구성':22s}" + "".join(f"{r:>12.1f}%" for r in RATES)
        print(header)
        for label, w, mode in configs:
            res = sweep(rs, rb, w, months, mode)
            line1 = f"{label:22s}" + "".join(f"{res[r]['fail']:>13.0f}" for r in RATES)
            line2 = f"{'  끝 중앙값':22s}" + "".join(f"{res[r]['med'] * 100:>13.0f}" for r in RATES)
            line3 = f"{'  끝 하위10%':22s}" + "".join(f"{res[r]['p10'] * 100:>13.0f}" for r in RATES)
            line4 = f"{'  중간 최저 중앙값':20s}" + "".join(f"{res[r]['tr_med'] * 100:>13.0f}" for r in RATES)
            line5 = f"{'  중간 최저 하위10%':20s}" + "".join(f"{res[r]['tr_p10'] * 100:>13.0f}" for r in RATES)
            print(line1)
            print(line2)
            print(line3)
            print(line4)
            print(line5)
            s95, s90, s100 = safe_rate(res, 5), safe_rate(res, 10), safe_rate(res, 0)
            print(f"{'  안전 인출률':22s} 실패 0%: {s100}  /  ≤5%: {s95}  /  ≤10%: {s90}"
                  + (f"   → 1.8억 기준 월 {TOTAL_MAN * s95 / 100 / 12:.0f}만원(≤5%)" if s95 else "")
                  + (f", 월 {TOTAL_MAN * s100 / 100 / 12:.0f}만원(0%)" if s100 else "")
                  + (f"  [표본 {res[RATES[0]]['n']}개월, 감액 {res[s95]['cut']:.0f}%]" if (s95 and mode == 'guard') else ""))


def main():
    cfgs = [
        ("주식100", 1.0, "prop"),
        ("주식80/채권20", 0.8, "prop"),
        ("주식60/채권40", 0.6, "prop"),
        ("주식40/채권60", 0.4, "prop"),
        ("60/40 버킷", 0.6, "bucket"),
        ("60/40 가드레일", 0.6, "guard"),
        ("주식100 가드레일", 1.0, "guard"),
    ]
    ms, rs, rb = us_shiller("192601")
    print(f"A) 미국 {ms[0]}~{ms[-1]} ({len(ms)}개월, Shiller), 달러 실질(CPI 반영) — 매달 시작 자산 대비 일정액을 물가연동으로 꺼냄")
    print("   1929 대공황·1966 인플레 코호트 포함. 주의: 가격이 월 평균이라 낙폭이 실제보다 약간 얕다.")
    table("A) 미국 장기 실질 (1926~2023)", rs, rb, [25, 30], cfgs)

    ms72, rs72, rb72 = us_series()
    print(f"\n[교차 확인] 야후 월말 종가 1972~2023 ({len(ms72)}개월) — 같은 질문, 안전 인출률 요약")
    for years in (25, 30):
        for label, w, mode in cfgs[:4] + cfgs[5:6]:
            res = sweep(rs72, rb72, w, years * 12, mode)
            print(f"  {years}년 {label:16s}: 실패 0% {safe_rate(res, 0)} / ≤5% {safe_rate(res, 5)}")

    kms, krs, krb = kr_series()
    cagr = (np.prod(1 + krs) ** (12 / len(krs)) - 1) * 100
    print(f"\n\nB) 한국 {kms[0]}~{kms[-1]} ({len(kms)}개월), 코스피200 + CD91 현금성, 물가 연 2.5% 가정으로 실질 환산")
    print(f"   경고: 이 기간 코스피200 실질 연 {cagr:.1f}%로 장기 평균보다 크게 높다(2025~ 급등 포함). 아래 안전 인출률은 낙관 편향 — 헤드라인으로 쓰지 말 것.")
    kcfgs = [("코스피200 100%", 1.0, "prop"), ("200 60/현금 40", 0.6, "prop"), ("200 40/현금 60", 0.4, "prop"),
             ("60/40 버킷", 0.6, "bucket"), ("60/40 가드레일", 0.6, "guard")]
    table("B) 한국 코스피200+CD91", krs, krb, [10, 15, 20], kcfgs)

    # 월 인출액 환산표: 1.8억에서 월 얼마를 꺼내면 실패율이 얼마인가 (60/40, 25년/15년)
    print("\n\n=== 1.8억에서 월 인출액별 실패율(%) — 주식60/채권40, 구성은 위와 같음 ===")
    mans = [30, 40, 50, 60, 70, 80, 100]
    rates = [m * 12 / TOTAL_MAN * 100 for m in mans]
    print(f"{'월 인출(만원)':22s}" + "".join(f"{m:>10d}" for m in mans))
    for label, a, b, w, years in (("미국장기 25년 60/40", rs, rb, 0.6, 25), ("미국장기 30년 60/40", rs, rb, 0.6, 30),
                                  ("한국 15년 200 60/40", krs, krb, 0.6, 15), ("한국 20년 200 60/40", krs, krb, 0.6, 20)):
        res = sweep(a, b, w, years * 12, "prop", rates)
        print(f"{label:22s}" + "".join(f"{res[r]['fail']:>10.0f}" for r in rates))

    # 국민연금 등 고정 수입이 있으면 계좌에서 뺄 금액이 줄어든다: 생활비 − 연금 = 계좌 인출
    print("\n(참고) 월 생활비 − 월 연금 = 계좌 인출. 예) 생활비 200 − 연금 100 = 인출 100만원 → 위 표 100만원 열을 본다")


if __name__ == "__main__":
    main()
