# -*- coding: utf-8 -*-
"""
H5·H6 전향 판정의 검정력 점검 (2026-10-06).

H5 판정 기준(가설 장부): "경고 종목의 이후 60일 −10% 도달률이 기준보다 높고, 전·후반 같은 방향", 판정 2027-01.
문제: 경고는 2026-10-05부터 켜졌고 결과는 60거래일(약 3개월) 뒤에야 확정된다 → 2027-01에 결과가 나온 경고는 10~11월 초 신호뿐.
  같은 달 경고들은 같은 시장 움직임을 함께 겪으므로, 종목 수가 많아도 사실상 '한두 달짜리 표본 1개'다.
질문: 효과가 진짜(과거 전체로 확인됨)일 때, 달력 1·2·3개월 묶음 하나만 보고 판정하면 "경고 쪽이 더 많이 빠졌다"가 나올 확률은?
  그리고 −10%와 −20% 중 어느 문턱이 더 안정적인가(원래 연구는 −20%, 장부 기준은 −10%로 어긋나 있음).
데이터·신호 정의는 validate_weight_caution.py와 같다(A 과열, B 변동성 급등, 경고 = A 또는 B). 단 날짜 정렬을 위해 5거래일 간격 표본.
H6(시장 F3)은 1996~ 사건 6번이라 전향으로는 수년에 한두 번 켜진다 → 계산 없이 결론만 적는다.
"""
import pickle
import sys
from collections import defaultdict

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

x = pickle.load(open(".research-cache/px.pkl", "rb"))
H = 60
by_month = defaultdict(lambda: {"sig": [], "all": []})
rows = []  # (경고 여부, 60일 수익, 최대 하락, 최근 20일 변동성) — 변동성 맞춘 비교용
for code, v in x.items():
    if len(v) < 400:
        continue
    c = np.array([r[4] for r in v], float)
    vol = np.array([r[5] for r in v], float)
    if (c <= 0).any():
        continue
    r = np.diff(np.log(c))
    jump = np.abs(np.diff(c) / c[:-1]) > 0.31
    for i in range(260, len(c) - H, 5):
        d = v[i][0]
        if d[:4] < "2015" or jump[i - 20:i + H].any():
            continue
        if np.mean(c[i - 20:i] * vol[i - 20:i]) < 3e9:
            continue
        ma200 = c[i - 199:i + 1].mean()
        rv20 = r[i - 20:i].std()
        rvmed = np.median([r[j - 20:j].std() for j in range(i - 240, i, 20)])
        hi = c[i - 250:i + 1].max()
        mdd = c[i:i + H + 1].min() / c[i] - 1
        a = c[i] / ma200 - 1 > 0.6
        b = rv20 > 2 * rvmed and c[i] >= 0.9 * hi
        m = d[:6]
        rows.append((a or b, c[i + H] / c[i] - 1, mdd, rv20, d[:4]))
        by_month[m]["all"].append(mdd)
        if a or b:
            by_month[m]["sig"].append(mdd)

months = sorted(by_month)
print(f"표본 월 {months[0]}~{months[-1]} ({len(months)}개월), 5거래일 간격")


def cohort_stats(k, thr, min_sig=10):
    """연속 k개월 묶음마다 경고 쪽 도달률 − 전체 도달률. 겹치지 않게 k개월씩 끊는다"""
    diffs, ns = [], []
    for s in range(0, len(months) - k + 1, k):
        sig = sum((by_month[m]["sig"] for m in months[s:s + k]), [])
        al = sum((by_month[m]["all"] for m in months[s:s + k]), [])
        if len(sig) < min_sig:
            continue
        diffs.append(np.mean(np.array(sig) <= thr) - np.mean(np.array(al) <= thr))
        ns.append(len(sig))
    return np.array(diffs), ns


for thr in (-0.10, -0.20):
    sig_all = sum((by_month[m]["sig"] for m in months), [])
    al_all = sum((by_month[m]["all"] for m in months), [])
    print(f"\n=== 문턱 {thr*100:.0f}% (60거래일 안 도달) — 전체 기간: 경고 {np.mean(np.array(sig_all) <= thr)*100:.0f}% vs 전체 {np.mean(np.array(al_all) <= thr)*100:.0f}% ===")
    for k in (1, 2, 3, 6, 12):
        d, ns = cohort_stats(k, thr)
        print(f"  {k:2d}개월 묶음 {len(d):3d}개 (경고 표본 중앙 {int(np.median(ns))}): 경고 쪽이 더 높은 묶음 {np.mean(d > 0)*100:5.1f}% | "
              f"차이 중앙 {np.median(d)*100:+5.1f}%p, 하위 10% {np.percentile(d, 10)*100:+5.1f}%p")

print("\nH6(시장 F3): 2016~2026 사건 6번(연 0.6회). 2027-01까지 새 사건이 0~1번이라 전향 판정 불가 → 사건이 3번 더 쌓일 때까지 판정 보류.")


# --- 경고가 '변동성 큰 종목'이라는 것 말고 정보가 있나: 최근 20일 변동성 10분위 안에서 경고 vs 비경고 ---
print("\n=== 변동성 맞춘 비교 (최근 20일 변동성 10분위별, 경고 vs 비경고) ===")
arr = np.array([(s_, f, m, v) for s_, f, m, v, _ in rows], float)
yr = np.array([y for *_, y in rows])
sig, f, mdd_, rv = arr[:, 0] > 0, arr[:, 1], arr[:, 2], arr[:, 3]
edges = np.percentile(rv, np.arange(0, 101, 10))
dec = np.clip(np.searchsorted(edges, rv, side="right") - 1, 0, 9)


def matched(mask):
    out = []
    for q in range(10):
        s1 = mask & (dec == q) & sig
        s0 = mask & (dec == q) & ~sig
        if s1.sum() < 30 or s0.sum() < 30:
            continue
        out.append((q, s1.sum(), (mdd_[s1] <= -0.2).mean() - (mdd_[s0] <= -0.2).mean(), np.median(f[s1]) - np.median(f[s0]), np.mean(f[s1]) - np.mean(f[s0])))
    return out


for lab, mask in [("전체", np.ones(len(f), bool)), ("전반 2015~2020", yr <= "2020"), ("후반 2021~2026", yr >= "2021")]:
    res = matched(mask)
    w = np.array([n for _, n, *_ in res], float)
    dd = np.average([x for *_, x, _, _ in res], weights=w) * 100
    md = np.average([x for *_, _, x, _ in res], weights=w) * 100
    mn = np.average([x for *_, _, _, x in res], weights=w) * 100
    print(f"{lab}: 분위 {len(res)}개, 경고 표본 {int(w.sum())} | −20% 도달률 차 {dd:+.1f}%p | 60일 수익 중앙값 차 {md:+.1f}%p | 평균 차 {mn:+.1f}%p")
    if lab == "전체":
        for q, n, a1, b1, c1 in res:
            print(f"   변동성 {q+1}분위 n={n:5d}: −20% 도달률 차 {a1*100:+5.1f}%p, 수익 중앙값 차 {b1*100:+5.1f}%p, 평균 차 {c1*100:+5.1f}%p")
