# -*- coding: utf-8 -*-
"""
절반 익절 → 하락 시 재매수 반복 검증 (2026-10-13, 사용자 질문).
  "계좌 수익이 +10~20%면 절반 팔아 현금 확보, 떨어지면 다시 사는 걸 반복하면?"

규칙(사전 고정): 전액 보유에서 시작. 종가가 평단 대비 +T%면 절반 매도(현금).
  절반 상태에서 종가가 매도가 대비 -D%면 현금 전부 재매수, 평단은 가중평균으로 갱신. 반복.
  T ∈ {10,15,20}, D ∈ {5,10,15}. 체결은 신호 당일 종가(일봉 근사).
비교: 그냥 보유. 매월 첫 거래일 시작점마다 5년(1250거래일). 현금 연 3%.
비용: 수수료 0.015% 양쪽, 매도세 0.20%(개별주만, 국내 ETF 면제).
사전 판정: 전반·후반 모두 5년 배율 중앙값이 보유 대비 +3%p 이상이고 하위10%가 보유보다 나쁘지 않으면 채택.
전 종목 확장(인자 universe): 규칙 A(+20% 절반 현금·-10% 재매수)와 규칙 B(+20% 절반을 KODEX200으로, 재매수 없음, 매수 뒤 첫 도달 1회)를
  px.pkl 전 종목(5년 시작점 6개월 간격, 종목별 중앙값)에 적용. B 사전 기준(결과 전 고정): 그냥 보유 대비 이긴 종목 60% 이상,
  5년 중앙 +3% 이상, 최대 낙폭 중앙 3%p 이상 개선. 지수 100%·처음부터 50:50과도 비교.
  실행: python validate_trim_rebuy.py [1250|2500|universe]
데이터: px.pkl(개별주 2014~, 수정주가), px_069500.json(KODEX200 2002~, 분배금 반영 수정주가), kospi.json(가격지수 1996~).
"""
import json
import pickle
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = __file__.rsplit("scripts", 1)[0] + ".research-cache/"
RC = 1.03 ** (1 / 250) - 1
FEE = 0.00015
ARG = sys.argv[1] if len(sys.argv) > 1 else "1250"
H = int(ARG) if ARG.isdigit() else 1250


def load():
    px = pickle.load(open(ROOT + "px.pkl", "rb"))
    out = {}
    for code, name in [("035420", "네이버"), ("000660", "SK하이닉스"), ("005930", "삼성전자")]:
        rows = px[code]
        out[name] = ([r[0] for r in rows], np.array([r[4] for r in rows], float), 0.002)
    r = json.load(open(ROOT + "px_069500.json"))
    out["KODEX200"] = ([x[0] for x in r], np.array([x[1] for x in r], float), 0.0)
    r = sorted(json.load(open(ROOT + "kospi.json", encoding="utf-8")), key=lambda x: x[0])
    out["코스피(가격지수 1996~)"] = ([x[0] for x in r], np.array([x[1] for x in r], float), 0.0)
    return out


def run(c, s, e, T, D, tax):
    sh, cash = 1.0 / c[s], 0.0
    base = c[s]
    half, sell_px = False, 0.0
    peak, mdd, trades = 1.0, 0.0, 0
    for i in range(s + 1, e + 1):
        cash *= 1 + RC
        p = c[i]
        if not half and p >= base * (1 + T):
            q = sh / 2
            cash += q * p * (1 - FEE - tax)
            sh -= q
            half, sell_px = True, p
            trades += 1
        elif half and p <= sell_px * (1 - D):
            q = cash / (p * (1 + FEE))
            base = (sh * base + q * p) / (sh + q)
            sh += q
            cash = 0.0
            half = False
            trades += 1
        v = sh * p + cash
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return sh * c[e] + cash, mdd, trades, half


def hold(c, s, e):
    seg = c[s:e + 1] / c[s]
    return seg[-1], (seg / np.maximum.accumulate(seg) - 1).min()


