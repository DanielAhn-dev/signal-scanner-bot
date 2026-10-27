# -*- coding: utf-8 -*-
"""
H77 (2026-10-27): 지수 노출 비중을 정할 때 변동성 예측기로 VKOSPI(VIX)를 쓰면 직전 60일 실현변동성보다 샤프·낙폭 개선이 큰가.
정의·판정 기준은 docs/plan-forecast-ledger-2026-10-27.md §25에 결과 보기 전 고정.

실행: python scripts/research/validate_vol_target_vkospi.py > .research-cache/vol_target_out.txt
"""
import json
import sys

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
TARGET, COST = 0.15, 0.001
NBOOT, BLOCK = 2000, 12
rng = np.random.default_rng(20261027)


def load(path, col=1):
    r = json.load(open(C + path, encoding="utf-8"))
    d = {x[0]: float(x[col]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


def ffill(dates, pairs):
    d = dict(pairs)
    out = np.full(len(dates), np.nan)
    last = np.nan
    for i, dt in enumerate(dates):
        if dt in d:
            last = d[dt]
        out[i] = last
    return out


def build(dates, K, implied, cash_annual_at, start):
    """월말 표본: 노출 신호 3종과 다음 달 수익·현금수익"""
    T = len(K)
    ret = np.concatenate([[np.nan], np.diff(np.log(K))])
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= start]
    me.append(T - 1) if dates[T - 1][:6] == dates[me[-1] + 1][:6] and False else None
    rows = []
    for a, b in zip(me[:-1], me[1:]):
        seg60, seg20 = ret[a - 59:a + 1], ret[a - 19:a + 1]
        imp5 = implied[a - 4:a + 1]
        if not (np.isfinite(seg60).all() and np.isfinite(imp5).all()) or a < 60:
            continue
        sig = dict(
            V=float(np.mean(imp5)) / 100.0,
            R60=float(np.std(seg60) * np.sqrt(252)),
            R20=float(np.std(seg20) * np.sqrt(252)),
        )
        rows.append(dict(date=dates[a], r=K[b] / K[a] - 1, c=cash_annual_at(a) / 100.0 / 12.0, **sig))
    return rows


def metrics(r_exc, ret):
    sharpe = r_exc.mean() / r_exc.std(ddof=1) * np.sqrt(12) if r_exc.std(ddof=1) > 0 else np.nan
    eq = np.cumprod(1 + ret)
    peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
    return sharpe, float(-(eq / peak - 1).min())


def evaluate(rows, key, idx=None):
    idx = np.arange(len(rows)) if idx is None else idx
    r = np.array([rows[i]["r"] for i in idx])
    c = np.array([rows[i]["c"] for i in idx])
    sig = np.array([rows[i][key] for i in idx])
    w = np.clip(TARGET / sig, 0.0, 1.0)
    wprev = np.concatenate([[w[0]], w[:-1]])
    strat = w * r + (1 - w) * c - COST * np.abs(w - wprev)
    abar = w.mean()
    const = abar * r + (1 - abar) * c
    s_s, d_s = metrics(strat - c, strat)
    s_c, d_c = metrics(const - c, const)
    return dict(dSharpe=s_s - s_c, dMdd=d_c - d_s, abar=abar, sharpe=s_s, sharpe_c=s_c, mdd=d_s, mdd_c=d_c,
                cagr=float(np.prod(1 + strat) ** (12 / len(strat)) - 1))


def report(name, rows, split):
    n = len(rows)
    print(f"\n===== {name} ({rows[0]['date']}~{rows[-1]['date']}, {n}개월) =====")
    res = {}
    for key, lab in (("V", "VKOSPI/VIX"), ("R60", "실현 60일"), ("R20", "실현 20일[기술]")):
        res[key] = {"all": evaluate(rows, key)}
        res[key]["e1"] = evaluate(rows, key, np.array([i for i, x in enumerate(rows) if x["date"] < split]))
        res[key]["e2"] = evaluate(rows, key, np.array([i for i, x in enumerate(rows) if x["date"] >= split]))
        a = res[key]["all"]
        print(f"[{lab}] 평균 노출 {a['abar']:.2f} · 샤프 {a['sharpe']:.2f}(고정 비중 {a['sharpe_c']:.2f}) → 개선 {a['dSharpe']:+.3f} · "
              f"최대낙폭 {a['mdd']:.1%}(고정 비중 {a['mdd_c']:.1%}) → 개선 {a['dMdd'] * 100:+.1f}%p · 연 {a['cagr']:.1%}")
        for e, el in (("e1", f"전반(<{split[:4]})"), ("e2", f"후반(≥{split[:4]})")):
            x = res[key][e]
            print(f"     {el}: 샤프 개선 {x['dSharpe']:+.3f} · 낙폭 개선 {x['dMdd'] * 100:+.1f}%p · 평균 노출 {x['abar']:.2f}")
    # 기술: 샤프 개선 차이(V − R60)의 12개월 블록 부트스트랩
    nb = int(np.ceil(n / BLOCK))
    diffs = []
    for _ in range(NBOOT):
        st = rng.integers(0, n - BLOCK + 1, size=nb)
        idx = (st[:, None] + np.arange(BLOCK)).reshape(-1)[:n]
        try:
            diffs.append(evaluate(rows, "V", idx)["dSharpe"] - evaluate(rows, "R60", idx)["dSharpe"])
        except Exception:
            pass
    lo, hi = np.nanpercentile(diffs, [5, 95])
    print(f"[기술] 샤프 개선 차이(V−R60) 12개월 블록 부트스트랩 90% [{lo:+.3f}, {hi:+.3f}]")
    return res


def ok_both(res):
    v, r = res["V"], res["R60"]
    return all(v[e]["dSharpe"] >= r[e]["dSharpe"] and v[e]["dMdd"] >= r[e]["dMdd"] for e in ("e1", "e2"))


def main():
    print(f"H77 — 노출 w = min(1, {TARGET:.0%} ÷ σ_예측), 월 리밸런싱, 비용 {COST:.1%}×|Δw|, 평균 노출을 맞춘 고정 비중 대비 개선")
    dk, Kk = load("kospi.json")
    vk = ffill(dk, json.load(open(C + "vkospi.json")))
    cd = ffill(dk, json.load(open(C + "allweather/cd91.json")))
    rk = build(dk, Kk, vk, lambda i: cd[i], "20040101")
    resk = report("코스피 + VKOSPI, 현금 CD91", rk, "20150101")

    ds, Ks = load("yh_GSPC_daily.json")
    vx = ffill(ds, json.load(open(C + "yh_VIX_daily.json")))
    irx = json.load(open(C + "yh_IRX_me.json"))
    dates_s = ds

    def cash_us(i):
        return float(irx.get(dates_s[i][:6], 0.0))

    rs = build(ds, Ks, vx, cash_us, "19910101")
    ress = report("S&P500 + VIX, 현금 미 3개월 금리", rs, "20090101")

    print("\n===== 판정 =====")
    a_v, a_r = resk["V"]["all"]["dSharpe"], resk["R60"]["all"]["dSharpe"]
    if a_v <= a_r:
        v = "기각 (코스피 전체에서 V의 샤프 개선이 R60 이하)"
    elif a_v > 0 and ok_both(resk) and ok_both(ress) and \
            ress["V"]["all"]["dSharpe"] >= ress["R60"]["all"]["dSharpe"] and ress["V"]["all"]["dMdd"] >= ress["R60"]["all"]["dMdd"]:
        v = "성립"
    else:
        v = "미달 (일부만 충족)"
    print(f"코스피 전체 샤프 개선 V {a_v:+.3f} vs R60 {a_r:+.3f} · 코스피 두 시대 V≥R60 {ok_both(resk)} · S&P 두 시대 V≥R60 {ok_both(ress)} → {v}")


if __name__ == "__main__":
    main()
