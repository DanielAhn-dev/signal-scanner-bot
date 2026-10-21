# -*- coding: utf-8 -*-
"""
H63 커버드콜 → 지수 전환 시점: VKOSPI 수준별 12개월 상대 성과 (2026-10-21).

판정 기준은 docs/hypothesis-ledger.md H63 행에 결과 보기 전에 고정했다. 여기서는 그대로 계산만 한다.

질문: 국내 지수 커버드콜을 KODEX 200으로 옮긴다면, VKOSPI(옵션 프리미엄 크기)가 낮을 때 옮기는 편이 나은가.
  논리: 프리미엄이 작을 때(VKOSPI 낮음)는 상승을 내주는 값에 비해 받는 돈이 적어 커버드콜이 더 뒤처질 수 있다.
자료: 네이버 수정주가(분배금 반영) 289480 TIGER 200커버드콜OTM · 290080 RISE 200고배당커버드콜ATM · 069500 KODEX 200, VKOSPI 일별.
방법: 매월 말 시작 → 12개월 뒤 (커버드콜 총수익 − KODEX 200 총수익). 시작 달 말 VKOSPI의 전체 기간 3분위로 나눈다.
한계: 2018~ 약 8년, 시작점이 겹쳐 독립 아님(실질 표본은 몇 해 분). 3분위 경계를 전체 기간으로 정해 그때는 알 수 없던 값이다.
      신형 위클리 타깃 커버드콜은 구조가 달라 대상 밖. 290080은 고배당 종목 바스켓이라 지수 차이도 섞인다.

실행: python scripts/research/validate_cc_switch_vkospi.py > .research-cache/cc_switch_vkospi_out.txt
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

CACHE = ".research-cache"
H = 12
ERA_SPLIT = "202201"
THRESH_PP = -3.0
PRODUCTS = {"289480": "TIGER 200커버드콜OTM", "290080": "RISE 200고배당커버드콜ATM"}


def month_end(path):
    by = {}
    for d, v in sorted(json.load(open(path, encoding="utf-8"))):
        if v:
            by[d[:6]] = float(v)
    return by


k200 = month_end(f"{CACHE}/px_069500.json")
vk = month_end(f"{CACHE}/vkospi.json")

print("H63 커버드콜 vs KODEX 200, 12개월 상대 성과(커버드콜 − 지수, %p) · VKOSPI 시작 달 말 3분위")
verdicts = []
for code, name in PRODUCTS.items():
    cc = month_end(f"{CACHE}/dividend_etfs/px_{code}.json")
    months = sorted(set(cc) & set(k200) & set(vk))
    months = months[1:-1]  # 첫 달(상장 달)·마지막 달(월말 아닐 수 있음) 제외
    rows = []
    for i in range(len(months) - H):
        m0, m1 = months[i], months[i + H]
        ex = (cc[m1] / cc[m0] - k200[m1] / k200[m0]) * 100
        rows.append((m0, vk[m0], ex))
    v = np.array([r[1] for r in rows])
    lo_cut, hi_cut = np.percentile(v, [100 / 3, 200 / 3])
    print(f"\n== {code} {name} · 시작 {rows[0][0]}~{rows[-1][0]} ({len(rows)}개) · 3분위 경계 VKOSPI {lo_cut:.1f} / {hi_cut:.1f} ==")

    def band(x):
        return "낮음" if x <= lo_cut else ("높음" if x > hi_cut else "중간")

    stats = {}
    for era_name, cond in (("전체", lambda m: True), ("2018~2021", lambda m: m < ERA_SPLIT), ("2022~", lambda m: m >= ERA_SPLIT)):
        parts = []
        for b in ("낮음", "중간", "높음"):
            xs = np.array([r[2] for r in rows if band(r[1]) == b and cond(r[0])])
            stats[(era_name, b)] = xs.mean() if len(xs) else float("nan")
            parts.append(f"{b} {stats[(era_name, b)]:+6.1f} (n {len(xs)}, 중앙 {np.median(xs) if len(xs) else float('nan'):+6.1f})")
        gap = stats[(era_name, "낮음")] - stats[(era_name, "높음")]
        stats[(era_name, "gap")] = gap
        print(f"  {era_name:9s} " + " · ".join(parts) + f"  → 낮음−높음 {gap:+.1f}%p")
    ok_all = stats[("전체", "gap")] <= THRESH_PP
    e0, e1 = stats[("2018~2021", "gap")], stats[("2022~", "gap")]
    same_sign = np.isfinite(e0) and np.isfinite(e1) and np.sign(e0) == np.sign(stats[("전체", "gap")]) == np.sign(e1)
    verdicts.append(ok_all and same_sign)
    print(f"  ⓐ 낮음−높음 {stats[('전체', 'gap')]:+.1f}%p ≤ {THRESH_PP:.0f}%p: {'예' if ok_all else '아니오'} · ⓑ 두 시기 같은 부호: {'예' if same_sign else '아니오'}")
    last = rows[-1]
    print(f"  (참고) VKOSPI 최근 월말 {months[-1]} {vk[months[-1]]:.1f} → {band(vk[months[-1]])}")

print(f"\n판정(사전 기준): 두 상품 모두 ⓐ·ⓑ → {'채택' if all(verdicts) else '기각'}")
