# -*- coding: utf-8 -*-
"""
H19 비상금(실직 대비 생활비 현금)이 폭락기 강제 매도를 막아 끝자산을 지키는가 (2026-10-07).

사전 고정 판정 기준 (docs/hypothesis-ledger.md H19, 결과 보기 전):
  폭락(고점 대비 −20% 도달) 시작 6개월 안에 실직 확률 p(0.1·0.2·0.3)로 소득 0 →
  비상금 0·3·6·12개월 비교. 비상금이 없을 때 하위 10% 끝자산이 6개월 비상금보다 10% 이상 낮고,
  6→12개월 개선이 2% 미만이면 "6개월" 안내 채택.

세부 가정 (결과 보기 전 고정, 장부 기준에 없던 부분):
  - 단위: 월 지출 E=1(명목, 연 2% 증가). 소득은 지출의 1.4배 → 평소 월 저축 0.4(같이 연 2% 증가).
  - 시작 총자산 W0 = 지출 36개월분(기준). 비상금 N개월분은 그 안에서 현금으로 떼어 둔다(총액 같게 비교).
    민감도: W0 12개월·120개월분.
  - 주식: 한국은 KOSPI 월말 가격 + 배당 연 1.5% 근사(지수에 배당이 없어서). 미국 검증은 Shiller S&P500 총수익.
  - 현금 이자: 한국 CD91 월 평균(1998~). 미국은 Shiller GS10 − 1%p 근사(단기금리 자료 없음, 최저 0).
  - 폭락 사건: 지수가 직전 고점 대비 −20%를 처음 넘은 달. 그 뒤 전고점을 회복해야 다음 사건.
  - 실직: 사건마다 확률 p로, 넘은 달~5개월 뒤 중 균등하게 시작. 기간 9개월(기준), 민감도 6·12·18. 실업급여 무시(보수적).
  - 실직 중 지출은 현금 → 부족하면 그 달 주식을 팔아 충당. 주식도 없으면 빚(연 CD+5%).
  - 재취업 후(및 평소) 저축은 비상금을 목표액(N×현재 E)까지 먼저 채우고 나머지를 주식에. 거래 비용 무시.
  - 기간 10년, 시작 월마다, 시작 월당 실직 추첨 400회. 끝자산은 명목, 같은 시작 월끼리 비교 가능.
실행: python scripts/research/validate_emergency_fund.py
"""
import json
import sys

import numpy as np
import xlrd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
R = ".research-cache/"
HORIZON = 120
DRAWS = 400
NS = [0, 3, 6, 12]
PS = [0.1, 0.2, 0.3]


def month_end(rows):
    by = {}
    for d, v in rows:
        by[d[:6]] = float(v)
    return by


def month_avg(rows):
    acc = {}
    for d, v in rows:
        acc.setdefault(d[:6], []).append(float(v))
    return {k: sum(v) / len(v) for k, v in acc.items()}


def load_korea():
    px = month_end(json.load(open(R + "kospi.json")))
    cd = month_avg(json.load(open(R + "allweather/cd91.json")))
    keys = sorted(k for k in px if k in cd)
    price = np.array([px[k] for k in keys])
    ret = np.r_[0.0, price[1:] / price[:-1] - 1] + 0.015 / 12
    cash = np.array([cd[k] / 100 / 12 for k in keys])
    return keys, price, ret, cash


def load_us():
    sh = xlrd.open_workbook(R + "longrun/ie_data.xls").sheet_by_name("Data")
    keys, p, d, g = [], [], [], []
    for r in range(8, sh.nrows):
        v = sh.cell_value(r, 0)
        if not isinstance(v, float):
            continue
        vals = [sh.cell_value(r, c) for c in (1, 2, 6)]
        if not all(isinstance(x, float) for x in vals):
            continue
        y = int(v)
        m = int(round((v - y) * 100))
        keys.append(f"{y}{m:02d}")
        p.append(vals[0]); d.append(vals[1]); g.append(vals[2])
    price = np.array(p)
    ret = np.r_[0.0, (price[1:] + np.array(d[1:]) / 12) / price[:-1] - 1]
    cash = np.maximum(np.array(g) - 1.0, 0) / 100 / 12
    return keys, price, ret, cash


def crash_months(price):
    """−20% 첫 도달 달 목록 (전고점 회복 뒤에만 다음 사건)."""
    out, peak, armed = [], price[0], True
    for i, x in enumerate(price):
        if x >= peak:
            peak, armed = x, True
        elif armed and x <= peak * 0.8:
            out.append(i)
            armed = False
    return out


