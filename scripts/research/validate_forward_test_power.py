# -*- coding: utf-8 -*-
"""
H11 전향 검증 검정력 점검 (2026-10-06) — 11/23(40거래일) 판정이 우연과 실력을 구분할 수 있는가.

질문 1 (최소 검출 효과, MDE): 두 전략의 주간 수익 차이의 표준편차(추적오차)로, 40·120·250거래일 측정에서
  유의수준 5%(양측)·검정력 80%로 구분할 수 있는 '측정 기간 누적 수익 차이'와 '연 환산 차이'를 계산한다.
  MDE(누적) = 2.80 × σ_주 × √n주,  MDE(연) = 2.80 × σ_주 / √n주 × 52.
질문 2 (허위 승격 확률): reviewStrategies()는 유의성 검정 없이 '봇·KODEX200·CD를 모두 앞서고 낙폭이 봇 이하'인
  종목 전략을 승격 후보로 낸다. 모든 전략의 기대수익이 같을 때(평균을 CD금리 수준으로 맞춤) 이 규칙이 후보를 낼 확률을,
  과거 연속 구간을 그대로 잘라 쓰는 방식(상관·변동성 보존)으로 잰다.

대용 포트폴리오 (실제 전략은 과거에 다시 만들 수 없어서 구조만 흉내 냄):
  - 종목 5개 전략(봇·점수상위5·모멘텀·돌파·주문표 등): 매주 거래대금 상위 200 종목 중 무작위 5개 동일비중
  - gate-top20: 무작위 20개, gate-monthly: 무작위 50개 (월 교체 대신 주 교체 — 추적오차에 큰 차이 없음)
  - index-core: KODEX200 (50일선 아래 CD 전환은 생략 — 추적오차를 줄이는 쪽이라 보수적)
  - 코어 프로필 6종: 한국 ETF + 미국 ETF 원화 환산 + CD91, 매주 비중 복원 근사
데이터: .research-cache/px.pkl(전 종목 일봉, 2014~), allweather/(ETF·환율·CD91). 주간 = 각 주 마지막 거래일 종가.
한계: 무작위 종목 포트폴리오는 실제 전략끼리의 상관(같은 점수 공유)을 반영하지 못해 허위 승격 확률을 다소 높게 볼 수 있다.
  그래서 '전략끼리 상관이 높은 경우'(같은 15종목 풀에서 5개씩 고르기)도 함께 본다.
"""
import json
import pickle
import sys
from datetime import date

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = ".research-cache/"
AW = ROOT + "allweather/"
rng = np.random.default_rng(20261006)


def week_key(d: str) -> str:
    y, w, _ = date(int(d[:4]), int(d[4:6]), int(d[6:])).isocalendar()
    return f"{y}-{w:02d}"


def weekly_last(rows, idx=-1):
    """[(date, ..., close)] -> {week: close} (주 마지막 값)"""
    out = {}
    for r in sorted(rows, key=lambda r: r[0]):
        v = r[idx]
        if v:
            out[week_key(r[0])] = float(v)
    return out


def load(name, idx=-1):
    return weekly_last(json.load(open(AW + name, encoding="utf-8")), idx)


# --- ETF·환율·CD ---
k200 = load("kr_069500.json")
ktb10 = load("kr_148070.json")
fx = load("us_KRW_X.json")
us = {s: load(f"us_{s}.json", 1) for s in ["SPY", "QQQ", "TLT", "IEF", "GLD"]}  # 수정주가(총수익)
cd_rows = sorted(json.load(open(AW + "cd91.json", encoding="utf-8")))
cd_w = {}
for d, v in cd_rows:
    cd_w[week_key(d)] = float(v)

# --- 종목 ---
px = pickle.load(open(ROOT + "px.pkl", "rb"))
stock_close, stock_tv = {}, {}
for code, rows in px.items():
    if len(rows) < 60:
        continue
    c, tv = {}, {}
    for d, o, h, l, cl, vol in rows:
        if cl and cl > 0:
            k = week_key(d)
            c[k] = float(cl)
            tv[k] = tv.get(k, 0.0) + cl * vol
    stock_close[code], stock_tv[code] = c, tv

weeks = sorted(k for k in k200 if k >= "2014-06" and all(k in us[s] for s in us) and k in fx and k in ktb10)
# 연속 주만(직전 주 값이 있는 주)
W = len(weeks)
print(f"공통 주간 구간 {weeks[0]} ~ {weeks[-1]} ({W}주)")


def ret(series, i):
    a, b = series.get(weeks[i - 1]), series.get(weeks[i])
    return b / a - 1 if a and b else np.nan


def usd_krw(sym, i):
    return (1 + ret(us[sym], i)) * (1 + ret(fx, i)) - 1


