# -*- coding: utf-8 -*-
"""
분배금 재투자 vs 지수, 월별 다중 시작점 검증 (2026-10-01, 2026-10-01 실데이터로 보강).

2026-09-29 reinvest.py(scratchpad, 소실됨)는 단일 시작점(2003-12~2026-09 등)만 봤다.
같은 질문을 belt.py 방식(모든 월말 시작점, 하위 10%·중앙값)으로 다시 본다.

데이터:
  - 지수: KODEX200(069500) 실제 가격, 2002-10~2026-10. 분배 수익률 연 2.3%(삼성자산운용 실제
    분배금 API 2022~2025 실측 평균)을 매월 균등 가산 — 실제 분배 이력은 20건(2021~)뿐이라 그 이전은 근사.
  - 고배당: PLUS(구 ARIRANG) 고배당주(161510) 실제 가격 + **사용자가 받아온 실제 분배금 지급
    이력(2013~2026, 43건, 운용사 공식 페이지 엑셀)**. 2024-05 전까지는 연 1회(4월) 지급, 그 뒤로는
    월 지급으로 바뀌었다 — 가정이 아니라 실제 지급 패턴 그대로 반영.
  - 커버드콜: 실제 국내 상품이 다 짧아(2017~) 장기 검증이 안 돼, KODEX200 가격에 참여율 55%
    (기존 결론 "강세 해 지수 상승의 42~66%만 따라감"의 중간값) + 매월 프리미엄 수익률 연 8.5%
    (incomeGuide.ts 가정 "커버드콜ATM 8~9%")를 합성한 근사. 실제 옵션 데이터가 아니므로 참고용.

검증: 두 상품이 겹치는 기간에서 모든 월말 시작점 × 3/5/10년 보유, 분배금 전액 재투자 가정으로
기간 뒤 배율을 모아 중앙값·하위10%를 비교한다.
"""
import json

import numpy as np


def load_monthly_returns(path: str) -> tuple[list[str], np.ndarray]:
    rows = json.load(open(path, encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    by_month: dict[str, tuple[str, float]] = {}
    for d, c in rows:
        key = d[:6]
        by_month[key] = (d, c)  # 그 달의 마지막 거래일로 덮어씀 (월말값)
    months = sorted(by_month.keys())
    closes = np.array([by_month[m][1] for m in months], dtype=float)
    rets = closes[1:] / closes[:-1] - 1
    return months[1:], rets


def load_monthly_total_returns_with_real_dividends(
    price_path: str, div_path: str
) -> tuple[list[str], np.ndarray]:
    """실제 분배금 지급액을 그 달의 월말가 대비 추가수익률로 더한 총수익(TR) 월별 시리즈."""
    rows = json.load(open(price_path, encoding="utf-8"))
    rows.sort(key=lambda r: r[0])
    by_month: dict[str, float] = {}
    for d, c in rows:
        by_month[d[:6]] = c  # 월말값으로 덮어씀
    months = sorted(by_month.keys())
    closes = np.array([by_month[m] for m in months], dtype=float)

    divs = json.load(open(div_path, encoding="utf-8"))
    div_by_month: dict[str, float] = {}
    for d in divs:
        key = d["recordDate"][:4] + d["recordDate"][5:7]
        div_by_month[key] = div_by_month.get(key, 0) + d["amount"]

    rets = np.empty(len(months) - 1)
    for i in range(1, len(months)):
        prev_close = closes[i - 1]
        div = div_by_month.get(months[i], 0.0)
        rets[i - 1] = (closes[i] - prev_close + div) / prev_close
    return months[1:], rets


def apply_yield(rets: np.ndarray, annual_yield_pct: float) -> np.ndarray:
    return rets + annual_yield_pct / 100 / 12


def covered_call_synth(rets: np.ndarray, participation: float, annual_premium_pct: float) -> np.ndarray:
    # 상승월은 참여율만큼만, 하락월은 그대로 노출 + 매달 프리미엄 고정 수익
    capped = np.where(rets > 0, rets * participation, rets)
    return capped + annual_premium_pct / 100 / 12


def multi_start_multiples(rets: np.ndarray, horizon_months: int) -> np.ndarray:
    n = len(rets) - horizon_months
    if n <= 0:
        return np.array([])
    out = np.empty(n)
    for i in range(n):
        out[i] = np.prod(1 + rets[i:i + horizon_months])
    return out


def main():
    months_idx, kodex_m = load_monthly_returns(".research-cache/px_069500.json")
    months_div, div_m = load_monthly_total_returns_with_real_dividends(
        ".research-cache/px_161510.json", ".research-cache/div_161510.json"
    )

    common_start = max(months_idx[0], months_div[0])
    common_end = min(months_idx[-1], months_div[-1])

    def slice_common(months, rets):
        lo = months.index(common_start)
        hi = months.index(common_end)
        return rets[lo:hi + 1]

    kodex_c = slice_common(months_idx, kodex_m)
    div_c = slice_common(months_div, div_m)
    n = min(len(kodex_c), len(div_c))
    kodex_c, div_c = kodex_c[:n], div_c[:n]

    # 2.3% = 삼성자산운용 실제 분배금 API 2022~2025 실측 평균(연 2.0~2.75%). 예전 가정(1.7%)보다 높음.
    index_tr = apply_yield(kodex_c, 2.3)
    dividend_tr = div_c  # 161510 실제 분배금이 이미 더해진 총수익 — 추가 가산 없음
    covered_call = covered_call_synth(kodex_c, 0.55, 8.5)
    blended = 0.5 * dividend_tr + 0.5 * covered_call  # 50:50 인컴 혼합 (incomeGuide 기본 구성과 유사)

    print(f"공통 구간: {common_start}~{common_end} ({n}개월)")
    for horizon_label, h in (("3년(36개월)", 36), ("5년(60개월)", 60), ("10년(120개월)", 120)):
        print(f"\n== {horizon_label} 보유, 모든 월말 시작점 ==")
        print(f"{'구성':14s} {'시작점수':>6s} {'중앙값':>8s} {'하위10%':>8s} {'최악':>8s} {'지수보다 나은 비율':>10s}")
        results = {}
        for label, series in (("지수(KODEX200)", index_tr), ("고배당(PLUS161510,실데이터)", dividend_tr),
                               ("커버드콜(합성)", covered_call), ("고배당+커버드콜 50:50", blended)):
            m = multi_start_multiples(series, h)
            results[label] = m
        index_m = results["지수(KODEX200)"]
        for label, m in results.items():
            if len(m) == 0:
                continue
            beat = np.mean(m >= index_m[:len(m)]) * 100 if label != "지수(KODEX200)" else 100.0
            print(f"{label:14s} {len(m):6d} {np.median(m):8.2f} {np.percentile(m,10):8.2f} {m.min():8.2f} {beat:9.1f}%")


if __name__ == "__main__":
    main()
