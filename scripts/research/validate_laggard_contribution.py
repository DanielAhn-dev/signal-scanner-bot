# -*- coding: utf-8 -*-
"""H55 뒤처진 쪽에 새 돈: 매달 적립금 전액을 직전 12개월 수익률이 낮은 지수에 넣기 vs 반반 적립.
기준은 hypothesis-ledger H55에 결과 보기 전 고정. 매도 없음, 비용 무시(두 방식 모두 매수만).
자료: KODEX 200(네이버 수정주가, 분배금 반영), SPY(야후 수정종가) × KRW=X 일봉 → 원화, 월말값."""
import sys, json
import numpy as np
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
C = ".research-cache/allweather"


def monthly(rows, col=1):
    m = {}
    for r in rows:
        m[r[0][:6]] = r[col]  # 날짜순이므로 마지막 값 = 월말
    return m


kr = monthly(json.load(open(f"{C}/kr_069500.json")))
spy = monthly(json.load(open(f"{C}/us_SPY.json")))
fx = monthly(json.load(open(f"{C}/us_KRW_X.json")))
months = sorted(m for m in kr if m in spy and m in fx and "200312" <= m <= "202609")
K = np.array([kr[m] for m in months], float)
U = np.array([spy[m] * fx[m] for m in months], float)
# 월 변화가 ±40%를 넘으면 자료 이상으로 보고 알린다(보정 필요 여부 확인용)
for name, a in (("KODEX200", K), ("SPY원화", U)):
    r = a[1:] / a[:-1] - 1
    bad = np.where(np.abs(r) > 0.4)[0]
    if len(bad):
        print("⚠ 이상 월", name, [months[i + 1] for i in bad])
T = len(months)
print(f"월말 {months[0]}~{months[-1]} ({T}개월)")


def run(s, n, mode):
    """s월부터 n개월 적립. 반환: 끝자산, 원금, 경로 최대낙폭, 끝 코스피 비중."""
    qk = qu = 0.0
    peak = 0.0; mdd = 0.0
    for t in range(s, s + n):
        if mode == "half":
            qk += 0.5 / K[t]; qu += 0.5 / U[t]
        else:
            rk = K[t] / K[t - 12] - 1; ru = U[t] / U[t - 12] - 1
            pick_k = (rk < ru) if mode == "lag" else (rk > ru)
            if pick_k:
                qk += 1 / K[t]
            else:
                qu += 1 / U[t]
        v = qk * K[t] + qu * U[t]
        # 적립 중 낙폭은 원금 대비 평가액 비율의 고점 대비로 본다
        ratio = v / (t - s + 1)
        peak = max(peak, ratio); mdd = min(mdd, ratio / peak - 1)
    v = qk * K[s + n - 1] + qu * U[s + n - 1]
    return v, n, mdd, qk * K[s + n - 1] / v


def study(n, label, judge):
    starts = list(range(12, T - n + 1))
    res = {m: [run(s, n, m) for s in starts] for m in ("half", "lag", "lead")}
    mult = {m: np.array([r[0] / r[1] for r in res[m]]) for m in res}
    ratio = mult["lag"] / mult["half"] - 1
    lead = mult["lead"] / mult["half"] - 1
    h = len(starts) // 2
    print(f"\n== {label}: 창 {len(starts)}개 (시작 {months[starts[0]]}~{months[starts[-1]]})")
    for m, nm in (("half", "반반"), ("lag", "뒤처진 쪽"), ("lead", "앞선 쪽(보조)")):
        md = np.array([r[2] for r in res[m]]); w = np.array([r[3] for r in res[m]])
        print(f"  {nm:10s} 배수 중앙 {np.median(mult[m]):.3f} 하위10% {np.percentile(mult[m], 10):.3f} "
              f"최저 {mult[m].min():.3f} | 경로낙폭 중앙 {np.median(md)*100:.1f}% 최악 {md.min()*100:.1f}% | 끝 코스피 비중 중앙 {np.median(w)*100:.0f}% (범위 {w.min()*100:.0f}~{w.max()*100:.0f}%)")
    print(f"  뒤처진÷반반 중앙 {np.median(ratio)*100:+.2f}% (앞 절반 {np.median(ratio[:h])*100:+.2f}%, 뒤 절반 {np.median(ratio[h:])*100:+.2f}%), 이긴 창 {np.mean(ratio > 0)*100:.0f}%")
    print(f"  앞선÷반반 중앙 {np.median(lead)*100:+.2f}% (앞 {np.median(lead[:h])*100:+.2f}%, 뒤 {np.median(lead[h:])*100:+.2f}%)")
    if judge:
        c1 = np.median(ratio) >= 0.02
        c2 = np.percentile(mult["lag"], 10) >= np.percentile(mult["half"], 10)
        c3 = np.median(ratio[:h]) > 0 and np.median(ratio[h:]) > 0
        print(f"  판정: (1) 중앙 ≥ +2% {'충족' if c1 else '미달'} · (2) 하위10% ≥ 반반 {'충족' if c2 else '미달'} · (3) 두 절반 양수 {'충족' if c3 else '미달'}"
              f" → {'통과' if c1 and c2 and c3 else '기각'}")


# 신호: 직전 12개월 수익률(이번 달 말 값 기준, 이번 달 말 적립 — 같은 월말 가격을 보고 그 가격에 산다)
picks = [(K[t] / K[t - 12]) < (U[t] / U[t - 12]) for t in range(12, T)]
print(f"뒤처진 쪽 = 코스피인 달 비율 {np.mean(picks)*100:.0f}%, 신호가 바뀐 횟수 {int(np.sum(np.diff(picks) != 0))}")
study(120, "10년 적립 (판정)", True)
study(180, "15년 적립 (보조)", False)
