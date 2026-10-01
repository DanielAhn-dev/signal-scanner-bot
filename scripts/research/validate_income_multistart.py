# -*- coding: utf-8 -*-
"""
분배금 재투자 vs 지수, 월별 다중 시작점 검증 (2026-10-01).

2026-09-29 reinvest.py(scratchpad, 소실됨)는 단일 시작점(2003-12~2026-09 등)만 봤다.
같은 질문을 belt.py 방식(모든 월말 시작점, 하위 10%·중앙값)으로 다시 본다.

데이터/가정 (전부 근사 — 정확한 장기 분배 이력이 없어 기존에 이 프로젝트가 쓰던 가정을 재사용):
  - 지수: KODEX200(069500) 실제 가격, 2002-10~2026-10. 분배 수익률 연 1.7%(2026-09-29 체결·세금
    재검증에서 쓴 가정)를 매월 균등 가산.
  - 고배당: KOSEF고배당(104530) 실제 가격, 2008-07~2026-10(지수보다 짧음). 분배 수익률 연 5%
    (incomeGuide.ts 가정 "국내 고배당 4~6%"의 중간값) 매월 가산.
  - 커버드콜: 실제 국내 상품이 다 짧아(2017~) 장기 검증이 안 돼, KODEX200 가격에 참여율 55%
    (기존 결론 "강세 해 지수 상승의 42~66%만 따라감"의 중간값) + 매월 프리미엄 수익률 연 8.5%
    (incomeGuide.ts 가정 "커버드콜ATM 8~9%")를 합성한 근사. 실제 옵션 데이터가 아니므로 참고용.

검증: 두 상품이 겹치는 기간(2008-07~2026-10)에서 모든 월말 시작점 × 5년(60개월) 보유,
분배금 전액 재투자 가정으로 60개월 뒤 배율을 모아 중앙값·하위10%를 비교한다.
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
    months_div, div_m = load_monthly_returns(".research-cache/px_104530.json")

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
    dividend_tr = apply_yield(div_c, 5.0)
    covered_call = covered_call_synth(kodex_c, 0.55, 8.5)
    blended = 0.5 * dividend_tr + 0.5 * covered_call  # 50:50 인컴 혼합 (incomeGuide 기본 구성과 유사)

    print(f"공통 구간: {common_start}~{common_end} ({n}개월)")
    for horizon_label, h in (("3년(36개월)", 36), ("5년(60개월)", 60), ("10년(120개월)", 120)):
        print(f"\n== {horizon_label} 보유, 모든 월말 시작점 ==")
        print(f"{'구성':14s} {'시작점수':>6s} {'중앙값':>8s} {'하위10%':>8s} {'최악':>8s} {'지수보다 나은 비율':>10s}")
        results = {}
        for label, series in (("지수(KODEX200)", index_tr), ("고배당(KOSEF)", dividend_tr),
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