cd_r = np.array([0.0] + [(cd_w.get(weeks[i - 1], 3.0) / 100) / 52 for i in range(1, W)])
r_k200 = np.array([0.0] + [ret(k200, i) for i in range(1, W)])
r_ktb = np.array([0.0] + [ret(ktb10, i) for i in range(1, W)])
r_us = {s: np.array([0.0] + [usd_krw(s, i) for i in range(1, W)]) for s in us}

profiles = {
    "성장형 K50/S50": [(r_k200, .5), (r_us["SPY"], .5)],
    "균형형 4자산": [(r_k200, .3), (r_us["QQQ"], .3), (r_ktb, .25), (r_us["GLD"], .15)],
    "올웨더형": [(r_us["SPY"], .3), (r_us["TLT"], .4), (r_us["IEF"], .15), (r_us["GLD"], .15)],
    "영구형": [(r_us["SPY"], .25), (r_us["TLT"], .25), (r_us["GLD"], .25), (cd_r, .25)],
    "60/40": [(r_us["SPY"], .6), (r_us["IEF"], .4)],
    "국내형": [(r_k200, .4), (r_ktb, .4), (r_us["GLD"], .2)],
}
r_prof = {n: sum(r * w for r, w in parts) for n, parts in profiles.items()}

# 주간 유동성 상위 200 (직전 주 거래대금 기준), 이번 주 수익이 있는 종목만
def stock_ret(code, i):
    c = stock_close[code]
    a, b = c.get(weeks[i - 1]), c.get(weeks[i])
    if not a or not b:
        return None
    r = b / a - 1
    return r if -0.6 < r < 1.5 else None  # 액면분할 등 미수정 이상값 제외


universe = [None]
for i in range(1, W):
    prev = weeks[i - 1]
    cand = [(stock_tv[c].get(prev, 0.0), c) for c in stock_close if prev in stock_close[c]]
    cand.sort(reverse=True)
    top = [c for _, c in cand[:260]]
    universe.append([c for c in top if stock_ret(c, i) is not None][:200])


def random_port(k, pool_size=None):
    out = np.zeros(W)
    for i in range(1, W):
        u = universe[i]
        pool = u if pool_size is None else u[: pool_size]
        pick = rng.choice(len(pool), size=min(k, len(pool)), replace=False)
        out[i] = np.mean([stock_ret(pool[j], i) for j in pick])
    return out


Z = 1.96 + 0.84
HORIZONS = [(40, 8), (120, 24), (250, 50)]


def mde_line(label, a, b):
    d = (a - b)[1:]
    s = d.std(ddof=1)
    te = s * np.sqrt(52) * 100
    cells = []
    for days, n in HORIZONS:
        cum = Z * s * np.sqrt(n) * 100
        ann = Z * s / np.sqrt(n) * 52 * 100
        cells.append(f"{cum:6.1f}%p / 연 {ann:5.0f}%p")
    print(f"{label:28s} 추적오차 연 {te:5.1f}%  | " + " | ".join(cells))


print("\n=== 질문 1: 최소 검출 효과 (누적 차이 / 연 환산) — 검정력 80%, 양측 5% ===")
print(f"{'비교':28s} {'':16s}  | {'40거래일(8주)':^24s} | {'120거래일(24주)':^24s} | {'250거래일(50주)':^24s}")
p5a, p5b = random_port(5), random_port(5)
p20, p50 = random_port(20), random_port(50)
mde_line("종목5개 vs KODEX200", p5a, r_k200)
mde_line("종목5개 vs 종목5개(다른)", p5a, p5b)
mde_line("종목20개 vs KODEX200", p20, r_k200)
mde_line("종목50개 vs KODEX200", p50, r_k200)
names = list(r_prof)
pairs = [("성장형 K50/S50", "60/40"), ("균형형 4자산", "올웨더형"), ("올웨더형", "영구형"), ("국내형", "60/40"), ("성장형 K50/S50", "영구형")]
for a, b in pairs:
    mde_line(f"{a} vs {b}", r_prof[a], r_prof[b])
mde_line("성장형 vs KODEX200", r_prof["성장형 K50/S50"], r_k200)


# --- 질문 2: 허위 승격 확률 ---
def cum(r):
    return np.prod(1 + r) - 1


def mdd(r):
    eq = np.cumprod(1 + r)
    eq = np.concatenate([[1.0], eq])
    return (eq / np.maximum.accumulate(eq) - 1).min()


def null_demean(r):
    """기대수익을 CD 수준으로 맞춘다 — 모든 전략이 같은 실력이라는 귀무가설"""
    x = r[1:]
    return np.concatenate([[0.0], x - x.mean() + cd_r[1:].mean()])


