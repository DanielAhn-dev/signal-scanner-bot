# -*- coding: utf-8 -*-
"""
H83 (2026-10-28): 워크포워드로 학습한 점수가 고정 점수 F2보다 승률·순초과수익을 높이는가.
기준은 docs/hypothesis-ledger.md H83에 결과 보기 전 고정. 하이퍼파라미터는 아래 상수에서 바꾸지 않는다.

비교 대상
  F2    : 저변동 + 52주 고가 근접 + ROE 순위 평균 (validate_composite_pref.py와 같은 정의, 회피 규칙 없음)
  학습  : 15개 진입 특징의 일별 순위 → 20일 순수익 순위를 릿지로 예측. 과거만으로 12개월마다 재학습.
  대조  : 라벨을 날짜 안에서 섞어 같은 방식으로 학습 — 순초과수익이 0과 같아야 파이프라인에 새는 곳이 없다
표본: 5거래일마다 종가 t 특징 → t+1 시가 진입 → t+20 종가, 거래대금 상위 300, 왕복 비용 차감.
평가: 상위 20% 종목의 같은 날 유니버스 평균 대비 순초과수익과 승률.

실행: python scripts/research/validate_learned_score.py
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_entry_features as ef

lc, vt = ef.lc, ef.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T = ef.dates, ef.T
Cf, O = ef.Cf, ef.O
STEP, HOLD, FEATURES = ef.STEP, ef.HOLD, ef.FEATURES

LAMBDA = 10.0          # 릿지 강도 (사전 고정)
TRAIN_MIN = 756        # 첫 평가 전 최소 학습 기간(거래일, 약 3년)
REFIT_EVERY = 250      # 재학습 주기(거래일, 약 12개월)
EMBARGO = 20           # 학습 라벨 종료~평가 시작 격리(거래일)
TOP_FRAC = 0.2
SEED = 83
F2_COLS = [FEATURES.index("20일 변동성"), FEATURES.index("52주 고가 근접"), FEATURES.index("ROE")]

C = ".research-cache/"
_k = dict(json.load(open(C + "kospi.json")))
K = np.array([_k.get(d, np.nan) for d in dates])
for _i in range(1, T):
    if not np.isfinite(K[_i]):
        K[_i] = K[_i - 1]


def rank01(x):
    m = np.isfinite(x)
    r = np.full(len(x), np.nan)
    r[m] = np.argsort(np.argsort(x[m])) / max(m.sum() - 1, 1)
    return r


def build_samples():
    S = []
    for t in range(261, T - HOLD - 1, STEP):
        idx = np.where(lc.topm(t))[0]
        e, x = t + 1, t + HOLD
        y = Cf[x, idx] / O[e, idx] - 1
        ok = np.isfinite(y)
        if ok.sum() < 100:
            continue
        idx, y = idx[ok], y[ok]
        cost = np.array([lc.rt_cost(j, t) for j in idx])
        yn = y - cost
        f = ef.features(t, idx)
        X = np.column_stack([rank01(f[k]) for k in FEATURES])
        f2 = (rank01(-f["20일 변동성"]) + rank01(f["52주 고가 근접"]) + rank01(f["ROE"])) / 3
        keep = np.isfinite(f2)  # F2가 계산되는 종목만 (둘 다 같은 종목 집합에서 고른다)
        if keep.sum() < 80:
            continue
        X, yn, f2 = X[keep], yn[keep], f2[keep]
        X = np.where(np.isfinite(X), X, 0.5)
        S.append(dict(t=t, d=dates[e], X=X, yn=yn, ex=yn - yn.mean(), f2=f2,
                      tgt=rank01(yn) - 0.5, kos=K[x] / K[e] - 1))
    return S


def fit_ridge(rows, shuffle, rng):
    Xs = np.vstack([r["X"] for r in rows])
    ys = np.concatenate([rng.permutation(r["tgt"]) if shuffle else r["tgt"] for r in rows])
    mx, my = Xs.mean(0), ys.mean()
    Xc = Xs - mx
    w = np.linalg.solve(Xc.T @ Xc + LAMBDA * np.eye(Xc.shape[1]), Xc.T @ (ys - my))
    return w


def top_stats(score, r):
    n = len(score)
    k = max(int(n * TOP_FRAC), 1)
    sel = np.argsort(-score)[:k]
    return r["ex"][sel].mean(), (r["ex"][sel] > 0).mean(), (r["yn"][sel] > 0).mean(), r["yn"][sel].mean()


def main():
    S = build_samples()
    print(f"표본 날짜 {len(S)}개 ({S[0]['d']} ~ {S[-1]['d']}), 종목수/일 평균 {np.mean([len(s['f2']) for s in S]):.0f}")
    first = next(i for i, s in enumerate(S) if s["t"] >= S[0]["t"] + TRAIN_MIN)  # ROE 데이터가 2018-04부터라 표본 시작 기준
    rng = np.random.default_rng(SEED)
    rec = []  # (date, F2, 학습, 대조) 각 (초과, 초과승률, 절대승률, 순수익)
    w_real = w_shuf = None
    last_fit_t = None
    for i in range(first, len(S)):
        s = S[i]
        if last_fit_t is None or s["t"] - last_fit_t >= REFIT_EVERY:
            train = [r for r in S[:i] if r["t"] + HOLD < s["t"] - EMBARGO]
            w_real = fit_ridge(train, False, rng)
            w_shuf = fit_ridge(train, True, rng)
            last_fit_t = s["t"]
            top = np.argsort(-np.abs(w_real))[:4]
            print(f"  재학습 {s['d']} (학습 {len(train)}일): " + ", ".join(f"{FEATURES[j]} {w_real[j]:+.2f}" for j in top))
        rec.append((s["d"], top_stats(s["f2"], s), top_stats(s["X"] @ w_real, s),
                    top_stats(s["X"] @ w_shuf, s), s["kos"]))

    dts = np.array([r[0] for r in rec])
    A = {n: np.array([r[j] for r in rec]) for n, j in (("F2", 1), ("학습", 2), ("대조", 3))}
    kos = np.array([r[4] for r in rec])
    print(f"\n평가 {len(rec)}일 ({dts[0]} ~ {dts[-1]}), 상위 {int(TOP_FRAC*100)}% 종목, 20일 보유 순수익 기준\n")
    print(f"{'점수':<6}{'순초과 평균':>11}{'초과 승률':>10}{'절대 승률':>10}{'순수익 평균':>11}")
    for n, a in A.items():
        print(f"{n:<6}{a[:,0].mean()*100:>+10.2f}%{a[:,1].mean()*100:>9.1f}%{a[:,2].mean()*100:>9.1f}%{a[:,3].mean()*100:>+10.2f}%")
    print(f"(참고) 같은 구간 코스피 20일 평균 {np.nanmean(kos)*100:+.2f}%")

    def judge(name, B, base):
        d = B[:, 0] - base[:, 0]
        t = vt.nw_t(d, 4)
        wr = (B[:, 1] - base[:, 1]).mean()
        half = len(d) // 2
        h1, h2 = d[:half].mean(), d[half:].mean()
        yrs = sorted({x[:4] for x in dts})
        ydiff = [d[np.array([x[:4] == y for x in dts])].mean() for y in yrs]
        pos = np.mean([v > 0 for v in ydiff])
        a_ok = d.mean() >= 0.005 and t >= 2
        b_ok = wr >= 0.02
        c_ok = h1 > 0 and h2 > 0
        d_ok = pos >= 0.6
        print(f"\n[{name} − F2]")
        print(f"  ⓐ 순초과 차이 {d.mean()*100:+.2f}%p, NW t {t:.2f}  → {'통과' if a_ok else '불통과'}")
        print(f"  ⓑ 초과 승률 차이 {wr*100:+.1f}%p  → {'통과' if b_ok else '불통과'}")
        print(f"  ⓒ 전반 {h1*100:+.2f}%p / 후반 {h2*100:+.2f}%p  → {'통과' if c_ok else '불통과'}")
        print(f"  ⓓ 양수 연도 {pos*100:.0f}% ({sum(v > 0 for v in ydiff)}/{len(ydiff)})  → {'통과' if d_ok else '불통과'}")
        print("     연도별: " + ", ".join(f"{y} {v*100:+.2f}" for y, v in zip(yrs, ydiff)))
        return a_ok and b_ok and c_ok and d_ok, t

    ok, t_real = judge("학습", A["학습"], A["F2"])
    t_shuf = vt.nw_t(A["대조"][:, 0], 4)
    ctrl_ok = abs(t_shuf) < 2
    print(f"\nⓔ 대조(라벨 섞음) 순초과 {A['대조'][:,0].mean()*100:+.2f}%, NW |t| {abs(t_shuf):.2f} → "
          f"{'통과(파이프라인 정상)' if ctrl_ok else '불통과(무효)'}")
    verdict = "성립" if (ok and ctrl_ok) else ("무효" if not ctrl_ok else "기각")
    print(f"\n최종: {verdict}")


if __name__ == "__main__":
    main()
