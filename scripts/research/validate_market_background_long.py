# -*- coding: utf-8 -*-
"""
시장 배경 신호 기간 확장 검증 H44 (2026-10-13). 정의와 판정 기준은 docs/hypothesis-ledger.md의 H44에 결과 보기 전 고정.

H29a(validate_market_background.py)는 종목 패널(2014~)과 외국인 수급(2016~) 때문에 독립 사건 4건으로 보류됐다.
여기서는 시장 폭을 코스닥 지수로 대신해 전 기간 같은 정의를 쓴다.

신호(종가 t까지의 정보만 사용)
  A   과열        : 코스피 종가 ≥ 200일 이동평균 × 1.20
  B'' 시장 폭 대용 : 코스피가 120일 고점의 97% 이상인데 코스닥 종가 < 코스닥 50일선
  C   외국인 매도  : 외국인 20거래일 누적 순매수가 직전 250거래일 분포의 하위 10%
  D   변동성 상승  : VKOSPI 5일 평균 ≥ 60일 평균 × 1.25
  '조합 충족' = 4개 중 3개 이상. 안 구간 ~2015, 밖 구간 2016~, 끝 2026-09.

데이터: kospi.json, vkospi.json, kospi_investor_flow.json(fetch_kospi_investor_flow.py --from=20040101),
       코스닥 ^KQ11은 .research-cache/allweather/kr_index_KQ11.json (없을 때만 받음)
실행: python scripts/research/validate_market_background_long.py > .research-cache/market_background_long_out.txt
"""
import sys, os, json, pickle
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from fetch_allweather_data import fetch_us

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
END, SPLIT = "20260930", "20160101"
HOLD, LONG = 20, 60


def kv(path, pick=lambda v: v):
    raw = json.load(open(C + path, encoding="utf-8"))
    d = dict(raw) if isinstance(raw, list) else raw
    return {k: pick(v) for k, v in d.items() if v is not None}


Kd = kv("kospi.json")
dates = sorted(d for d in Kd if d <= END)
T = len(dates)
K = np.array([Kd[d] for d in dates], float)


def on_axis(d):
    return np.array([d.get(x, np.nan) for x in dates], float)


VK = on_axis(kv("vkospi.json"))
flow = kv("kospi_investor_flow.json", lambda v: v[1])
FOR = on_axis(flow)
kq_path = C + "allweather/kr_index_KQ11.json"
if not os.path.exists(kq_path):
    json.dump(fetch_us("^KQ11"), open(kq_path, "w", encoding="utf-8"))
KQ = on_axis({d: c for d, _a, c in json.load(open(kq_path, encoding="utf-8"))})


def rolling(x, w, fn):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).sum() >= int(w * 0.9):
            out[i] = fn(seg)
    return out


def build():
    ma200, hi120 = rolling(K, 200, np.nanmean), rolling(K, 120, np.nanmax)
    kq50 = rolling(KQ, 50, np.nanmean)
    v5, v60 = rolling(VK, 5, np.nanmean), rolling(VK, 60, np.nanmean)
    F20 = rolling(FOR, 20, np.nansum)
    A = K >= 1.20 * ma200
    near = K >= 0.97 * hi120
    B = near & (KQ < kq50)
    Cs = np.zeros(T, bool)
    c_ok = np.zeros(T, bool)
    for i in range(270, T):
        hist = F20[i - 250:i]
        hist = hist[np.isfinite(hist)]
        if len(hist) > 200 and np.isfinite(F20[i]):
            c_ok[i] = True
            Cs[i] = F20[i] <= np.percentile(hist, 10)
    D = v5 >= 1.25 * v60
    ok = c_ok & np.isfinite(ma200) & np.isfinite(hi120) & np.isfinite(kq50) & np.isfinite(KQ) & np.isfinite(v60) & np.isfinite(v5)
    return A, B, Cs, D, ok, near