# 무작위 포트폴리오를 미리 만들어 두고 매 시행마다 뽑아 쓴다(계산량 절감)
BANK = {
    False: ([null_demean(random_port(5)) for _ in range(40)], [null_demean(random_port(20)) for _ in range(10)],
            [null_demean(random_port(50)) for _ in range(10)]),
    # 같은 15종목 풀에서 고르는 경우 — 실제 전략들이 같은 점수를 공유하는 상황 근사
    True: ([null_demean(random_port(5, 15)) for _ in range(40)], [null_demean(random_port(20, 40)) for _ in range(10)],
           [null_demean(random_port(50, 80)) for _ in range(10)]),
}
K_NULL = null_demean(r_k200)
# 판정 규칙의 잡음 범위에 쓰는 추적오차 — 종목 5개 대 KODEX200 전·후반 중 낮은 값(보수적으로 좁게)
TE_ANNUAL = 0.30


def band_pct(n_weeks, te_annual=TE_ANNUAL):
    """잡음 범위(누적 수익 차이) — 2σ√n. strategyForwardTest.ts의 noiseBandPct()와 같은 식"""
    return 2 * te_annual / np.sqrt(52) * np.sqrt(n_weeks)


def false_promotion(n_weeks, correlated, reps=400, band=False, edge_annual=0.0):
    """edge_annual>0이면 종목 전략 하나(첫 번째)에 진짜 우위를 더해 '검출률'을 잰다"""
    hits = warn = 0
    bd = band_pct(n_weeks) if band else 0.0
    trials = 0
    b5, b20, b50 = BANK[correlated]
    for _ in range(reps):
        idx = rng.choice(len(b5), size=7, replace=False)
        strats = [b5[j] for j in idx[:6]] + [b20[rng.integers(len(b20))], b50[rng.integers(len(b50))], K_NULL]  # 마지막: index-core 근사
        bot, k = b5[idx[6]], K_NULL
        if edge_annual:
            strats[0] = strats[0] + edge_annual / 52
        for _ in range(5):
            s0 = int(rng.integers(1, W - n_weeks))
            sl = slice(s0, s0 + n_weeks)
            b_c, k_c, c_c = cum(bot[sl]), cum(k[sl]), cum(cd_r[sl])
            b_m = mdd(bot[sl])
            trials += 1
            pool = strats[:1] if edge_annual else strats
            if any(cum(s[sl]) > max(b_c, k_c, c_c) + bd and mdd(s[sl]) >= b_m for s in pool):
                hits += 1
            if b_c < k_c - bd and b_c < c_c - bd:
                warn += 1
    return hits / trials, warn / trials


print("\n=== 질문 2: 실력이 모두 같을 때 현 규칙이 '승격 후보'·'봇 경고'를 낼 확률 ===")
print("(종목 전략 9종 + 봇, 모두 기대수익 = CD금리로 맞춤. 무작위 시작 구간 2,000회)")
for days, n in HORIZONS:
    p_ind, w_ind = false_promotion(n, False)
    p_cor, w_cor = false_promotion(n, True)
    print(f"{days:3d}거래일: 승격 후보 발생 {p_ind*100:5.1f}% (상관 높음 {p_cor*100:5.1f}%)  | 봇 경고 {w_ind*100:5.1f}% (상관 높음 {w_cor*100:5.1f}%)")


print("\n=== 질문 3: 잡음 범위(2σ√n, 추적오차 연 30%)를 넣은 규칙 ===")
for days, n in HORIZONS:
    p_ind, w_ind = false_promotion(n, False, band=True)
    p_cor, w_cor = false_promotion(n, True, band=True)
    print(f"{days:3d}거래일 (잡음 범위 {band_pct(n)*100:4.1f}%p): 허위 승격 {p_ind*100:5.1f}% (상관 높음 {p_cor*100:5.1f}%) | 허위 봇 경고 {w_ind*100:5.1f}% (상관 높음 {w_cor*100:5.1f}%)")
print("\n진짜 우위가 있는 전략 하나를 잡아내는 비율(검출률) — 잡음 범위 규칙 / 현 규칙")
for edge in [0.10, 0.20, 0.40]:
    cells = []
    for days, n in HORIZONS:
        a, _ = false_promotion(n, False, band=True, edge_annual=edge)
        b, _ = false_promotion(n, False, band=False, edge_annual=edge)
        cells.append(f"{days}일 {a*100:4.1f}% / {b*100:4.1f}%")
    print(f"연 +{edge*100:.0f}%p 우위: " + " | ".join(cells))


print("\n=== 강건성: 전·후반 구간별 추적오차(연) ===")
half = W // 2
for lab, sl in [(f"전반 {weeks[1]}~{weeks[half]}", slice(1, half)), (f"후반 {weeks[half]}~{weeks[-1]}", slice(half, W))]:
    te = lambda a, b: (a - b)[sl].std(ddof=1) * np.sqrt(52) * 100
    print(f"{lab}: 종목5개 vs KODEX200 {te(p5a, r_k200):.1f}% · 종목20개 {te(p20, r_k200):.1f}% · 성장형 vs 60/40 {te(r_prof['성장형 K50/S50'], r_prof['60/40']):.1f}%")
