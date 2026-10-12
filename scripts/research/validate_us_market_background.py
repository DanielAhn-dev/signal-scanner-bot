# -*- coding: utf-8 -*-
"""
H42 (2026-10-12): 하락 전 배경 신호(H29a)의 미국 재현. 정의·판정 기준은 docs/hypothesis-ledger.md H42에 결과 보기 전 고정.

신호(종가 t까지의 정보만 사용)
  A 과열        : S&P500 종가 ≥ 200일 이동평균 × 1.20                       (H29a 그대로)
  B' 시장 폭 대용 : S&P500이 120일 고점의 97% 이상인데 러셀2000 종가 < 자기 50일선
  D 변동성 상승  : VIX 5일 평균 ≥ 60일 평균 × 1.25                           (H29a 그대로)
  C 외국인 매도는 미국 대응 지표가 없어 뺀다.
  주 판정 '조합 충족' = 3개 중 2개 이상. 3/3은 참고 출력만.
기간 1990-01~2026-09, 안 구간 ~2007, 밖 구간 2008~. 이후 20거래일 최대 낙폭(종가 기준).

데이터: Yahoo 일봉(^GSPC, ^RUT, ^VIX) → .research-cache/allweather/us_*.json (없을 때만 받음, --refresh로 다시 받음)
실행: python scripts/research/validate_us_market_background.py [--refresh]
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from fetch_allweather_data import fetch_us

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/allweather/"
START, END, SPLIT = "19900101", "20260930", "20080101"
HOLD = 20
SYMS = {"spx": "^GSPC", "rut": "^RUT", "vix": "^VIX"}


def load(sym, refresh):
    path = C + "us_" + sym.replace("^", "_").replace("=", "_") + ".json"
    if refresh or not os.path.exists(path):
        rows = fetch_us(sym)
        json.dump(rows, open(path, "w", encoding="utf-8"))
    # 지수라 수정가 = 종가. [날짜, 수정가, 종가]
    return {d: c for d, _a, c in json.load(open(path, encoding="utf-8"))}


def rolling(x, w, fn):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        out[i] = fn(x[i - w + 1:i + 1])
    return out


def main():
    refresh = "--refresh" in sys.argv
    raw = {k: load(s, refresh) for k, s in SYMS.items()}
    dates = sorted(d for d in raw["spx"] if d <= END)
    S = np.array([raw["spx"][d] for d in dates], float)
    R = np.array([raw["rut"].get(d, np.nan) for d in dates], float)
    V = np.array([raw["vix"].get(d, np.nan) for d in dates], float)
    T = len(dates)
    print(f"자료: S&P {dates[0]}~{dates[-1]} ({T}일), 러셀 시작 {min(raw['rut'])}, VIX 시작 {min(raw['vix'])}")

    A = S >= 1.20 * rolling(S, 200, np.mean)
    B = (S >= 0.97 * rolling(S, 120, np.max)) & (R < rolling(R, 50, np.mean))
    D = rolling(V, 5, np.mean) >= 1.25 * rolling(V, 60, np.mean)
    cnt = A.astype(int) + B.astype(int) + D.astype(int)

    ok = np.array([START <= d for d in dates])
    idx = [i for i in range(T - HOLD) if ok[i]]
    mdd = {i: S[i:i + HOLD + 1].min() / S[i] - 1 for i in idx}
    print("신호 일수(1990~):", {n: int((s & ok).sum()) for n, s in zip(("A", "B'", "D"), (A, B, D))}, f"(표본일 {len(idx)})")

    for label, flag, judge in (("주 판정 2/3", cnt >= 2, True), ("참고 3/3", cnt >= 3, False)):
        events, last = [], -999
        for i in idx:
            if flag[i]:
                if i - last > HOLD:
                    events.append(i)
                last = i
        print(f"\n[{label}] 충족 {int(sum(flag[i] for i in idx))}일 · 독립 사건 {len(events)}건")
        for e in events:
            print(f"    {dates[e]}  이후 20일 최대 낙폭 {mdd[e]*100:+.1f}%  (A{int(A[e])} B{int(B[e])} D{int(D[e])})")
        res = {}
        for name, sel in (("안(~2007)", lambda d: d < SPLIT), ("밖(2008~)", lambda d: d >= SPLIT)):
            f = np.array([mdd[i] for i in idx if flag[i] and sel(dates[i])])
            r = np.array([mdd[i] for i in idx if not flag[i] and sel(dates[i])])
            ne = sum(1 for e in events if sel(dates[e]))
            if len(f) == 0:
                print(f"  {name}: 충족일 없음"); res[name] = None; continue
            h7f, h7r = (f <= -0.07).mean(), (r <= -0.07).mean()
            res[name] = (np.median(f), np.median(r), h7f, h7r)
            print(f"  {name}: 충족 {len(f)}일(사건 {ne}) 낙폭 중앙값 {np.median(f)*100:+.1f}% vs 나머지 {np.median(r)*100:+.1f}%"
                  f" | −7% 도달 {h7f*100:.0f}% vs {h7r*100:.0f}% (배수 {h7f/max(h7r,1e-9):.2f})")
            # 사건 단위(독립 사건 첫날만)로도 본다 — 겹친 날이 수치를 부풀리는지 확인용, 판정에는 안 씀
            ev = np.array([mdd[e] for e in events if sel(dates[e])])
            if len(ev):
                print(f"      사건 첫날만: 중앙 {np.median(ev)*100:+.1f}%, −7% 도달 {(ev <= -0.07).mean()*100:.0f}% ({len(ev)}건)")
        if not judge:
            continue
        if len(events) < 6:
            print("  → H42 판정: 표본 부족 — 보류 (독립 사건 6건 미만)")
        else:
            passed = all(v and v[0] < v[1] and v[2] >= 1.5 * v[3] for v in res.values())
            print(f"  → H42 판정: {'통과' if passed else '기각'}")


if __name__ == "__main__":
    main()