def breadth_2014():
    """보조: 종목 패널(2014~)의 원래 B(50일선 위 비율 ≤ 45%). validate_trader_paths와 같은 종목 필터."""
    px = pickle.load(open(C + "px.pkl", "rb"))
    corps = json.load(open(C + "corps.json", encoding="utf-8"))
    names = {c[2]: c[1] for c in corps}
    codes = [c for c, v in px.items() if len(v) > 300 and c.endswith("0")
             and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
    di = {d: i for i, d in enumerate(dates)}
    Cl = np.full((T, len(codes)), np.nan)
    for j, c in enumerate(codes):
        for r in px[c]:
            i = di.get(r[0])
            if i is not None:
                Cl[i, j] = r[4]
    out = np.full(T, np.nan)
    for i in range(49, T):
        seg = Cl[i - 49:i + 1]
        valid = np.isfinite(seg).all(axis=0)
        if valid.sum() > 100:
            out[i] = (Cl[i, valid] > seg[:, valid].mean(axis=0)).mean()
    return out


def main():
    A, B, Cs, D, ok, near = build()
    cnt = A.astype(int) + B.astype(int) + Cs.astype(int) + D.astype(int)
    flag = (cnt >= 3) & ok
    first = int(np.argmax(ok))
    fv = [d for d in dates if d in flow]
    print(f"외국인 수급 첫 유효일 {fv[0]} · 네 신호 계산 시작 {dates[first]} · 끝 {dates[np.where(ok)[0][-1]]} · 유효일 {int(ok.sum())}")
    print("신호 일수:", {n: int((s & ok).sum()) for n, s in zip(["A", "B''", "C", "D"], (A, B, Cs, D))}, "조합(3/4):", int(flag.sum()))

    idx = [i for i in range(T - HOLD) if ok[i] and np.isfinite(K[i:i + HOLD + 1]).all()]
    mdd = {i: np.nanmin(K[i:i + HOLD + 1]) / K[i] - 1 for i in idx}
    mdd60 = {i: np.nanmin(K[i:i + LONG + 1]) / K[i] - 1 for i in idx if i + LONG < T}
    events, last = [], -999
    for i in idx:
        if flag[i]:
            if i - last > HOLD:
                events.append(i)
            last = i
    print(f"\n[H44] 독립 사건 {len(events)}건")
    for e in events:
        print(f"  {dates[e]} 코스피 {K[e]:,.0f} 켜진 신호 {''.join(n for n, s in zip(['A', 'B', 'C', 'D'], (A, B, Cs, D)) if s[e])}"
              f" · 20일 최대 낙폭 {mdd[e]*100:+.1f}%" + (f" · 60일 {mdd60[e]*100:+.1f}%" if e in mdd60 else ""))

    res = {}
    for name, sel in (("안(~2015)", lambda d: d < SPLIT), ("밖(2016~)", lambda d: d >= SPLIT)):
        f = np.array([mdd[i] for i in idx if flag[i] and sel(dates[i])])
        r = np.array([mdd[i] for i in idx if not flag[i] and sel(dates[i])])
        ne = sum(1 for e in events if sel(dates[e]))
        if len(f) == 0:
            print(f"  {name}: 충족일 없음 (사건 {ne})"); res[name] = None; continue
        h7f, h7r = (f <= -0.07).mean(), (r <= -0.07).mean()
        res[name] = (np.median(f), np.median(r), h7f, h7r)
        f60 = np.array([mdd60[i] for i in idx if i in mdd60 and flag[i] and sel(dates[i])])
        r60 = np.array([mdd60[i] for i in idx if i in mdd60 and not flag[i] and sel(dates[i])])
        print(f"  {name}: 충족 {len(f)}일(사건 {ne}) 낙폭 중앙값 {np.median(f)*100:+.1f}% vs 나머지 {np.median(r)*100:+.1f}%"
              f" | −7% 도달 {h7f*100:.0f}% vs {h7r*100:.0f}% (배수 {h7f/max(h7r,1e-9):.2f})"
              f" | 보조 60일 −10% 도달 {(f60 <= -0.10).mean()*100:.0f}% vs {(r60 <= -0.10).mean()*100:.0f}%")
    if len(events) < 6:
        print("  → H44 판정: 표본 부족 — 보류 (독립 사건 6건 미만)")
    else:
        passed = all(v and v[0] < v[1] and v[2] >= 1.5 * v[3] for v in res.values())
        print(f"  → H44 판정: {'통과' if passed else '기각'}")

    # 보조: 2014~ 원래 B vs B''
    br = breadth_2014()
    Borig = near & (br <= 0.45)
    m = ok & np.isfinite(br)
    both, ob, nb = int((Borig & B & m).sum()), int((Borig & m).sum()), int((B & m).sum())
    print(f"\n[보조] 2014~ 원래 B {ob}일 · B'' {nb}일 · 둘 다 {both}일 (원래 B 중 B''도 켜진 비율 {both/max(ob,1)*100:.0f}%)")


if __name__ == "__main__":
    main()
