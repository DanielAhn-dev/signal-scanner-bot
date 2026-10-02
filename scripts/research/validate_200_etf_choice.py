# -*- coding: utf-8 -*-
"""
코스피200 ETF 선택 검증 (2026-10-02): 일반 vs TR, 그리고 운용사별 동일 지수 상품 비교.

원칙: 같은 지수를 추종하는 상품이라 수익률 순위(과거 우연)로 고르지 않는다.
확실성 = 비용(보수) + 규모(순자산·거래대금) + 추적 품질(지수/동종 대비 추적오차) + 구조(분배금 과세).

섹션
  A. KODEX 200TR vs KODEX 200: 분배금 재투자·세금이 실제로 만든 격차 (실제 분배금 이력 사용 구간)
  B. TR 상품 간: 같은 기간 누적수익 격차, 일간 추적오차(KODEX 200TR 대비)
  C. 일반 상품 간: 가격수익 격차, 추적오차(KODEX 200 대비)
  D. 비용·규모 표
"""
import json
import numpy as np

DIR = ".research-cache/index_etfs"
TAX = 0.154  # 배당소득세(지방세 포함)


def load_px(code: str) -> dict[str, float]:
    return {d: float(c) for d, c in json.load(open(f"{DIR}/px_{code}.json", encoding="utf-8"))}


def aligned(a: dict, b: dict, start: str | None = None):
    dates = sorted(set(a) & set(b))
    if start:
        dates = [d for d in dates if d >= start]
    return dates, np.array([a[d] for d in dates]), np.array([b[d] for d in dates])


def ann(total_mult: float, dates: list[str]) -> float:
    years = (int(dates[-1][:4]) - int(dates[0][:4])) + (int(dates[-1][4:6]) - int(dates[0][4:6])) / 12
    return total_mult ** (1 / years) - 1 if years > 0 else float("nan")


def section_a(info):
    """
    중요: 네이버 siseJson 가격은 분배금이 소급 반영된 수정주가다(2026-10-02 확인 — 월 0.94% 분배 커버드콜의
    분배락일에도 가격 계단이 없고, KODEX 200 대비 200TR 비율이 5년간 평탄). 따라서 일반 ETF의 이 가격은
    '세전 분배금 재투자' 수익과 같고, 여기에 분배금을 또 더하면 이중 계산이다.
    세금은 과세분배금(taxDividA) x 15.4%를 분배 시점에 떼어 재투자하는 효과로 계산한다.
    """
    kodex = load_px("069500")
    tr = load_px("278530")
    divs = sorted(json.load(open(".research-cache/kodex200_divid.json", encoding="utf-8")), key=lambda x: x["basicD"])
    dates, p_plain, p_tr = aligned(kodex, tr, divs[0]["basicD"])
    gross = p_plain[-1] / p_plain[0]
    drag = 1.0
    for d in divs:
        if d["basicD"] < dates[0]:
            continue
        taxable_share = float(d["taxDividA"]) / float(d["dividA"]) if float(d["dividA"]) else 0.0
        drag *= 1 - TAX * taxable_share * float(d["dividY"]) / 100
    net = gross * drag
    mult_tr = p_tr[-1] / p_tr[0]
    print(f"\n[A] KODEX 200 vs KODEX 200TR  구간 {dates[0]}~{dates[-1]}  분배 {len(divs)}건 (실제 이력, 가격은 분배금 반영 수정주가)")
    print(f"  KODEX 200 세전 재투자(=수정주가)  누적 {gross:.4f}배  연 {ann(gross, dates)*100:.2f}%")
    print(f"  KODEX 200 세후 재투자(과세분배 15.4%)  누적 {net:.4f}배  연 {ann(net, dates)*100:.2f}%   (세금 누적 {100*(1-drag):.2f}%)")
    print(f"  KODEX 200TR                        누적 {mult_tr:.4f}배  연 {ann(mult_tr, dates)*100:.2f}%")
    print(f"  → TR − 일반(세전): 연 {100*(ann(mult_tr, dates)-ann(gross, dates)):+.2f}%p   TR − 일반(세후): 연 {100*(ann(mult_tr, dates)-ann(net, dates)):+.2f}%p")
    tot = sum(float(x["dividA"]) for x in divs); taxed = sum(float(x["taxDividA"]) for x in divs)
    print(f"  분배금 합 {tot:,.0f}원/주 중 과세분 {taxed:,.0f}원 ({taxed/tot*100:.0f}%)")


def pair_stats(base_code, code, label):
    a, b = load_px(base_code), load_px(code)
    dates, pa, pb = aligned(a, b)
    if len(dates) < 250:
        return None
    ra, rb = pa[1:] / pa[:-1] - 1, pb[1:] / pb[:-1] - 1
    diff = rb - ra
    cum = (pb[-1] / pb[0]) / (pa[-1] / pa[0])
    return dict(label=label, start=dates[0], n=len(dates), annual_gap=(cum ** (1 / (len(dates) / 245)) - 1) * 100,
                te=float(np.std(diff) * np.sqrt(245) * 100))


def section_bc(info):
    for title, base, kind in (("B. TR 상품 (기준 KODEX 200TR)", "278530", "tr"), ("C. 일반 상품 (기준 KODEX 200, 가격수익만)", "069500", "plain")):
        print(f"\n[{title}]  연 격차 = 기준 대비 가격수익 차이(%p/년), TE = 일간 추적오차 연율(%)")
        print(f"  {'코드':8}{'이름':16}{'공통시작':10}{'일수':>6}{'연격차%p':>10}{'TE%':>8}")
        for code, meta in info.items():
            if meta["kind"] != kind or code == base:
                continue
            s = pair_stats(base, code, meta["name"])
            if s:
                print(f"  {code:8}{meta['name']:16}{s['start']:10}{s['n']:6d}{s['annual_gap']:+10.3f}{s['te']:8.3f}")


def section_d(info):
    print("\n[D. 비용·규모]  (네이버 기준, 보수=펀드보수, 시총=순자산 억원, 거래대금=백만원/일 당일)")
    print(f"  {'코드':8}{'이름':16}{'구분':7}{'보수':>8}{'시총(억)':>11}{'거래대금(백만)':>15}{'상장':>10}{'현재가-NAV%':>12}")
    for code, m in sorted(info.items(), key=lambda kv: (kv[1]["kind"], -float(kv[1]["market_cap_eok"] or 0))):
        try:
            nav = float(str(m["nav"]).replace(",", ""))
            gap = (float(m["now"]) / nav - 1) * 100
        except Exception:
            gap = float("nan")
        print(f"  {code:8}{m['name']:16}{m['kind']:7}{m['fee']:>8}{m['market_cap_eok']:>11,}{m['trading_value_mil']:>15,}{m['first_date']:>10}{gap:12.3f}")


def main():
    info = json.load(open(f"{DIR}/info.json", encoding="utf-8"))
    section_a(info)
    section_bc(info)
    section_d(info)


if __name__ == "__main__":
    main()