def main():
    data = load()
    for name, (dates, c, tax) in data.items():
        firsts, seen = [], set()
        for i, d in enumerate(dates):
            if d[:6] not in seen:
                seen.add(d[:6])
                if i + H < len(c):
                    firsts.append(i)
        mid = firsts[len(firsts) // 2]
        print(f"\n=== {name} ({dates[0][:4]}~, 5년 시작점 {len(firsts)}개, 전반/후반 경계 {dates[mid]}) ===")
        hs = np.array([hold(c, s, s + H) for s in firsts])
        print(f"{'규칙':16s} {'중앙값':>7s} {'하위10%':>8s} {'최악':>6s} {'최대낙폭중앙':>10s} {'차이(전반/후반, %p)':>20s} {'5년 매매':>7s} {'끝에 절반현금':>10s} 판정")
        print(f"{'그냥 보유':16s} {np.median(hs[:,0]):7.2f} {np.percentile(hs[:,0],10):8.2f} {hs[:,0].min():6.2f} {np.median(hs[:,1])*100:9.1f}%")
        for T in (0.10, 0.15, 0.20):
            for D in (0.05, 0.10, 0.15):
                r = np.array([run(c, s, s + H, T, D, tax) for s in firsts])
                f = r[:, 0]
                diffs = []
                for sel in (np.array(firsts) < mid, np.array(firsts) >= mid):
                    diffs.append((np.median(f[sel]) - np.median(hs[sel, 0])) * 100)
                ok = all(x >= 3 for x in diffs) and np.percentile(f, 10) >= np.percentile(hs[:, 0], 10)
                print(f"+{int(T*100)}% 절반/-{int(D*100)}% 재매수 {np.median(f):6.2f} {np.percentile(f,10):8.2f} {f.min():6.2f} {np.median(r[:,1])*100:9.1f}% {diffs[0]:+9.0f} / {diffs[1]:+6.0f} {np.median(r[:,2]):7.0f} {np.mean(r[:,3])*100:9.0f}% {'채택' if ok else '기각'}")



def run_to_index(c, kx, s, e, T=0.20, tax=0.002):
    sh, ix, done = 1.0 / c[s], 0.0, False
    peak, mdd = 1.0, 0.0
    for i in range(s + 1, e + 1):
        if not done and c[i] >= c[s] * (1 + T):
            q = sh / 2
            ix += q * c[i] * (1 - FEE - tax) * (1 - FEE) / kx[i]
            sh -= q
            done = True
        v = sh * c[i] + ix * kx[i]
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return sh * c[e] + ix * kx[e], mdd


def universe():
    px = pickle.load(open(ROOT + "px.pkl", "rb"))
    k = dict((d, v) for d, v in json.load(open(ROOT + "px_069500.json")))
    R = []
    for code, rows in px.items():
        rows = [r for r in rows if r[0] in k]
        c = np.array([r[4] for r in rows], float)
        if len(c) < H + 250 or (c <= 0).any():
            continue
        kx = np.array([k[r[0]] for r in rows], float)
        seen, firsts = set(), []
        for i, r in enumerate(rows):
            if r[0][:6] not in seen:
                seen.add(r[0][:6])
                if i + H < len(c):
                    firsts.append(i)
        out = []
        for s in firsts[::6]:
            e = s + H
            h, hm = hold(c, s, e)
            b, bm = run_to_index(c, kx, s, e)
            a, am, _, _ = run(c, s, e, 0.20, 0.10, 0.002)
            half_cash = 0.5 * h + 0.5 * (1 + RC) ** H
            mix = 0.5 * h + 0.5 * kx[e] / kx[s]
            idx = kx[e] / kx[s]
            out.append((b / h - 1, bm - hm, a / h - 1, am - hm, b / a - 1, a / half_cash - 1, b / mix - 1, b / idx - 1, h / idx - 1, h))
        R.append(np.median(np.array(out), axis=0))
    R = np.array(R)
    pct = lambda col: (np.median(R[:, col]) * 100, np.mean(R[:, col] > 0) * 100)
    print(f"전 종목 {len(R)}개, 5년, 규칙 +20%/-10%(A)·+20% 절반→지수(B), 종목별 중앙값의 중앙")
    print("A vs 그냥 보유:        중앙 %+.1f%%, 이긴 종목 %.0f%%" % pct(2), "· 낙폭 개선 %+.1f%%p" % (np.median(R[:, 3]) * 100))
    print("A vs 처음부터 50%%현금: 중앙 %+.1f%%, 이긴 종목 %.0f%%" % pct(5))
    print("B vs 그냥 보유:        중앙 %+.1f%%, 이긴 종목 %.0f%%" % pct(0), "· 낙폭 개선 %+.1f%%p" % (np.median(R[:, 1]) * 100))
    print("B vs A:                중앙 %+.1f%%, B가 이긴 종목 %.0f%%" % pct(4))
    print("B vs 처음부터 50:50(개별주:지수): 중앙 %+.1f%%, B가 이긴 종목 %.0f%%" % pct(6))
    print("그냥 보유 vs 지수 100%%: 중앙 %+.1f%%, 지수를 이긴 종목 %.0f%%" % pct(8))
    print("B vs 지수 100%%:        중앙 %+.1f%%, 지수를 이긴 종목 %.0f%%" % pct(7))
    for lab, sel in [("내린 종목", R[:, 9] < 1), ("1~2배", (R[:, 9] >= 1) & (R[:, 9] < 2)), ("2배 이상", R[:, 9] >= 2)]:
        print(f"  {lab} {sel.sum()}종목: A vs 보유 {np.median(R[sel,2])*100:+.1f}%, B vs 보유 {np.median(R[sel,0])*100:+.1f}% (이긴 {np.mean(R[sel,0]>0)*100:.0f}%), B vs A {np.median(R[sel,4])*100:+.1f}%")
    ok = np.mean(R[:, 0] > 0) >= 0.6 and np.median(R[:, 0]) >= 0.03 and np.median(R[:, 1]) >= 0.03
    print("B 판정:", "사전 기준 통과" if ok else "기각")


if ARG == "universe":
    universe()
else:
    main()
