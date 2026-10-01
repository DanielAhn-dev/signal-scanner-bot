# -*- coding: utf-8 -*-
"""
분배금 재투자 vs 지수, 월별 다중 시작점 검증 (2026-10-01, 실제 분배금 지급 이력 5종으로 보강).

2026-09-29 reinvest.py(scratchpad, 소실됨)는 단일 시작점만 봤다. belt.py 방식대로
모든 월말 시작점(각 상품 자기 역사 내)으로 다시 본다. 상품 하나만 보면 그 운용사의
종목선정·리밸런싱 편향이 섞이므로, 여러 상품을 나란히 비교해 결론이 상품에 상관없이
유지되는지 확인한다(이 프로젝트의 원칙 — 개별 사례가 아니라 표본 전체의 일관성을 본다).

데이터 (전부 사용자가 운용사 공식 페이지에서 받아온 실제 분배금 지급 이력 + 네이버 실제 가격):
  - 지수: KODEX200(069500). 분배 수익률은 삼성자산운용 실제 API(20건, 2021~)로 반영,
    그 이전 구간은 연 2.3%(2022~2025 실측 평균) 근사.
  - 국내 고배당: PLUS고배당주(161510, 2013~), KIWOOM고배당(104530, 2009~), TIGER코스피고배당(210780, 2015~)
  - 국내 커버드콜: TIGER200커버드콜(289480, 2022~), RISE200고배당커버드콜ATM(290080, 2021~)
    (둘 다 실제 상품 데이터 — 전에 쓴 "참여율+프리미엄 합성 모델"은 더 이상 쓰지 않는다)

검증: 각 상품은 자기 역사가 허용하는 만큼의 모든 월말 시작점 × 3/5/10년 보유로 재투자 배율을
모아 중앙값·하위10%·지수 대비 승률을 비교한다. 상품마다 시작일이 달라 호라이즌별로 표본 수가 다르다.
"""
import json

import numpy as np


def load_monthly_price(path: str) -> tuple[list[str], np.ndarray]:
    rows = json.load(open(path, encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    by_month: dict[str, float] = {}
    for d, c in rows:
        by_month[d[:6]] = c  # 월말값으로 덮어씀
    months = sorted(by_month.keys())
    return months, np.array([by_month[m] for m in months], dtype=float)


def monthly_total_returns(months: list[str], closes: np.ndarray, div_path: str | None) -> np.ndarray:
    """월별 가격 시리즈 + (있으면) 실제 분배금 지급 이력으로 총수익(TR) 월간 수익률을 만든다."""
    div_by_month: dict[str, float] = {}
    if div_path:
        divs = json.load(open(div_path, encoding="utf-8"))
        for d in divs:
            key = d["recordDate"][:4] + d["recordDate"][5:7]
            div_by_month[key] = div_by_month.get(key, 0) + d["amount"]

    rets = np.empty(len(months) - 1)
    for i in range(1, len(months)):
        prev_close = closes[i - 1]
        div = div_by_month.get(months[i], 0.0)
        rets[i - 1] = (closes[i] - prev_close + div) / prev_close
    return rets


def apply_flat_yield(rets: np.ndarray, annual_yield_pct: float) -> np.ndarray:
    return rets + annual_yield_pct / 100 / 12


def multi_start_multiples(rets: np.ndarray, horizon_months: int) -> np.ndarray:
    n = len(rets) - horizon_months
    if n <= 0:
        return np.array([])
    out = np.empty(n)
    for i in range(n):
        out[i] = np.prod(1 + rets[i:i + horizon_months])
    return out


PRODUCTS = [
    # label, price_path, div_path(또는 None), 비고
    ("고배당 KIWOOM(104530)", ".research-cache/dividend_etfs/px_104530.json", ".research-cache/div_104530.json"),
    ("고배당 PLUS(161510)", ".research-cache/px_161510.json", ".research-cache/div_161510.json"),
    ("고배당 TIGER(210780)", ".research-cache/dividend_etfs/px_210780.json", ".research-cache/div_210780.json"),
    ("커버드콜 TIGER200(289480)", ".research-cache/dividend_etfs/px_289480.json", ".research-cache/div_289480.json"),
    ("커버드콜 RISE200ATM(290080)", ".research-cache/dividend_etfs/px_290080.json", ".research-cache/div_290080.json"),
]


def main():
    idx_months, idx_closes = load_monthly_price(".research-cache/px_069500.json")
    idx_rets_raw = idx_closes[1:] / idx_closes[:-1] - 1
    idx_rets = apply_flat_yield(idx_rets_raw, 2.3)
    idx_months_r = idx_months[1:]
    idx_month_pos = {m: i for i, m in enumerate(idx_months_r)}

    for horizon_label, h in (("3년(36개월)", 36), ("5년(60개월)", 60), ("10년(120개월)", 120)):
        print(f"\n== {horizon_label} 보유, 상품별 모든 월말 시작점 (재투자) ==")
        print(f"{'구성':26s} {'시작점수':>6s} {'중앙값':>8s} {'하위10%':>8s} {'최악':>8s} {'지수보다 나은 비율':>10s}")

        for label, price_path, div_path in PRODUCTS:
            p_months, p_closes = load_monthly_price(price_path)
            p_rets = monthly_total_returns(p_months, p_closes, div_path)
            p_months_r = p_months[1:]

            common = [m for m in p_months_r if m in idx_month_pos]
            if len(common) < h + 1:
                print(f"{label:26s}  (기간 부족: {len(common)}개월 < {h+1})")
                continue
            p_pos = {m: i for i, m in enumerate(p_months_r)}
            p_series = np.array([p_rets[p_pos[m]] for m in common])
            idx_series = np.array([idx_rets[idx_month_pos[m]] for m in common])

            p_m = multi_start_multiples(p_series, h)
            idx_m = multi_start_multiples(idx_series, h)
            if len(p_m) == 0:
                continue
            beat = np.mean(p_m >= idx_m) * 100
            print(f"{label:26s} {len(p_m):6d} {np.median(p_m):8.2f} {np.percentile(p_m,10):8.2f} {p_m.min():8.2f} {beat:9.1f}%")
            if label == PRODUCTS[0][0]:
                idx_only = multi_start_multiples(idx_series, h)
                print(f"{'  (참고) 지수, 같은 구간':26s} {len(idx_only):6d} {np.median(idx_only):8.2f} {np.percentile(idx_only,10):8.2f} {idx_only.min():8.2f} {'기준':>9s}")


if __name__ == "__main__":
    main()
