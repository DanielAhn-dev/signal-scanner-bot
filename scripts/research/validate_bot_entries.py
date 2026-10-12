# -*- coding: utf-8 -*-
"""
봇 신규 매수의 진입 시점 특징 기술 분석 H36 (2026-10-12). 판정 없음 — 가설 출처용.
docs/hypothesis-ledger.md H36: 표본 22건이라 결론을 내지 않고, 의심되는 특징은 별도 가설로 등록해 전체 후보군에서 검증한다.

대상: .research-cache/bot_buys.json 의 종목 매수(가상 계좌 8311154094, 지수 ETF 제외)
특징(매수 전날 종가 t 기준, 같은 날 거래대금 상위 300 안에서의 백분위로도 표시):
  진입 갭(매수가÷전날 종가) · 5일 수익 · 21일 수익 · 거래량 배수(전날÷20일 평균) · 52주 고가 근접 · 20일 변동성 · 20일선 괴리
  같은 날 신규 매수 건수 · 코스피 5일 수익
성과: 매수가 → 마지막 종가(캐시 끝) 수익, 같은 기간 코스피 대비 초과, 매수 후 5거래일 수익.

실행: python scripts/research/validate_bot_entries.py
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T = vt.dates, vt.T
Cf, H, V, V20, R1 = vt.Cf, vt.H, vt.V, vt.V20, vt.R1
codes = vt.codes
cidx = {c: j for j, c in enumerate(codes)}
di = {d: i for i, d in enumerate(dates)}
C = ".research-cache/"
kospi = dict(json.load(open(C + "kospi.json")))
K = np.array([kospi.get(d, np.nan) for d in dates])
for _i in range(1, len(K)):  # 지수 캐시가 종목 캐시보다 며칠 짧다 — 마지막 값을 이어 쓴다
    if not np.isfinite(K[_i]):
        K[_i] = K[_i - 1]


def pct_rank(vals, x):
    v = vals[np.isfinite(vals)]
    return float((v < x).mean() * 100) if len(v) else float("nan")


def main():
    buys = [b for b in json.load(open(C + "bot_buys.json", encoding="utf-8"))
            if b["chat_id"] == 8311154094 and b["code"] != "069500"]
    per_day = {}
    for b in buys:
        d = b["traded_at"][:10].replace("-", "")
        per_day[d] = per_day.get(d, 0) + 1
    rows = []
    for b in buys:
        d = b["traded_at"][:10].replace("-", "")
        if d not in di or b["code"] not in cidx:
            continue
        e, j = di[d], cidx[b["code"]]
        t = e - 1
        if t < 252:
            continue
        uni = np.where(lc.topm(t))[0]
        f = {}
        f["진입 갭"] = b["price"] / Cf[t, j] - 1
        f["5일 수익"] = Cf[t, j] / Cf[t - 5, j] - 1
        f["21일 수익"] = Cf[t, j] / Cf[t - 21, j] - 1
        f["거래량 배수"] = V[t, j] / V20[t - 1, j]
        f["52주 고가 근접"] = Cf[t, j] / np.nanmax(H[t - 249:t + 1, j])
        f["20일 변동성"] = np.nanstd(R1[t - 19:t + 1, j])
        f["20일선 괴리"] = Cf[t, j] / np.nanmean(Cf[t - 19:t + 1, j]) - 1
        # 같은 날 상위 300 안 백분위
        pr = {}
        pr["5일 수익"] = pct_rank(Cf[t, uni] / Cf[t - 5, uni] - 1, f["5일 수익"])
        pr["21일 수익"] = pct_rank(Cf[t, uni] / Cf[t - 21, uni] - 1, f["21일 수익"])
        pr["52주 고가 근접"] = pct_rank(Cf[t, uni] / np.nanmax(H[t - 249:t + 1][:, uni], axis=0), f["52주 고가 근접"])
        pr["20일 변동성"] = pct_rank(np.nanstd(R1[t - 19:t + 1][:, uni], axis=0), f["20일 변동성"])
        last = T - 1
        while last > e and not np.isfinite(Cf[last, j]):
            last -= 1
        ret = Cf[last, j] / b["price"] - 1
        kret = K[last] / K[e] - 1 if np.isfinite(K[last]) and np.isfinite(K[e]) else float("nan")
        r5 = Cf[e + 5, j] / b["price"] - 1 if e + 5 <= last else float("nan")
        k5f = K[e + 5] / K[e] - 1 if e + 5 <= last else float("nan")
        rows.append(dict(code=b["code"], date=d, f=f, pr=pr, cluster=per_day[d], k5=K[t] / K[t - 5] - 1,
                         ret=ret, kret=kret, ex=ret - kret, r5=r5, ex5=r5 - k5f, days=last - e, memo=b["memo"].split("event=")[1].split(";")[0]))
    rows.sort(key=lambda r: r["ex"])
    print(f"봇 신규 매수 {len(rows)}건 (캐시 마지막 종가 {dates[-1]} 기준)")
    print(f"{'매수일':<10}{'종목':<8}{'유형':<14}{'갭':>6}{'5일':>7}{'21일':>7}{'21일 백분위':>9}{'52주 근접':>9}{'변동성 백분위':>11}{'당일 건수':>7}{'코스피5일':>8} | {'보유일':>4}{'수익':>8}{'지수':>7}{'초과':>8}")
    for r in rows:
        f, pr = r["f"], r["pr"]
        print(f"{r['date']:<10}{r['code']:<8}{r['memo']:<14}{f['진입 갭']*100:+5.1f}%{f['5일 수익']*100:+6.1f}%{f['21일 수익']*100:+6.1f}%{pr['21일 수익']:9.0f}{f['52주 고가 근접']*100:8.0f}%{pr['20일 변동성']:11.0f}{r['cluster']:7d}{r['k5']*100:+7.1f}% | {r['days']:4d}{r['ret']*100:+7.1f}%{r['kret']*100:+6.1f}%{r['ex']*100:+7.1f}%")
    half = len(rows) // 2
    lo, hi = rows[:half], rows[half:]
    print(f"\n하위 {len(lo)}건(초과수익 낮은 쪽) vs 상위 {len(hi)}건 — 특징 중앙값 (참고용, 표본 작아 판정 없음)")
    for k in ["진입 갭", "5일 수익", "21일 수익", "거래량 배수", "52주 고가 근접", "20일 변동성", "20일선 괴리"]:
        a = np.median([r["f"][k] for r in lo]); b = np.median([r["f"][k] for r in hi])
        scale = 100 if k != "거래량 배수" else 1
        print(f"  {k:<12} 하위 {a*scale:8.2f} · 상위 {b*scale:8.2f}")
    for k in ["5일 수익", "21일 수익", "52주 고가 근접", "20일 변동성"]:
        a = np.median([r["pr"][k] for r in lo]); b = np.median([r["pr"][k] for r in hi])
        print(f"  {k} 백분위(상위 300 안) 하위 {a:5.0f} · 상위 {b:5.0f}")
    print(f"  같은 날 건수 하위 {np.median([r['cluster'] for r in lo]):.1f} · 상위 {np.median([r['cluster'] for r in hi]):.1f}")
    r5s = [r for r in rows if np.isfinite(r["ex5"])]
    print(f"  5거래일 기준 초과(코스피 대비, {len(r5s)}건): 평균 {np.mean([r['ex5'] for r in r5s])*100:+.1f}% · 지수를 이긴 건수 {sum(r['ex5']>0 for r in r5s)}/{len(r5s)}")
    early = [r for r in rows if r["date"] < "20260901"]; late = [r for r in rows if r["date"] >= "20260901"]
    for nm, grp in (("6~7월 진입", early), ("9월 말~ 진입", late)):
        print(f"  {nm} {len(grp)}건: 평균 수익 {np.mean([r['ret'] for r in grp])*100:+.1f}% · 지수 {np.mean([r['kret'] for r in grp])*100:+.1f}% · 초과 {np.mean([r['ex'] for r in grp])*100:+.1f}%")
    print(f"  전체 평균 수익 {np.mean([r['ret'] for r in rows])*100:+.1f}% · 지수 {np.nanmean([r['kret'] for r in rows])*100:+.1f}% · 초과 {np.nanmean([r['ex'] for r in rows])*100:+.1f}%")


if __name__ == "__main__":
    main()
