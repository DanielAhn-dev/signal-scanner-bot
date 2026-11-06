# -*- coding: utf-8 -*-
"""
미국 중간선거 전후 구간 기술 분석 (2026-11-06, 설명용 — 매매 규칙 후보 아님).
질문: 선거 전후 하락이 과거 분포에서 이례적인가? 선거 전에 알 수 있는 신호가 있었나?
입력: .research-cache/gspc_1950.json, ks11_all.json, vix_all.json  ([epoch, close] 목록; Yahoo chart API)
실행: python -I scripts/research/validate_midterm_window.py
"""
import datetime as D
import json
import statistics as S

C = ".research-cache/"
def ld(n):
    raw = json.load(open(C + n))
    return [(D.datetime(1970, 1, 1) + D.timedelta(seconds=t)).date() for t, _ in raw], [c for _, c in raw]


def election_day(y):
    d = D.date(y, 11, 1)
    while d.weekday() != 0:
        d += D.timedelta(1)
    return d + D.timedelta(1)


def idx_on(dates, d):  # d 이후 첫 거래일
    for i, x in enumerate(dates):
        if x >= d:
            return i
    return None


def mdd(px):
    pk, m = px[0], 0
    for p in px:
        pk = max(pk, p)
        m = min(m, p / pk - 1)
    return m


def pct(a, v):
    return sum(1 for x in a if x <= v) / len(a) * 100


def analyze(name, dates, px, years, win=(60, 120, 250)):
    print(f"\n=== {name} ===")
    rows = []
    for y in years:
        i = idx_on(dates, election_day(y))
        if i is None or i < 260 or i + max(win) >= len(px):
            continue
        r = {"y": y, "pre60": px[i] / px[i - 60] - 1,
             "dd_to_elec": px[i] / max(px[i - 250:i + 1]) - 1,
             "ma200": px[i] / (sum(px[i - 199:i + 1]) / 200) - 1}
        for w in win:
            r[f"post{w}"] = px[i + w] / px[i] - 1
        r["post60_mdd"] = mdd(px[i:i + 61])
        rows.append(r)
    for r in rows:
        print(f"{r['y']}  선거전60일 {r['pre60']*100:6.1f}%  1년고점대비 {r['dd_to_elec']*100:6.1f}%  200일선대비 {r['ma200']*100:6.1f}%  "
              f"후60일 {r['post60']*100:6.1f}%  후120일 {r['post120']*100:6.1f}%  후250일 {r['post250']*100:6.1f}%  후60일최대낙폭 {r['post60_mdd']*100:6.1f}%")
    # 무조건 분포 (같은 길이 구간)
    for w in win:
        base = [px[i + w] / px[i] - 1 for i in range(260, len(px) - w, 5)]
        ev = [r[f"post{w}"] for r in rows]
        print(f"후{w}일: 선거 평균 {S.mean(ev)*100:.1f}% 중앙 {S.median(ev)*100:.1f}% 양수 {sum(e>0 for e in ev)}/{len(ev)}"
              f" | 전체 구간 평균 {S.mean(base)*100:.1f}% 중앙 {S.median(base)*100:.1f}%")
    base_dd = [mdd(px[i:i + 61]) for i in range(260, len(px) - 61, 5)]
    ev_dd = [r["post60_mdd"] for r in rows]
    print(f"후60일 최대낙폭: 선거 평균 {S.mean(ev_dd)*100:.1f}% | 전체 평균 {S.mean(base_dd)*100:.1f}%")
    return rows


# ---- S&P500 1950~ (중간선거 해 = 4로 나눠 2가 남는 해) ----
gd, gp = ld("gspc_1950.json")
analyze("S&P500 중간선거 1950~2022", gd, gp, range(1950, 2026, 4) if False else [y for y in range(1950, 2023) if y % 4 == 2])

# ---- 코스피 1996~ ----
kd, kp = ld("ks11_all.json")
analyze("코스피, 미국 중간선거 후 (1998~2022)", kd, kp, [1998, 2002, 2006, 2010, 2014, 2018, 2022])

# ---- 이번 사건 위치 ----
print("\n=== 2026 현재 위치 ===")
for name, d, p in (("코스피", kd, kp), ("S&P500", gd, gp)):
    last = len(p) - 1
    pk = max(range(last - 250, last + 1), key=lambda i: p[i])
    e = idx_on(d, election_day(2026))
    print(f"{name}: 최근 1년 고점 {d[pk]} {p[pk]:,.0f} → 현재 {d[last]} {p[last]:,.0f} ({(p[last]/p[pk]-1)*100:.1f}%)")
    print(f"  고점→선거일({d[e]}) {(p[e]/p[pk]-1)*100:.1f}% , 선거일→현재 {(p[last]/p[e]-1)*100:.1f}%  (선거 전 낙폭이 이미 대부분)")
    ma = sum(p[pk - 199:pk + 1]) / 200
    print(f"  고점 시점 200일선 대비 {(p[pk]/ma-1)*100:.1f}%")

# ---- 코스피 큰 하락 역사: 고점 대비 -30% 이상 사건과 그 직전 200일선 괴리 ----
print("\n=== 코스피 고점 대비 -30% 이상 하락 사건 (독립: 직전 사건 고점 갱신 뒤) ===")
pk_i, ev = 0, []
i = 1
while i < len(kp):
    if kp[i] > kp[pk_i]:
        pk_i = i
    elif kp[i] / kp[pk_i] - 1 <= -0.30 and (not ev or ev[-1][0] != pk_i):
        trough = min(range(pk_i, min(len(kp), pk_i + 400)), key=lambda j: kp[j])
        ma = sum(kp[pk_i - 199:pk_i + 1]) / 200 if pk_i >= 200 else float("nan")
        ev.append((pk_i, trough, ma))
    i += 1
for pk_i, tr, ma in ev:
    print(f"고점 {kd[pk_i]} {kp[pk_i]:,.0f} → 저점 {kd[tr]} {kp[tr]:,.0f} ({(kp[tr]/kp[pk_i]-1)*100:.0f}%, {tr-pk_i}거래일) 고점 시 200일선 대비 {(kp[pk_i]/ma-1)*100:.0f}%")

# ---- 과열(200일선 괴리) 신호의 시점 정보: 신호가 처음 켜진 날부터 고점까지, 그리고 이후 ----
print("\n=== 코스피 200일선 괴리 ≥ 30% 첫 도달일(독립: 60거래일 간격) 이후 성과 ===")
last_i = -999
for i in range(200, len(kp)):
    ma = sum(kp[i - 199:i + 1]) / 200
    if kp[i] / ma - 1 >= 0.30 and i - last_i > 60:
        last_i = i
        f = lambda w: (kp[i + w] / kp[i] - 1) * 100 if i + w < len(kp) else float("nan")
        hi = max(kp[i:i + 121])
        print(f"{kd[i]} 코스피 {kp[i]:,.0f} 괴리 {(kp[i]/ma-1)*100:.0f}% → 60일 {f(60):.0f}% 120일 {f(120):.0f}% | 이후 120일 내 추가 상승 최대 {(hi/kp[i]-1)*100:.0f}%")
