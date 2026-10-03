# -*- coding: utf-8 -*-
"""
분배금 안정성 점검 (2026-10-03) — 월 50만원 같은 고정 인컴 계획에 분배금이 얼마나 맞춰 주나.
데이터: 운용사 실제 분배금 이력(.research-cache/div_*.json, 원/주). 상품: 커버드콜 1세대형 2종, 고배당 3종.
지표: 월 분배금(주당) 변동계수, 직전 12개월 평균 대비 최저 달 비율, 전월 대비 감소 달 비율, '평균의 80%/60% 미만인 달' 비율,
      12개월 롤링 합계(주당)의 최저/최고 — 월 50만원 목표 대비 몇 달이 모자랐는지.
한계: 주당 금액이라 기준가 변동·재투자 효과는 별도. 2022~2026 한국 강세장 위주, 1세대형만 있다(신형 상품 이력은 아직 없음).
"""
import json, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
P = {"289480": "커버드콜 TIGER200", "290080": "커버드콜 RISE ATM", "161510": "고배당 PLUS", "104530": "고배당 KIWOOM", "210780": "고배당 TIGER"}
print(f"{'상품':18s} {'건수':>4s} {'기간':>16s} {'월평균(원/주)':>12s} {'변동계수':>7s} {'감소한 달':>8s} {'평균80%미만':>10s} {'평균60%미만':>10s} {'12개월합 최저/최고':>16s}")
for c, nm in P.items():
    d = json.load(open(f".research-cache/div_{c}.json", encoding="utf-8"))
    d.sort(key=lambda x: x["recordDate"])
    by = {}
    for x in d:
        by[x["recordDate"][:7]] = by.get(x["recordDate"][:7], 0) + x["amount"]
    ms = sorted(by); a = np.array([by[m] for m in ms])
    # 월별 배열이 아니라 분기/반기 지급 상품(고배당)은 지급 달만 있을 수 있어 연속 달로 채워 0 포함
    allm = []
    y, mo = int(ms[0][:4]), int(ms[0][5:7])
    while f"{y}-{mo:02d}" <= ms[-1]:
        allm.append(f"{y}-{mo:02d}"); mo += 1
        if mo > 12: y += 1; mo = 1
    full = np.array([by.get(m, 0.0) for m in allm])
    pay_months = (full > 0).mean() * 100
    mean = full.mean()
    dec = (np.diff(a) < 0).mean() * 100 if len(a) > 1 else float('nan')
    roll = np.array([full[i:i + 12].sum() for i in range(len(full) - 11)]) if len(full) >= 12 else np.array([])
    print(f"{nm:18s} {len(d):>4d} {ms[0]}~{ms[-1][2:]} {mean:>12.0f} {full.std() / mean:>7.2f} {dec:>7.0f}% {(full < 0.8 * mean).mean() * 100:>9.0f}% {(full < 0.6 * mean).mean() * 100:>9.0f}% "
          + (f"{roll.min():>8.0f}/{roll.max():<7.0f}" if len(roll) else "      -") + f"  (지급 달 비율 {pay_months:.0f}%)")
