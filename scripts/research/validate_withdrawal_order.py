# -*- coding: utf-8 -*-
"""
N2 인출 순서(일반계좌 vs 연금계좌) 세후 비교 (2026-10-07).
상황: 60세에 일반계좌 G와 연금계좌 P를 갖고, 매년 실질 일정한 세후 생활비 W를 90세까지 꺼낸다. 같은 자산(국내 주식형 ETF, 실질 총수익 r, 분배율 1.7%)이라 세금만 다르다.
세금·규칙 모형(안내 자료 일치, 법령 원문 미확인):
  일반계좌: 매매차익 비과세, 분배금만 매년 15.4%. 금융소득(분배금)이 연 1,000만원을 넘으면 지역가입자 건보료(7.19%×1.1314)가 금융소득 전액에 붙는다(재산 보험료는 순서와 무관해 제외).
  연금계좌: 60세에 연금 개시(연차 = 나이−59). 연금수령한도 = 직전 평가액÷(11−연차)×120%(연차 11 이상은 한도 없음). 한도 안에서만 인출.
            연금소득세 55~69세 5.5%·70~79세 4.4%·80세 이상 3.3%, 연 수령액이 1,500만원을 넘으면 전액 16.5%(분리과세 선택 가정).
            사적연금 수령액은 건보료 소득에 넣지 않음(안내 자료 일치).
전략: S1 일반 먼저(부족분만 연금, 한도 안) / S2 연금 먼저(한도 안에서 가능한 만큼, 부족분 일반) / S3 연금을 연 1,500만원 이하로만 쓰고 나머지 일반 / S4 두 계좌 잔액 비례.
평가: 90세 시점 세후 순자산 = 일반 + 연금×(1−3.3%). 생활비를 한 해라도 못 채우면 실패(비교에서 제외).
사전 판정 기준(결과 보기 전 고정): 일반 먼저(S1)가 연금 먼저(S2)보다 90세 세후 순자산이 +1% 이상 큰 시나리오가 실현 가능한 시나리오 중 90% 이상이면 '일반 먼저' 안내 채택, 10% 이하면 '연금 먼저', 그 사이면 '조건에 따라 다름'.
한계: 실질 일정 수익률(순서 위험 없음), 연금 개시 60세 고정, 종합과세 선택·세액공제 받지 않은 납입분(비과세)·재산 건보료·국민연금 병행 미반영, 종신형 연금 우대세율 제외.
"""
import sys
import itertools
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

T_DIV, DIST = 0.154, 0.017
HI_RATE = 0.0719 * 1.1314
START, END = 60, 90


def pension_rate(age, annual_gross):
    if annual_gross > 15_000_000 / 1e4:  # 만원 단위
        return 0.165
    return 0.055 if age < 70 else (0.044 if age < 80 else 0.033)


def simulate(G, P, W, r, strat):
    """금액 단위: 만원. 반환 (90세 세후 순자산, 실패 여부)"""
    g, p = float(G), float(P)
    for age in range(START, END):
        yr = age - 59
        limit = p / (11 - yr) * 1.2 if yr <= 10 else p  # 한도 없음(11년차~)은 잔액 전부 가능
        # 이번 해에 필요한 세후 현금: W + 건보료(일반 분배금 기준)
        fin_income = g * DIST
        hi = fin_income * HI_RATE if fin_income > 1000 else 0.0
        need = W + hi
        from_g = from_p = 0.0
        if strat == "S1":
            from_g = min(g, need)
            rest = need - from_g
            if rest > 1e-9:
                gross = rest / (1 - pension_rate(age, rest / (1 - 0.055)))
                from_p = min(limit, gross)
        elif strat == "S2":
            gross_cap = limit
            net_cap = gross_cap * (1 - pension_rate(age, gross_cap))
            take_net = min(need, net_cap)
            from_p = take_net / (1 - pension_rate(age, take_net / (1 - 0.055))) if take_net > 0 else 0.0
            from_p = min(from_p, limit)
            net_p = from_p * (1 - pension_rate(age, from_p))
            from_g = min(g, need - net_p)
        elif strat == "S3":
            cap = min(limit, 1500.0)
            net_cap = cap * (1 - pension_rate(age, cap))
            take_net = min(need, net_cap)
            from_p = take_net / (1 - pension_rate(age, take_net / (1 - 0.055))) if take_net > 0 else 0.0
            from_p = min(from_p, cap)
            net_p = from_p * (1 - pension_rate(age, from_p))
            from_g = min(g, need - net_p)
            if need - net_p - from_g > 1e-9:  # 일반 소진 → 한도 안에서 연금 추가
                extra_net = need - net_p - from_g
                add = min(limit - from_p, extra_net / (1 - 0.165))
                from_p += max(add, 0)
        else:  # S4 비례
            tot = g + p
            if tot <= 0:
                return 0.0, True
            sh_g = g / tot
            want_g = need * sh_g
            from_g = min(g, want_g)
            rest = need - from_g
            if rest > 1e-9:
                gross = rest / (1 - pension_rate(age, rest / (1 - 0.055)))
                from_p = min(limit, gross)
        net_p = from_p * (1 - pension_rate(age, from_p)) if from_p > 0 else 0.0
        if from_g + net_p < need - 1e-6:
            return 0.0, True
        g -= from_g; p -= from_p
        # 수익: 일반은 분배금 과세, 연금은 과세이연
        g = g * (1 + r - DIST) + g * DIST * (1 - T_DIV)
        p = p * (1 + r)
    return g + p * (1 - 0.033), False


