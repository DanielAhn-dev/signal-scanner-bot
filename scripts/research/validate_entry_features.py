# -*- coding: utf-8 -*-
"""
진입 시점 특징 스캔 F1 (2026-10-06). 가설·판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

목적: 봇이 사는 대형·중형주(전날까지 20일 거래대금 상위 300)에서, 매수 시점에 보이는 특징 중
'꾸준히 지는 구간(회피)'과 '꾸준히 이기는 구간(선호)'을 찾는다.
표본: 5거래일마다, 종가 t에 특징 계산 → t+1 시가 진입 → t+20 종가. 같은 날 표본 평균 대비 초과수익.
특징별로 날짜마다 10분위, 분위별 날짜 평균 → 표본 안(~2021)·밖(2022~) NW t(lag 4).

실행: python scripts/research/validate_entry_features.py
"""
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, N = vt.dates, vt.T, vt.N
O, H, C, V, Cf, TV20, V20 = vt.O, vt.H, vt.C, vt.V, vt.Cf, vt.TV20, vt.V20
R1 = vt.R1
STEP, HOLD = 5, 20
SPLIT = "20220101"

FEATURES = ["5일 수익", "21일 수익", "63일 수익", "20일선 괴리", "200일선 괴리", "20일 변동성", "거래량 배수",
            "윗꼬리", "52주 고가 근접", "전날 갭", "21일 최대 일수익", "거래대금 크기", "이익 성장", "ROE", "상승일 비율"]


def features(t, idx):
    c = Cf[:, idx]
    f = {}
    f["5일 수익"] = c[t] / c[t - 5] - 1
    f["21일 수익"] = c[t] / c[t - 21] - 1
    f["63일 수익"] = c[t] / c[t - 63] - 1
    f["20일선 괴리"] = c[t] / np.nanmean(c[t - 19:t + 1], axis=0) - 1
    f["200일선 괴리"] = c[t] / np.nanmean(c[t - 199:t + 1], axis=0) - 1
    r = R1[t - 19:t + 1][:, idx]
    f["20일 변동성"] = np.nanstd(r, axis=0)
    f["거래량 배수"] = V[t, idx] / V20[t - 1, idx]
    f["윗꼬리"] = H[t, idx] / C[t, idx] - 1
    f["52주 고가 근접"] = c[t] / np.nanmax(H[t - 249:t + 1][:, idx], axis=0)
    f["전날 갭"] = O[t, idx] / c[t - 1] - 1
    f["21일 최대 일수익"] = np.nanmax(R1[t - 20:t + 1][:, idx], axis=0)
    f["거래대금 크기"] = np.log(TV20[t - 1, idx])
    g, roe = vt.feats_at(t)
    f["이익 성장"] = g[idx]
    f["ROE"] = roe[idx]
    f["상승일 비율"] = np.nanmean(r > 0, axis=0)
    return f


def main():
    rec = {k: {d: [] for d in range(10)} for k in FEATURES}  # 특징 → 분위 → [(date, 날짜 평균 초과)]
    for t in range(261, T - HOLD - 1, STEP):
        idx = np.where(lc.topm(t))[0]
        e, x = t + 1, t + HOLD
        y = Cf[x, idx] / O[e, idx] - 1
        ok = np.isfinite(y)
        if ok.sum() < 100:
            continue
        idx, y = idx[ok], y[ok]
        ex = y - y.mean()
        f = features(t, idx)
        for k in FEATURES:
            v = f[k]
            m = np.isfinite(v)
            if m.sum() < 100:
                continue
            rk = np.argsort(np.argsort(v[m]))
            dec = (rk * 10 // m.sum()).astype(int)
            exm = ex[m]
            for d in range(10):
                s = exm[dec == d]
                if len(s):
                    rec[k][d].append((dates[e], s.mean()))

    print("특징별 10분위 20일 초과수익(같은 날 평균 대비). D1 = 값이 가장 작은 10%, D10 = 가장 큰 10%")
    print(f"{'특징':<14}{'분위':>4} {'안 평균':>8} {'안 t':>6} {'밖 평균':>8} {'밖 t':>6}  판정")
    cands = []
    for k in FEATURES:
        res = {}
        for d in range(10):
            L = rec[k][d]
            a = np.array([v for dd, v in L if dd < SPLIT])
            b = np.array([v for dd, v in L if dd >= SPLIT])
            res[d] = (a.mean(), vt.nw_t(a, 4), b.mean(), vt.nw_t(b, 4))
        for d, nb in ((0, 1), (9, 8)):
            am, at, bm, bt = res[d]
            same_nb = np.sign(res[nb][0]) == np.sign(am) and np.sign(res[nb][2]) == np.sign(bm)
            tag = ""
            if am < 0 and bm < 0 and at < -3 and bt < -3 and same_nb:
                tag = "회피 후보"
            elif am > 0.0033 and bm > 0.0033 and at > 3 and bt > 3 and same_nb:
                tag = "선호 후보"
            print(f"{k:<14}{'D' + str(d + 1):>4} {am*100:+7.2f}% {at:6.2f} {bm*100:+7.2f}% {bt:6.2f}  {tag}")
            if tag:
                cands.append((k, d + 1, tag, am, at, bm, bt))
    print("\n=== 후보 ===")
    for k, d, tag, am, at, bm, bt in cands:
        print(f"  {tag}: {k} D{d} — 안 {am*100:+.2f}% (t {at:.1f}) · 밖 {bm*100:+.2f}% (t {bt:.1f})")
    if not cands:
        print("  없음")


if __name__ == "__main__":
    main()
