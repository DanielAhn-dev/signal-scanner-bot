# -*- coding: utf-8 -*-
"""
H57 반등 확인 전 대기 규칙 검증 (2026-10-17). 읽기 전용 연구, 매매 규칙에 쓰지 않는다.

질문: 조정장(코스피가 직전 250거래일 고점 대비 -10% 이하)에서 '반등 확인' 상태가 되기 전에는 사지 않는 편이 낫나?

사전 판정 기준(결과를 보기 전에 고정):
  신호 A  반등 확인 = 조정장 & 종가가 직전 20거래일 최저가보다 5% 이상 위 & 종가 > 20일선
  신호 B  미국 공포 완화 = VIX 직전 10거래일 최고가 25 이상 & 오늘 VIX <= 최고가 x 0.85 (다음 코스피 거래일부터 적용)
  비교군  A: 조정장 중 '확인 안 된' 날 / B: 조정장 아닌 날 포함 전체 날
  지표    신호일 종가 -> 20·60거래일 뒤 수익률, 그 20거래일 동안의 최대 추가 하락(MAE)
  표본    신호가 켜진 날을 20거래일 간격으로 솎아 독립 사건으로 센다
  채택    (1) 60일 수익 평균 차이가 Welch t >= 2  AND  (2) 전반(~2011)·후반(2012~) 모두 같은 방향  AND  (3) MAE 중앙이 비교군보다 얕다
  하나라도 못 넘으면 '기각'. 기각이면 값을 바꿔 다시 시도하지 않는다(튜닝 금지).

실행: python scripts/research/validate_rebound_confirmation.py
"""
import sys, json
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
END = "20260930"
kos = sorted((d, v) for d, v in json.load(open(C + "kospi.json", encoding="utf-8")) if d <= END)
dates = [d for d, _ in kos]
P = np.array([v for _, v in kos], float)
n = len(P)

# 직전 250거래일 고점 대비 낙폭, 20일 최저, 20일선
dd = np.full(n, np.nan); low20 = np.full(n, np.nan); ma20 = np.full(n, np.nan)
for i in range(250, n):
    dd[i] = P[i] / P[i - 250:i + 1].max() - 1
for i in range(20, n):
    low20[i] = P[i - 20:i + 1].min()
    ma20[i] = P[i - 19:i + 1].mean()
corr = (dd <= -0.10)
confirmed = corr & (P >= low20 * 1.05) & (P > ma20)
waiting = corr & ~confirmed

# VIX 신호 -> 다음 코스피 거래일
vix = sorted((d, v) for d, v in json.load(open(C + "yh_VIX_daily.json", encoding="utf-8")) if d <= END)
vd = [d for d, _ in vix]; vv = np.array([v for _, v in vix], float)
vix_sig_dates = set()
for i in range(10, len(vv)):
    mx = vv[i - 10:i].max()
    if mx >= 25 and vv[i] <= mx * 0.85:
        vix_sig_dates.add(vd[i])
kidx = {d: i for i, d in enumerate(dates)}
import bisect
vixsig = np.zeros(n, bool)
for d in vix_sig_dates:
    j = bisect.bisect_right(dates, d)  # d 다음 코스피 거래일
    if j < n:
        vixsig[j] = True


def events(mask, start=0, stop=None):
    out, last = [], -999
    for i in range(start, (stop or n)):
        if mask[i] and i - last >= 20:
            out.append(i); last = i
    return out


def stats(idx, h):
    r = [P[i + h] / P[i] - 1 for i in idx if i + h < n]
    return np.array(r)


def mae(idx):
    return np.array([P[i:i + 21].min() / P[i] - 1 for i in idx if i + 20 < n])


def welch(a, b):
    if len(a) < 3 or len(b) < 3:
        return float("nan")
    return (a.mean() - b.mean()) / np.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b))


def line(name, idx):
    r20, r60, m = stats(idx, 20), stats(idx, 60), mae(idx)
    return (f"  {name}: 사건 {len(idx)} | 20일 평균 {r20.mean()*100:+.1f}%·중앙 {np.median(r20)*100:+.1f}% | "
            f"60일 평균 {r60.mean()*100:+.1f}%·중앙 {np.median(r60)*100:+.1f}%·플러스 {(r60>0).mean()*100:.0f}% | "
            f"20일 안 최대 추가 하락 중앙 {np.median(m)*100:.1f}%")


split = bisect.bisect_left(dates, "20120101")
allmask = np.ones(n, bool); allmask[:250] = False
print(f"코스피 {dates[0]}~{dates[-1]}, 조정장(-10%) 일수 {int(corr.sum())}, 반등확인 {int(confirmed.sum())}, 대기 {int(waiting.sum())}, VIX 신호 {int(vixsig.sum())}")

def compare(label, A, B, nameA, nameB):
    print(f"\n[{label}]")
    ia, ib = events(A), events(B)
    print(line(nameA, ia)); print(line(nameB, ib))
    ta = welch(stats(ia, 60), stats(ib, 60))
    print(f"  60일 평균 차이 {(stats(ia,60).mean()-stats(ib,60).mean())*100:+.1f}%p, Welch t {ta:.2f}")
    for nm, lo, hi in (("전반 ~2011", 0, split), ("후반 2012~", split, n)):
        xa, xb = events(A, lo, hi), events(B, lo, hi)
        ra, rb = stats(xa, 60), stats(xb, 60)
        d = (ra.mean() - rb.mean()) * 100 if len(ra) and len(rb) else float("nan")
        print(f"  {nm}: {nameA} {len(xa)}건 vs {nameB} {len(xb)}건, 60일 평균 차이 {d:+.1f}%p")
    return ta

t1 = compare("신호 A: 조정장 중 반등 확인 vs 확인 전", confirmed, waiting, "반등 확인", "확인 전(대기)")
t2 = compare("신호 B: VIX 공포 완화 vs 전체", vixsig, allmask, "VIX 완화", "아무 날")
t3 = compare("참고: 조정장 전체 vs 조정장 아님", corr, allmask & ~corr, "조정장", "조정장 아님")
print("\n판정 요약: A t=%.2f, B t=%.2f (채택 문턱 2, 전후반 방향 일치·MAE 얕음도 필요)" % (t1, t2))
