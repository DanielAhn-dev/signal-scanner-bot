# -*- coding: utf-8 -*-
"""
H40: 국내 고배당 3종에서 분배금을 받아 쓰고 재투자하지 않으면 재투자할 때보다 10년 뒤 자산이 의미 있게 적은가 (2026-10-12).
판정 기준은 docs/hypothesis-ledger.md H40에 결과 보기 전 고정.

네이버 일봉은 분배금이 소급 반영된 수정주가다. 분배금 이력(분배락일 = 기준일 직전 거래일로 가정)으로
실제(명목) 가격을 거꾸로 복원한다: F[t] = F[t+1] / (1 + F[t+1]·d / A[t]), 실제 가격 = A[t] / F[t].
  재투자: 분배락일에 세후 분배금으로 같은 상품을 추가 매수.
  수령  : 주식 수 고정, 세후 분배금은 무이자 현금으로 누적.
  R = (끝 실제가 + 누적 세후 현금) / 시작 실제가 ÷ 재투자 세후 끝 배수.

실행: python scripts/research/validate_highdiv_reinvest.py
"""
import json, os, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", ".research-cache")
TAX = 0.154
PRODUCTS = {"161510": "PLUS고배당주", "104530": "KIWOOM고배당", "210780": "TIGER코스피고배당"}


def load_px(code):
    for sub in ("dividend_etfs", ""):
        p = os.path.join(ROOT, sub, f"px_{code}.json")
        if os.path.exists(p):
            rows = sorted(json.load(open(p, encoding="utf-8")))
            return [r[0] for r in rows], np.array([float(r[1]) for r in rows])
    raise FileNotFoundError(code)


def load_div(code):
    d = json.load(open(os.path.join(ROOT, f"div_{code}.json"), encoding="utf-8"))
    return sorted((x["recordDate"].replace("-", ""), float(x["amount"])) for x in d)


def reconstruct(dates, A, divs):
    """수정주가 → 실제 가격, 분배락일 이벤트 {idx: 금액}."""
    ev = {}
    for rec, amt in divs:
        k = None
        for i, d in enumerate(dates):
            if d >= rec:
                k = i
                break
        if k is None or k == 0:
            continue
        ev[k] = ev.get(k, 0.0) + amt  # 분배락일 = 기준일 직전 거래일이 아니라 기준일 '이전' 마지막 거래일의 다음 = k-1 → 아래서 보정
    # k는 기준일(또는 그 이후 첫 거래일) 인덱스. 분배락일 = 직전 거래일 = k-1.
    ev = {k - 1: v for k, v in ev.items() if k - 1 >= 1}
    T = len(dates)
    F = np.ones(T)
    for t in range(T - 2, -1, -1):
        d = ev.get(t + 1, 0.0)
        # t+1이 분배락일이면 t까지의 수정계수를 낮춘다
        F[t] = F[t + 1] / (1 + F[t + 1] * d / A[t]) if d else F[t + 1]
    return A / F, ev


def month_end_idx(dates):
    out = {}
    for i, d in enumerate(dates):
        out[d[:6]] = i
    return out


def sim(raw, ev, s, e, tax):
    shares = 1.0
    cash = 0.0
    for k, d in ev.items():
        if s < k <= e:
            net = d * (1 - tax)
            shares += shares * net / raw[k]
            cash += net  # 수령은 주식 수 1 고정
    reinv = shares * raw[e] / raw[s]
    recv_total = (raw[e] + cash) / raw[s]
    return reinv, recv_total, raw[e] / raw[s], cash / raw[s]


def run(code, name):
    dates, A = load_px(code)
    raw, ev = reconstruct(dates, A, load_div(code))
    # 점검: 복원 가격 기준 연 분배율
    yrs = (len(dates)) / 245
    yld = sum(d / raw[k] for k, d in ev.items()) / yrs * 100
    print(f"\n### {name}({code}) 일봉 {dates[0]}~{dates[-1]}, 분배락 {len(ev)}회, 복원 기준 평균 연 분배율 {yld:.2f}% (복원 마지막 실제가 {raw[-1]:.0f} = 입력 {A[-1]:.0f})")
    me = month_end_idx(dates)
    months = sorted(me)
    res = {}
    for H, label in ((120, "10년"), (60, "5년")):
        rows = []
        for m in months:
            y, mm = int(m[:4]), int(m[4:])
            tm = f"{y + H // 12}{mm:02d}"
            if tm not in me:
                continue
            s, e = me[m], me[tm]
            ri, rt, pr, cs = sim(raw, ev, s, e, TAX)
            ri0, rt0, _, _ = sim(raw, ev, s, e, 0.0)
            rows.append((m, ri, rt, pr, cs, rt / ri, rt0 / ri0))
        res[H] = rows
        if not rows:
            print(f"  {label}: 시작점 없음")
            continue
        R = np.array([r[5] for r in rows])
        R0 = np.array([r[6] for r in rows])
        half = len(R) // 2
        cs_annual = np.mean([r[4] for r in rows]) / (H / 12) * 100
        print(f"  {label}: 시작점 {len(rows)}개 ({rows[0][0]}~{rows[-1][0]})")
        print(f"     재투자(세후) 배수 중앙값 {np.median([r[1] for r in rows]):.2f} | 수령 합계(원금+현금) 중앙값 {np.median([r[2] for r in rows]):.2f} | 수령 시 원금만 {np.median([r[3] for r in rows]):.2f}")
        print(f"     R 중앙값 {np.median(R):.3f} (하위10% {np.percentile(R,10):.3f}, 상위10% {np.percentile(R,90):.3f}), 전반 {np.median(R[:half]):.3f} / 후반 {np.median(R[half:]):.3f}, 세전 R 중앙값 {np.median(R0):.3f}")
        print(f"     수령 시 원금이 시작보다 낮은 시작점 {np.mean([r[3] < 1 for r in rows])*100:.0f}%, 연환산 세후 현금 수령률(시작가 대비) {cs_annual:.2f}%")
    return res


def verdict(res):
    print("\n=== 판정 (사전 기준) ===")
    vs = []
    for code, name in PRODUCTS.items():
        r = res[code]
        H = 120 if len(r[120]) >= 24 else 60
        rows = r[H]
        tag = "10년" if H == 120 else "5년(10년 시작점 24개 미만이라 대체)"
        if not rows:
            print(f"{name}: 판정 불가")
            vs.append("na")
            continue
        R = np.array([x[5] for x in rows])
        half = len(R) // 2
        med, a, b = np.median(R), np.median(R[:half]), np.median(R[half:])
        if med > 0.95:
            v = "기각"
        elif med <= 0.90 and a <= 0.95 and b <= 0.95:
            v = "채택"
        else:
            v = "혼재"
        vs.append(v)
        print(f"{name} [{tag}, n={len(R)}]: R 중앙값 {med:.3f}, 전반 {a:.3f}, 후반 {b:.3f} → {v}")
    if all(v == "채택" for v in vs):
        print("종합: 채택 (3종 모두 충족)")
    elif any(v == "기각" for v in vs):
        print("종합: 기각")
    else:
        print("종합: 혼재 또는 판정 불가 — 기술만")


if __name__ == "__main__":
    allres = {}
    for c, n in PRODUCTS.items():
        allres[c] = run(c, n)
    verdict(allres)
