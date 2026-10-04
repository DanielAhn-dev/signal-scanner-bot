# -*- coding: utf-8 -*-
"""
계좌별 사용 시점 기준 단계 전환(글라이드 패스) 검증 (2026-10-04).

질문: 돈 쓸 날(목표일)이 정해진 계좌에서, 남은 기간에 따라 주식 비중을 미리 정한 표대로 내리면
      끝까지 100% 보유 / 고정 비중 대비 '목표일 직전 낙폭'과 '목표일 가치'가 어떻게 달라지나?

사전 고정한 전환표(결과를 보기 전에 정함, 남은 기간 → 주식 %):
  완만: 10년 초과 100 / 5~10년 80 / 3~5년 60 / 1~3년 40 / 1년 이내 20
  보수: 10년 초과 80  / 5~10년 60 / 3~5년 40 / 1~3년 20 / 1년 이내 0
비교: 100% 보유, 60% 고정, 전액 안전자산.
방법: 일시금 1을 시작월에 넣고 목표일(H년 뒤)까지 월 리밸런싱, 모든 시작월을 겹치는 창으로 본다.
지표: 목표일 배율(중앙값·나쁜 10%·최악), 명목 원금 미만 확률, 마지막 36개월 안 최대 낙폭(나쁜 10%·최악).
데이터: US = Shiller 1926~2023 명목 총수익(안전자산 변형: 연 3% 현금 / 합성 10년채), KR = 코스피 가격지수 1996~(배당 제외, 안전자산 연 3% 현금).
한계: 겹치는 창이라 독립 표본은 적다. KR은 표본이 짧다. 안전자산 연 3% 가정은 과거 실제 단기금리와 다르다. 비용·세금 없음.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_lump_vs_split_tolerance import us_nominal, kr_nominal, CASH_M  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HORIZONS = [3, 5, 10, 15]
TABLES = {
    "완만": [(10, 100), (5, 80), (3, 60), (1, 40), (0, 20)],
    "보수": [(10, 80), (5, 60), (3, 40), (1, 20), (0, 0)],
}


def glide_weight(table, remaining_years):
    """남은 기간이 임계값을 초과하면 해당 비중. 마지막 구간은 임계 0 이하까지."""
    for th, w in table:
        if remaining_years > th:
            return w / 100
    return table[-1][1] / 100


def weights_for(strategy, h_months):
    if strategy == "100% 보유":
        return np.ones(h_months)
    if strategy == "60% 고정":
        return np.full(h_months, 0.6)
    if strategy == "전액 안전":
        return np.zeros(h_months)
    return np.array([glide_weight(TABLES[strategy], (h_months - i) / 12) for i in range(h_months)])


def simulate(stock, safe, s, w):
    h = len(w)
    r = w * stock[s:s + h] + (1 - w) * safe[s:s + h]
    path = np.cumprod(1 + r)
    tail = path[-min(36, h):]
    base = np.concatenate(([path[-min(36, h) - 1]] if h > 36 else [1.0], tail))
    peak = np.maximum.accumulate(base)[1:]
    dd = (tail / peak - 1).min() * 100
    return path[-1], dd


def run(name, months, stock, safe):
    n = len(stock)
    print(f"\n##### {name} ({months[0]}~{months[-1]}) #####")
    strategies = ["100% 보유", "60% 고정", "완만", "보수", "전액 안전"]
    for hy in HORIZONS:
        h = hy * 12
        if n - h + 1 < 24:
            print(f"\n[{hy}년] 표본 부족")
            continue
        print(f"\n[{hy}년 뒤 사용] 시작 창 {n - h + 1}개")
        print(f"{'전략':<10s}{'중앙값':>8s}{'나쁜10%':>9s}{'최악':>7s}{'원금미만':>9s}{'마지막36개월 낙폭 나쁜10%':>26s}{'최악':>8s}")
        for st in strategies:
            w = weights_for(st, h)
            res = np.array([simulate(stock, safe, s, w) for s in range(n - h + 1)])
            end, dd = res[:, 0], res[:, 1]
            print(f"{st:<10s}{np.median(end):8.2f}{np.percentile(end, 10):9.2f}{end.min():7.2f}{(end < 1).mean() * 100:8.1f}%"
                  f"{np.percentile(dd, 10):26.1f}{dd.min():8.1f}")


def export():
    """화면용 요약(build_research_facts.py가 호출) — 미국·한국, 3/5/10년, 100% 보유·완만·보수"""
    out = {"tables": {k: [dict(over=th, stock=w) for th, w in v] for k, v in TABLES.items()}, "markets": {}}
    for key, loader, safe_cash in (("us", us_nominal, True), ("kr", kr_nominal, True)):
        months, stock, _ = loader()
        safe = np.full(len(stock), CASH_M) if safe_cash else None
        rows = []
        for hy in (3, 5, 10):
            h = hy * 12
            n = len(stock)
            row = {"years": hy, "starts": n - h + 1}
            for st, label in (("100% 보유", "hold"), ("완만", "gentle"), ("보수", "safe")):
                w = weights_for(st, h)
                res = np.array([simulate(stock, safe, s, w) for s in range(n - h + 1)])
                row[label] = dict(median=round(float(np.median(res[:, 0])), 2), bad10=round(float(np.percentile(res[:, 0], 10)), 2), worst=round(float(res[:, 0].min()), 2),
                                  lossPct=round(float((res[:, 0] < 1).mean() * 100), 1), ddBad10=round(float(np.percentile(res[:, 1], 10)), 1))
            rows.append(row)
        out["markets"][key] = dict(period=f"{months[0][:4]}-{months[0][4:]}~{months[-1][:4]}-{months[-1][4:]}", rows=rows)
    return out


def main():
    ms, st, bd = us_nominal()
    run("미국(안전자산 연 3% 현금)", ms, st, np.full(len(st), CASH_M))
    run("미국(안전자산 합성 10년채)", ms, st, bd)
    ms, st, bd = kr_nominal()
    run("한국 코스피(배당 제외, 안전자산 연 3% 현금)", ms, st, bd)


if __name__ == "__main__":
    main()
