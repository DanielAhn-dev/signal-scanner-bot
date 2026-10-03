# -*- coding: utf-8 -*-
"""
'선 인컴 후 성장' 하이브리드 점검 (2026-10-03) — 커버드콜 계좌에서 월 생활비를 빼고 남는 분배금을 지수에 넣는 구조가 지수 단독과 비교해 어떤가.
데이터: 네이버 수정주가(분배금 소급 반영 = 총수익 경로) + 운용사 실제 분배금 이력(TIGER200커버드콜 289480, RISE200고배당커버드콜ATM 290080), 지수 KODEX200(069500).
분배금이 있는 구간(약 2022-06~2026-09)만 쓴다. 수정주가에서 실제 가격과 분배 수익률을 역산한다(분배락 시점 실제 가격이 아니라 근사).
전략(시작 자산 1.0, 매달 σ/12를 고정 명목으로 생활비로 씀, 세금·수수료 없음):
  IDX  : 지수 100%, 생활비는 지수를 팔아서
  CC   : 커버드콜 100%, 생활비는 분배금으로, 남는 분배금은 현금으로 둠(재투자 안 함), 모자라면 커버드콜을 팖
  HYB  : 커버드콜 100%, 생활비는 분배금으로, 남는 분배금은 지수에 넣음(모자라면 커버드콜을 팖)
  HYB+ : HYB에 더해, 커버드콜 평가금이 처음의 150%를 넘으면 넘은 부분을 팔아 지수로 옮김(사용자 계획)
지표: 끝 자산(남은 평가액, 생활비는 같은 금액을 이미 썼으므로 비교 가능) — 시작월별 분포. 표본이 4년뿐이고 대부분 한국 강세장이라 일반화하면 안 된다.
"""
import json
import sys
import numpy as np

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

CC = {"TIGER200CC(289480)": "289480", "RISE200ATM(290080)": "290080"}


def monthly(path):
    rows = json.load(open(path, encoding="utf-8")); rows.sort(key=lambda r: r[0])
    d = {}
    for dt, c in rows:
        d[dt[:6]] = float(c)
    return d


def reconstruct(adj, divs):
    """월말 수정주가 → 월별 (실제가격 수익률 pr, 분배 수익률 y)"""
    months = sorted(adj)
    dm = {}
    for x in divs:
        k = x["recordDate"][:4] + x["recordDate"][5:7]
        dm[k] = dm.get(k, 0) + x["amount"]
    G = 1.0
    real = {months[-1]: adj[months[-1]]}
    y = {}
    for i in range(len(months) - 1, 0, -1):
        m, pm = months[i], months[i - 1]
        d = dm.get(m, 0.0)
        if d:
            q = d * G / adj[pm]
            y[m] = q / (1 + q)
            G *= (1 - y[m])
        else:
            y[m] = 0.0
        real[pm] = adj[pm] / G
    return months, real, y


def sim(strategy, cc_tr, cc_y, idx_tr, sigma, start, H):
    V, I, cash = 1.0, 0.0, 0.0
    if strategy == "IDX":
        V, I = 0.0, 1.0
    spend = sigma / 12
    for t in range(start, start + H):
        pay = V * cc_y[t]
        V *= 1 + cc_tr[t] - cc_y[t]
        I *= 1 + idx_tr[t]
        cash += pay
        need = spend
        if strategy == "IDX":
            I -= need
            if I < 0:
                return 0.0
            continue
        use = min(cash, need); cash -= use; need -= use
        if need > 0:
            V -= need
            if V < 0:
                return 0.0
        if strategy in ("HYB", "HYB+"):
            I += cash; cash = 0.0
        if strategy == "HYB+" and V > 1.5:
            I += V - 1.5; V = 1.5  # 평가금이 처음의 150%를 넘는 부분은 팔아서 지수로
    return V + I + cash


def main():
    idx = monthly(".research-cache/index_etfs/px_069500.json")
    for name, code in CC.items():
        adj = monthly(f".research-cache/dividend_etfs/px_{code}.json")
        divs = json.load(open(f".research-cache/div_{code}.json", encoding="utf-8"))
        first_div = min(x["recordDate"][:4] + x["recordDate"][5:7] for x in divs)
        months = [m for m in sorted(adj) if m >= first_div and m in idx]
        sub = {m: adj[m] for m in months}
        ms, real, y = reconstruct(sub, [x for x in divs])
        cc_tr = np.array([sub[ms[i]] / sub[ms[i - 1]] - 1 for i in range(1, len(ms))])
        cc_y = np.array([y[ms[i]] for i in range(1, len(ms))])
        idx_tr = np.array([idx[ms[i]] / idx[ms[i - 1]] - 1 for i in range(1, len(ms))])
        n = len(cc_tr)
        yr = cc_y.sum() / n * 12 * 100
        cc_tot = (np.prod(1 + cc_tr) - 1) * 100
        ix_tot = (np.prod(1 + idx_tr) - 1) * 100
        print(f"\n##### {name}: {ms[0]}~{ms[-1]} ({n}개월) — 평균 분배율 연 {yr:.1f}%, 기간 총수익 커버드콜 {cc_tot:+.0f}% vs 지수 {ix_tot:+.0f}%")
        for sigma in (0.04, 0.06, 0.08):
            print(f"-- 생활비 연 {sigma*100:.0f}%(시작 자산 대비) --")
            for H in (24, 36, n):
                if H > n:
                    continue
                starts = range(0, n - H + 1)
                res = {s: np.array([sim(s, cc_tr, cc_y, idx_tr, sigma, st, H) for st in starts]) for s in ("IDX", "CC", "HYB", "HYB+")}
                win = (res["HYB"] > res["IDX"]).mean() * 100
                print(f"  보유 {H:>2d}개월(시작 {len(list(starts))}개): 끝 자산 중앙값 IDX {np.median(res['IDX']):.2f} / CC {np.median(res['CC']):.2f} / HYB {np.median(res['HYB']):.2f} / HYB+ {np.median(res['HYB+']):.2f}"
                      f"  | 최저 IDX {res['IDX'].min():.2f} CC {res['CC'].min():.2f} HYB {res['HYB'].min():.2f} HYB+ {res['HYB+'].min():.2f} | HYB가 IDX 이긴 비율 {win:.0f}%")


if __name__ == "__main__":
    main()
