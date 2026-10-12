# -*- coding: utf-8 -*-
"""
H39: 국내 고배당 ETF 3종이 코스피200 큰 하락 구간에서 지수보다 일관되게 덜 빠지는가 (2026-10-12).
판정 기준은 docs/hypothesis-ledger.md H39에 결과 보기 전 고정.

하락 구간 = KODEX200(069500) 수정종가가 직전 고점 대비 -15% 이하로 내려간 사건.
고점일 → (고점 회복 전) 최저점일. 각 상품은 같은 날짜의 종가 변화율로 비교하며 그 구간을 전부 커버할 때만 집계.
방어비 = 상품 낙폭 / 지수 낙폭. 네이버 수정주가라 지수·상품 모두 총수익 근사.

실행: python scripts/research/validate_highdiv_drawdown.py
"""
import json, os, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", ".research-cache")
TH = -0.15
PRODUCTS = {"161510": "PLUS고배당주", "104530": "KIWOOM고배당", "210780": "TIGER코스피고배당"}


def load(code):
    for sub in ("", "dividend_etfs"):
        p = os.path.join(ROOT, sub, f"px_{code}.json")
        if os.path.exists(p):
            rows = json.load(open(p, encoding="utf-8"))
            rows.sort(key=lambda r: r[0])
            return {d: float(c) for d, c in rows}
    raise FileNotFoundError(code)


idx = load("069500")
dates = sorted(idx)
prod = {c: load(c) for c in PRODUCTS}

# ---- 하락 구간 찾기
episodes = []
peak_i = 0
i = 1
while i < len(dates):
    c = idx[dates[i]]
    if c >= idx[dates[peak_i]]:
        peak_i = i
        i += 1
        continue
    dd = c / idx[dates[peak_i]] - 1
    if dd <= TH:
        # 고점 회복 전까지 최저점 추적
        trough_i = i
        j = i
        while j < len(dates) and idx[dates[j]] < idx[dates[peak_i]]:
            if idx[dates[j]] < idx[dates[trough_i]]:
                trough_i = j
            j += 1
        rec_i = j if j < len(dates) else None
        episodes.append((peak_i, trough_i, rec_i))
        if rec_i is None:
            break
        peak_i = rec_i
        i = rec_i + 1
        continue
    i += 1

print(f"코스피200(069500) {dates[0]}~{dates[-1]}, −15% 이하 하락 구간 {len(episodes)}개\n")
res = {c: [] for c in PRODUCTS}
for pi, ti, ri in episodes:
    pd_, td = dates[pi], dates[ti]
    ir = idx[td] / idx[pd_] - 1
    rec = f"{ri - ti}거래일" if ri is not None else "미회복"
    rb = ""
    if ri is not None:
        pass
    after = ""
    if ti + 20 < len(dates):
        after = f"{(idx[dates[ti+20]] / idx[td] - 1) * 100:+.1f}%"
    print(f"[{pd_}→{td}] 지수 {ir*100:+.1f}%  (고점→저점 {ti-pi}거래일, 저점→회복 {rec}, 저점+20일 반등 {after})")
    for c, nm in PRODUCTS.items():
        px = prod[c]
        if pd_ in px and td in px:
            pr = px[td] / px[pd_] - 1
            ratio = pr / ir
            res[c].append(ratio)
            print(f"   {nm:<14} {pr*100:+6.1f}%  방어비 {ratio:.2f}")
        else:
            print(f"   {nm:<14} 데이터 없음(상장 전)")
    print()

print("=== 판정 (사전 기준) ===")
verdicts = []
for c, nm in PRODUCTS.items():
    r = res[c]
    n = len(r)
    if n < 3:
        print(f"{nm}: 커버 구간 {n}개 → 판정 불가(기술만)")
        verdicts.append("na")
        continue
    ok = sum(1 for x in r if x <= 0.80)
    worse = [x for x in r if x > 1.00]
    adopt = ok / n >= 2 / 3 and not worse
    reject = bool(worse) or ok / n < 0.5
    v = "채택" if adopt else ("기각" if reject else "혼재")
    verdicts.append(v)
    print(f"{nm}: 구간 {n}, 방어비≤0.80 {ok}/{n}, 방어비>1.00 {len(worse)}개 → {v}")
if all(v == "채택" for v in verdicts):
    print("종합: 채택 (3종 모두 충족)")
elif any(v == "기각" for v in verdicts):
    print("종합: 기각")
else:
    print("종합: 혼재 또는 판정 불가 — 기술만")

# ---- 보조(사후 기술, 판정 아님): 2018-01~2020-03 구간 안의 코로나 급락만 따로, 그리고 연도별 수익
print("\n=== 보조(사후 기술, 판정 아님) ===")
pk = max((d for d in dates if "20200101" <= d <= "20200220"), key=lambda d: idx[d])
ir = idx["20200319"] / idx[pk] - 1
print(f"코로나 급락 {pk}→20200319: 지수 {ir*100:+.1f}%")
for c, nm in PRODUCTS.items():
    if pk in prod[c] and "20200319" in prod[c]:
        r = prod[c]["20200319"] / prod[c][pk] - 1
        print(f"   {nm:<14} {r*100:+6.1f}%  방어비 {r/ir:.2f}")
for y in ("2018", "2019", "2020"):
    s = [d for d in dates if d.startswith(y)]
    a, b = s[0], s[-1]
    line = f"{y} 연간: 지수 {(idx[b]/idx[a]-1)*100:+.0f}%"
    for c, nm in PRODUCTS.items():
        if a in prod[c] and b in prod[c]:
            line += f", {nm} {(prod[c][b]/prod[c][a]-1)*100:+.0f}%"
    print(line)