def simulate(ret, cash, start, w0, n, jobless, a=0.0):
    """jobless: 길이 HORIZON bool 배열. 끝자산(주식+현금−빚+연금×0.945) 반환.
    a: 연금계좌 비중(H25). 부족분은 현금 → 일반 주식 → 연금(인출액의 16.5% 기타소득세) 순."""
    c = float(n)
    pn = w0 * a
    s = w0 * (1 - a) - c
    if s < 0:
        return None  # 일반 계좌로 비상금을 못 만드는 설정
    for t in range(HORIZON):
        i = start + t
        e = 1.02 ** (t / 12)
        s *= 1 + ret[i]
        pn *= 1 + ret[i]
        c *= 1 + (cash[i] if c >= 0 else cash[i] + 0.05 / 12)
        if jobless[t]:
            c -= e
        else:
            save = 0.4 * e
            need = n * e - c
            if need > 0:
                put = min(save, need)
                c += put
                save -= put
            s += save * (1 - a)
            pn += save * a
        if c < 0 and s > 0:  # 부족분은 주식 매도
            sell = min(s, -c)
            s -= sell
            c += sell
        if c < 0 and pn > 0:  # 그래도 부족하면 연금 중도 인출
            w = min(pn, -c / 0.835)
            pn -= w
            c += w * 0.835
    return s + c + pn * 0.945


def run(name, keys, price, ret, cash, w0s=(36,), durs=(9,), a=0.0, cut=-0.10, ps=PS):
    crashes = crash_months(price)
    rng = np.random.default_rng(20261007)
    starts = range(0, len(keys) - HORIZON)
    print(f"\n=== {name}: {keys[0]}~{keys[-1]}, 시작 월 {len(starts)}개, −20% 사건 {len(crashes)}회 "
          f"({', '.join(keys[c] for c in crashes)})")
    for w0 in w0s:
        for dur in durs:
            for p in ps:
                ends = {n: [] for n in NS}
                for st in starts:
                    ev = [c - st for c in crashes if st <= c < st + HORIZON]
                    memo = {}
                    for _ in range(DRAWS):
                        bs = tuple(c + int(rng.integers(0, 6)) for c in ev if rng.random() < p)
                        if bs not in memo:
                            jl = np.zeros(HORIZON, bool)
                            for b in bs:
                                jl[b:b + dur] = True
                            memo[bs] = [simulate(ret, cash, st, w0, n, jl, a) for n in NS]
                        for j, n in enumerate(NS):
                            ends[n].append(memo[bs][j])
                nan = float("nan")
                p10 = {n: (np.percentile(ends[n], 10) if None not in ends[n] else nan) for n in NS}
                med = {n: (np.median(ends[n]) if None not in ends[n] else nan) for n in NS}
                gap0 = p10[0] / p10[6] - 1
                gain12 = p10[12] / p10[6] - 1
                ok = gap0 <= cut and (a > 0 or gain12 < 0.02)
                print(f"  연금 {a:.0%}·W0 {w0:>3}개월·실직 {dur:>2}개월·p {p}: 하위10% "
                      + " ".join(f"N{n}={p10[n]:.1f}" for n in NS)
                      + f" | 중앙값 " + " ".join(f"N{n}={med[n]:.1f}" for n in NS)
                      + f" | N0 대 N6 {gap0:+.1%}, N12 대 N6 {gain12:+.1%} → {'채택' if ok else '미달'}")


def main():
    k = load_korea()
    run("한국 KOSPI(+배당 1.5%)·CD91", *k, w0s=(36,), durs=(9,))
    print("\n[민감도: 한국]")
    run("한국 W0·실직 기간 민감도", *k, w0s=(12, 120), durs=(9,))
    run("한국 실직 기간 민감도", *k, w0s=(36,), durs=(6, 12, 18))
    u = load_us()
    run("미국 S&P500 총수익(Shiller)", *u, w0s=(36,), durs=(9,))
    print("\n[H25: 연금계좌 비중이 높을 때, 기준 N0 하위10%가 N6보다 5% 이상 낮음]")
    for a in (0.5, 0.7):
        run(f"한국 연금 비중 {a:.0%}", *k, w0s=(36,), durs=(9,), a=a, cut=-0.05, ps=(0.2,))
        print("  (민감도)")
        run(f"한국 연금 비중 {a:.0%} 민감도", *k, w0s=(12, 36), durs=(9, 18), a=a, cut=-0.05)
        run(f"미국 연금 비중 {a:.0%}", *u, w0s=(36,), durs=(9,), a=a, cut=-0.05, ps=(0.2,))


if __name__ == "__main__":
    main()