scen = []
for r in (0.02, 0.035, 0.05):
    for G, P in ((15000, 15000), (10000, 20000), (20000, 10000), (25000, 25000), (5000, 25000), (30000, 30000)):
        for W in (960, 1200, 1500, 1800):
            scen.append((r, G, P, W))
print(f"시나리오 {len(scen)}개 (r·G·P·W 조합)")
res = {s: {k: simulate(s[1], s[2], s[3], s[0], k) for k in ("S1", "S2", "S3", "S4")} for s in scen}
feasible = [s for s in scen if all(not res[s][k][1] for k in ("S1", "S2"))]
print(f"S1·S2 모두 90세까지 생활비를 채우는 시나리오 {len(feasible)}개")
wins = 0
diffs = []
for s in feasible:
    a, b = res[s]["S1"][0], res[s]["S2"][0]
    d = (a - b) / b * 100 if b > 0 else float('inf')
    diffs.append(d)
    wins += d >= 1
diffs = np.array(diffs)
print(f"S1(일반 먼저) − S2(연금 먼저) 90세 순자산 차이: 중앙 {np.median(diffs):+.2f}%, 최소 {diffs.min():+.2f}%, 최대 {diffs.max():+.2f}%, +1% 이상 {wins}/{len(feasible)} = {wins/len(feasible)*100:.0f}%")
print("\n[대표 시나리오 r 3.5%, 일반 1.5억·연금 1.5억, 월 100만원(연 1,200만)] 90세 세후 순자산(만원)")
for k in ("S1", "S2", "S3", "S4"):
    v, fail = res[(0.035, 15000, 15000, 1200)][k]
    print(f"  {k}: {'실패' if fail else f'{v:,.0f}'}")
print("\n[시나리오별 S1/S2/S3/S4 순자산(만원, 실패는 -)]")
for s in scen:
    row = []
    for k in ("S1", "S2", "S3", "S4"):
        v, fail = res[s][k]
        row.append("-" if fail else f"{v:,.0f}")
    print(f"  r{s[0]*100:.1f}% 일반{s[1]/10000:.1f}억 연금{s[2]/10000:.1f}억 월{s[3]/12:.0f}만: " + " / ".join(row))

print("\n[요약] 실현 가능한(네 전략 중 하나라도 90세까지 채우는) 시나리오에서 전략별 최고 횟수와 평균 차이")
ok = [s for s in scen if any(not res[s][k][1] for k in ("S1", "S2", "S3", "S4"))]
best = {k: 0 for k in ("S1", "S2", "S3", "S4")}
for s in ok:
    vals = {k: (res[s][k][0] if not res[s][k][1] else -1) for k in best}
    best[max(vals, key=vals.get)] += 1
print(f"  시나리오 {len(ok)}개: 최고 횟수 {best}")
both = [s for s in scen if all(not res[s][k][1] for k in ("S1", "S4"))]
d14 = np.array([(res[s]['S4'][0] - res[s]['S1'][0]) / res[s]['S1'][0] * 100 for s in both])
print(f"  S4(비례) − S1(일반 먼저) 순자산 차이(S1·S4 모두 가능 {len(both)}개): 중앙 {np.median(d14):+.2f}%, S4가 앞선 비율 {(d14>0).mean()*100:.0f}%")
only4 = [s for s in scen if res[s]['S1'][1] and not res[s]['S4'][1]]
print(f"  일반 먼저는 실패하고 비례는 성공하는 시나리오 {len(only4)}개 (예: {only4[:2]})")
hi = [s for s in scen if s[3] >= 1500 and all(not res[s][k][1] for k in ('S1', 'S4'))]
print(f"  연 필요 1,500만원 이상(월 125만 이상) 시나리오 {len(hi)}개 중 S4가 앞선 비율 {np.mean([res[s]['S4'][0] > res[s]['S1'][0] for s in hi])*100:.0f}%")
lo = [s for s in scen if s[3] < 1500 and all(not res[s][k][1] for k in ('S1', 'S4'))]
print(f"  연 필요 1,500만원 미만 시나리오 {len(lo)}개 중 S1이 앞선 비율 {np.mean([res[s]['S1'][0] > res[s]['S4'][0] for s in lo])*100:.0f}%")
