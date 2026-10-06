# -*- coding: utf-8 -*-
"""
H14 적립금만으로 하는 리밸런싱(매도 없음)이 비중 유지에 충분한가 (2026-10-06).

validate_rebalance_effect.py는 2012-10 시작 하나로 끝자산만 봤다(모자란 쪽 몰아 적립 2.89배 < 고정 분할 3.15배).
여기서는 다중 시작점 × 초기 자산 크기별로 '비중 이탈'을 잰다. 4자산(KODEX200·나스닥100·국고채10년·골드) 25%씩, 월말 적립 1.
방식:
  fixed : 25%씩 고정 분할, 리밸런싱 없음
  fill  : 적립금을 목표 대비 모자란 자산에 몰아 넣음(매도 없음)
  band  : 25%씩 분할 + 월말 점검에서 어느 자산이든 ±5%p 벗어나면 매도·매수로 목표 복원
  hybrid: fill + 이탈이 10%p를 넘을 때만 매도 복원(매도는 비상용)
초기 자산(월 적립액 배수): 0·24·60·120 — 적립액 대비 자산이 클수록 적립만으로는 못 맞춘다.
지표: 월말 최대 이탈(4자산 중 |비중−25%| 최대)의 중앙값·95%, 이탈>10%p 개월 비율, 매도 횟수(연), 총납입 대비 배율.
사전 판정 기준(가설 장부 H14): fill의 이탈 중앙값이 band의 2배 이내면 '적립형 리밸런싱을 기본값'으로 채택.
  초기 자산 배수별로 따로 판정하고, 기준을 넘는 첫 배수를 '전환점'으로 기록한다.
비용: 매도·매수 금액의 0.1%.
"""
import contextlib
import io
import sys

import numpy as np

sys.path.insert(0, "scripts/research")
with contextlib.redirect_stdout(io.StringIO()):
    import validate_asset_allocation as a
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
R, T, dates, month_end = a.R, a.T, a.dates, a.month_end
ME = [i for i in month_end if i >= 250]
TGT = np.full(4, 0.25)
COST = 0.001


def run(s_idx, n_months, init_mult, mode):
    """ME[s_idx]부터 n_months 개월. 반환: (배율, 이탈 배열, 매도 횟수)"""
    start = ME[s_idx]
    end = ME[s_idx + n_months]
    v = TGT * init_mult
    paid = init_mult
    drifts, sells = [], 0
    me_set = set(ME[s_idx + 1: s_idx + n_months + 1])
    for i in range(start + 1, end + 1):
        v = v * (1 + R[i])
        if i not in me_set:
            continue
        paid += 1.0
        tot = v.sum() + 1.0
        if mode in ("fill", "hybrid"):
            gap = np.maximum(tot * TGT - v, 0)
            v = v + (gap / gap.sum() if gap.sum() > 0 else TGT)
        else:
            v = v + TGT
        tot = v.sum()
        dev = np.abs(v / tot - TGT).max()
        lim = {"band": 0.05, "hybrid": 0.10}.get(mode)
        if lim is not None and dev > lim:
            tr = np.abs(tot * TGT - v).sum() / 2
            tot -= tr * COST * 2
            v = tot * TGT
            sells += 1
            dev = 0.0
        drifts.append(dev)
    return v.sum() / paid, np.array(drifts), sells


print(f"4자산 일봉 {dates[250]}~{dates[-1]}, 월말 {len(ME)}개")
for n_months in (60, 120):
    starts = range(0, len(ME) - n_months)
    print(f"\n=== 보유 {n_months // 12}년, 시작점 {len(starts)}개 ===")
    print(f"{'초기자산':>8s} {'방식':7s} {'이탈 중앙':>8s} {'이탈 95%':>8s} {'>10%p 개월':>10s} {'매도/년':>7s} {'배율 중앙':>8s}")
    for init in (0, 24, 60, 120):
        med = {}
        for mode in ("fixed", "fill", "band", "hybrid"):
            mults, dr, sl = [], [], []
            for s in starts:
                m, d, k = run(s, n_months, init, mode)
                mults.append(m)
                dr.append(d)
                sl.append(k / (n_months / 12))
            alld = np.concatenate(dr)
            med[mode] = np.median(alld)
            print(f"{init:7d}배 {mode:7s} {np.median(alld)*100:7.1f}%p {np.percentile(alld, 95)*100:7.1f}%p "
                  f"{(alld > 0.10).mean()*100:9.1f}% {np.mean(sl):7.2f} {np.median(mults):8.3f}")
        ratio = med["fill"] / max(med["band"], 1e-9)
        print(f"         → fill 이탈 중앙값 / band = {ratio:.2f}배 → {'채택(2배 이내)' if ratio <= 2 else '기각'}")
