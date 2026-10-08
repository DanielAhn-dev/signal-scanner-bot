# -*- coding: utf-8 -*-
"""
H30 메타 전략(2026-10-08): 분기마다 직전 12개월 수익 1위 전략으로 갈아타면 고정 혼합보다 낫나.
판정 기준은 docs/hypothesis-ledger.md H30에 결과 보기 전 고정.

후보 6종: 거래대금 상위 300(전날 20일 기준), 20종목 동일가중, 21거래일 교체, 비용 포함(vt.run_rebal).
  mom   12-1 모멘텀          high  52주 고가 근접
  rev   1개월 하위(반전)      lowv  60일 저변동
  pref  저변동+52주 고가 순위 평균(C22 근사 — 봇은 20일 변동성, 여기선 60일)
  ew    상위 300 동일가중
메타: 분기 첫 달(1·4·7·10월)에 직전 L개월 누적 수익 1위를 3개월 보유. 바꿀 때마다 0.5% 차감.
비교: 6종 고정 동일 혼합(월 재조정), 참고: 코스피 + 배당 연 1.5%.

실행: python scripts/research/validate_meta_switch.py
"""
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc  # 가격 패널·상위 300 마스크 공유

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
Cf, H, T, N = vt.Cf, vt.H, vt.T, vt.N
N_HOLD, STEP, SWITCH_COST = 20, 21, 0.005
SPLIT = "202112"  # 전반 ~2021-12, 후반 2022-01~


def _pick(score, tm, n, high_is_good=True):
    s = np.where(tm & np.isfinite(score), score, -np.inf if high_is_good else np.inf)
    o = np.argsort(-s if high_is_good else s)[:n]
    return o[np.isfinite(s[o])]


def sel_mom(t, n):
    return _pick(Cf[t - 21] / Cf[t - 252] - 1, lc.topm(t), n)


def sel_high(t, n):
    return lc.sel_high52(t, n)


def sel_rev(t, n):
    return lc.sel_rev1m(t, n)


def sel_lowv(t, n):
    return _pick(vt.vol60(t), lc.topm(t), n, high_is_good=False)


def sel_pref(t, n):
    tm = lc.topm(t)
    v = vt.vol60(t)
    hi = Cf[t] / np.nanmax(H[t - 249:t + 1], axis=0)
    ok = tm & np.isfinite(v) & np.isfinite(hi)
    if ok.sum() < n * 3:
        return np.array([], int)
    s = np.full(N, np.inf)
    s[ok] = vt.rank(v[ok], True) + vt.rank(hi[ok], False)
    return np.argsort(s)[:n]


def sel_ew(t, n):
    return np.where(lc.topm(t))[0]


STRATS = {"mom": sel_mom, "high": sel_high, "rev": sel_rev, "lowv": sel_lowv, "pref": sel_pref, "ew": sel_ew}


def stats(m, keys):
    x = np.array([m[k] for k in keys])
    nav = np.cumprod(1 + x)
    peak = np.maximum.accumulate(np.concatenate([[1], nav]))[1:]
    cagr = nav[-1] ** (12 / len(x)) - 1
    return cagr, (nav / peak - 1).min()


def meta_series(rets, keys, look):
    """rets: {name: {yyyymm: r}} → 메타 월수익, 고른 전략 기록"""
    out, picks, cur = {}, [], None
    for i, k in enumerate(keys):
        if int(k[4:]) in (1, 4, 7, 10) and i >= look:
            past = keys[i - look:i]
            best = max(rets, key=lambda s: np.prod([1 + rets[s][p] for p in past]))
            if best != cur:
                charge = SWITCH_COST if cur is not None else 0.0
                cur = best
            else:
                charge = 0.0
            picks.append((k, cur))
            out[k] = (1 + rets[cur][k]) * (1 - charge) - 1
        elif cur is not None:
            out[k] = rets[cur][k]
    return out, picks


def main():
    rets = {}
    for name, fn in STRATS.items():
        nav, i0, i1, _ = vt.run_rebal(fn, 260, STEP, N_HOLD)
        rets[name] = vt.monthly_from_daily_nav(nav, i0, i1)
        print(f"  {name} 완료", flush=True)
        i0_all, i1_all = i0, i1
    bench = vt.bench_monthly(i0_all, i1_all)
    keys = sorted(set.intersection(*(set(r) for r in rets.values())) & set(bench))[1:-1]
    keys = [k for k in keys if all(np.isfinite(rets[s][k]) for s in rets)]
    mix = {k: float(np.mean([rets[s][k] for s in rets])) for k in keys}

    print(f"\n기간 {keys[0]}~{keys[-1]} ({len(keys)}개월)")
    print(f"{'전략':<8}{'연수익':>8}{'최대낙폭':>9}")
    for s in rets:
        c, d = stats(rets[s], keys)
        print(f"{s:<8}{c*100:7.1f}%{d*100:8.1f}%")
    for label, m in (("혼합", mix), ("코스피", bench)):
        c, d = stats(m, keys)
        print(f"{label:<8}{c*100:7.1f}%{d*100:8.1f}%")

    verdict = None
    for look in (12, 6, 36):
        meta, picks = meta_series(rets, keys, look)
        mk = [k for k in keys if k in meta]
        diff = np.array([meta[k] - mix[k] for k in mk])
        first = np.array([k <= SPLIT for k in mk])
        e1, e2 = diff[first].mean() * 12, diff[~first].mean() * 12
        t_all = vt.nw_t(diff)
        cm, dm = stats(meta, mk)
        cx, dx = stats(mix, mk)
        cb, _ = stats(bench, mk)
        switches = sum(1 for a, b in zip(picks, picks[1:]) if a[1] != b[1])
        tag = "판정" if look == 12 else "민감도"
        print(f"\n[{tag}] 직전 {look}개월 기준 · {mk[0]}~{mk[-1]} · 교체 {switches}회 / {len(picks)}분기")
        print(f"  메타 연 {cm*100:.1f}% 낙폭 {dm*100:.1f}% | 혼합 연 {cx*100:.1f}% 낙폭 {dx*100:.1f}% | 코스피 연 {cb*100:.1f}%")
        print(f"  메타−혼합 전반 {e1*100:+.2f}%p · 후반 {e2*100:+.2f}%p · 전체 NW t {t_all:.2f}")
        from collections import Counter
        print("  고른 횟수:", dict(Counter(p for _, p in picks)))
        if look == 12:
            ok = e1 >= 0.01 and e2 >= 0.01 and t_all > 2 and dm >= dx - 0.05
            verdict = "채택" if ok else "기각"
    print(f"\nH30 판정(사전 기준, 12개월): {verdict}")


if __name__ == "__main__":
    main()
