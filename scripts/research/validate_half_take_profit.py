# -*- coding: utf-8 -*-
"""
H67 (2026-10-26): 신호와 무관한 대형·중형주 진입에서 첫 익절을 +8% 대신 +5%에서 절반 하면 20거래일 성과가 나은가.
판정 기준은 docs/hypothesis-ledger.md H67에 결과 보기 전 고정돼 있다. 여기서 기준을 바꾸지 않는다.
대안은 +5% 하나뿐이다(격자 탐색 금지 — 다른 값을 보려면 새 가설로 등록).

데이터: validate_trader_paths 패널(2014-01-02~, 상장폐지 포함 수정주가). 유니버스: 전날까지 20일 거래대금 상위 300.
진입: 매달 첫 거래일 종가, 그날 유니버스 전 종목. 보유 최대 20거래일, 종가 기준.
CUR : 손절 -7% 이탈 시 남은 수량 절반, -10% 이탈 시 전량 / 익절 +8% 첫 도달 시 남은 수량 절반 / 20일째 종가 전량.
ALT : 익절 첫 도달선만 +5%.
비용: 전량 청산 왕복 0.45%p, 매도 이벤트가 하나 더 생길 때마다 +0.10%p.
한계: CUR은 운영 코드를 단순화한 근사(적응형 임계값·ATR 손절·수익잠금 트레일링 제외).

'평균 차이'(기준 ⓑ)는 +5%에 안 닿아 차이가 0인 진입까지 포함한 전체 평균으로 판정한다(가장 엄격한 해석).
도달 건만의 평균은 참고로만 출력한다.

실행: python scripts/research/validate_half_take_profit.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_trader_paths as vt

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

dates, T, N = vt.dates, vt.T, vt.N
Cf, UNIV, TV20 = vt.Cf, vt.UNIV, vt.TV20
TOP = 300
H = 20
BASE_COST = 0.0045
EXTRA_SELL = 0.001


def simulate(path, tp):
    """path[0]=진입가, 이후 최대 H개 종가(NaN 가능). 반환: (수익률, 익절 발동 여부)"""
    e = path[0]
    rem = 1.0
    got = 0.0
    events = 0
    half_stop = False
    tp_done = False
    last = e
    for d in range(1, H + 1):
        p = path[d]
        if not np.isfinite(p):  # 데이터 끊김(상장폐지 등): 마지막 유효 종가에서 청산
            got += rem * (last / e - 1)
            rem = 0.0
            events += 1
            break
        last = p
        r = p / e - 1
        if r <= -0.10:
            got += rem * r
            rem = 0.0
            events += 1
            break
        if r <= -0.07 and not half_stop:
            got += rem * 0.5 * r
            rem *= 0.5
            half_stop = True
            events += 1
        elif r >= tp and not tp_done:
            got += rem * 0.5 * r
            rem *= 0.5
            tp_done = True
            events += 1
    if rem > 0:
        got += rem * (last / e - 1)
        events += 1
    cost = BASE_COST + EXTRA_SELL * max(0, events - 1)
    return got - cost, tp_done


def top_mask(t):
    u = UNIV[t].copy()
    tv = np.where(u, TV20[t - 1], -np.inf)
    m = np.zeros(N, bool)
    m[np.argsort(-tv)[:300]] = True
    return u & m


def main():
    # 매달 첫 거래일
    first_days = []
    seen = set()
    for i, d in enumerate(dates):
        ym = d[:6]
        if ym not in seen:
            seen.add(ym)
            first_days.append(i)
    rows = []  # (date, cur, alt, alt_touched)
    for t in first_days:
        if t < 21 or t + H >= T:
            continue
        mask = top_mask(t)
        for j in np.where(mask)[0]:
            path = Cf[t : t + H + 1, j]
            if not np.isfinite(path[0]) or path[0] <= 0:
                continue
            cur, _ = simulate(path, 0.08)
            alt, touched = simulate(path, 0.05)
            rows.append((dates[t], cur, alt, touched))
    n = len(rows)
    ds = np.array([r[0] for r in rows])
    cur = np.array([r[1] for r in rows])
    alt = np.array([r[2] for r in rows])
    touched = np.array([r[3] for r in rows])
    diff = alt - cur
    print(f"진입 {n:,}건 · 월 코호트 {len(set(d[:6] for d in ds))}개 · +5% 도달(ALT) {int(touched.sum()):,}건")

    def block(label, m):
        print(f"  {label}: N={int(m.sum()):,} · CUR 평균 {cur[m].mean()*100:.2f}% · ALT 평균 {alt[m].mean()*100:.2f}% · 차이 {diff[m].mean()*100:+.3f}%p"
              f" · (참고) 도달건만 차이 {diff[m & touched].mean()*100:+.3f}%p")

    early = ds < "20220101"
    print("\nⓑ 평균 차이 (전체 진입 기준)")
    block("2014~2021", early)
    block("2022~2026", ~early)
    block("전체", np.ones(n, bool))

    p5c, p5a = np.quantile(cur, 0.05), np.quantile(alt, 0.05)
    print(f"\nⓒ 하위 5%: CUR {p5c*100:.2f}% · ALT {p5a*100:.2f}% · 차이 {(p5a-p5c)*100:+.2f}%p")

    years = sorted(set(d[:4] for d in ds))
    ydiff = {y: diff[np.array([d[:4] == y for d in ds])].mean() for y in years}
    pos = sum(1 for v in ydiff.values() if v > 0)
    print(f"\nⓓ 연도별 차이 양수 {pos}/{len(years)}년 ({pos/len(years)*100:.0f}%)")
    print("   " + " ".join(f"{y}:{v*100:+.2f}" for y, v in ydiff.items()))

    months = sorted(set(d[:6] for d in ds))
    mdiff = np.array([diff[np.array([d[:6] == m for d in ds])].mean() for m in months])
    tstat = mdiff.mean() / (mdiff.std(ddof=1) / np.sqrt(len(mdiff)))
    print(f"\nⓔ 월 코호트 평균 차이 {mdiff.mean()*100:+.3f}%p · t = {tstat:.2f} (월 {len(mdiff)}개)")

    checks = {
        "ⓐ 도달 N≥10,000": int(touched.sum()) >= 10000,
        "ⓑ 두 구간 모두 ≥ +0.3%p": diff[early].mean() >= 0.003 and diff[~early].mean() >= 0.003,
        "ⓒ 하위5% 0.5%p 넘게 나쁘지 않음": (p5a - p5c) >= -0.005,
        "ⓓ 양수 연도 ≥ 70%": pos / len(years) >= 0.7,
        "ⓔ t ≥ 2": tstat >= 2,
    }
    print("\n판정(H67 사전 기준)")
    for k, v in checks.items():
        print(f"  {'통과' if v else '불통과'}  {k}")
    print("→ 통과 (11/23 관문 후보, 채택 아님)" if all(checks.values()) else "→ 기각")


if __name__ == "__main__":
    main()
