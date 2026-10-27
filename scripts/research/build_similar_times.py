# -*- coding: utf-8 -*-
"""
'지금과 비슷했던 때' 화면(web/src/features/similar-times)이 읽는 숫자를 만든다 — web/src/data/similarTimes.json.
코스피 일봉만으로 매주 마지막 거래일의 '시장 상태'(가격 기반 심리 점수·60일 고점 대비·20일 변동성)를 계산하고,
그 뒤 120거래일의 가격 경로를 함께 저장한다. 서버(src/services/sentimentState.ts)가 오늘 값을 같은 정의로 계산하며,
두 정의가 어긋나지 않도록 tests/fixtures/sentiment_parity.json에 검증용 사례를 함께 내보낸다.

상태 정의 (종가만 사용, 정의 바꾸면 서버·테스트도 같이 바꾼다)
  모멘텀  = 종가 ÷ 125일 평균 − 1
  가격 강도 = (종가 − 250일 최저) ÷ (250일 최고 − 250일 최저)
  고요함  = −(20일 변동성 ÷ 직전 50거래일 20일 변동성 평균 − 1)   (변동성이 평소보다 낮을수록 높음)
  각 요소를 직전 500거래일 안 백분위 순위(250개 이상 필요)로 바꿔 동일 가중 평균 = 심리 점수(0~100)
  60일 고점 대비(%) = 종가 ÷ 직전 60거래일(오늘 포함) 최고 − 1
  20일 변동성(연율 %) = 직전 20거래일 일간 로그수익률 표준편차 × √252

실행: python scripts/research/build_similar_times.py
"""
import datetime
import json
import sys
from datetime import date as _d

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
OUT = "web/src/data/similarTimes.json"
PARITY = "tests/fixtures/sentiment_parity.json"
STEP, NSTEP = 5, 24          # 경로: 5거래일 간격, 120거래일까지
WIN, MINOBS = 500, 250


def load_kospi():
    r = json.load(open(C + "kospi.json", encoding="utf-8"))
    d = {x[0]: float(x[1]) for x in r}
    ds = sorted(d)
    return ds, np.array([d[x] for x in ds])


def roll(x, w, fn):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        seg = x[i - w + 1:i + 1]
        if np.isfinite(seg).all():
            out[i] = fn(seg)
    return out


def pct_rank(x, win=WIN, minobs=MINOBS):
    out = np.full(len(x), np.nan)
    for i in range(len(x)):
        if not np.isfinite(x[i]):
            continue
        h = x[max(0, i - win + 1):i + 1]
        h = h[np.isfinite(h)]
        if len(h) >= minobs:
            out[i] = (h <= x[i]).mean() * 100
    return out


def state_series(K):
    """종가 배열 → (심리 점수, 60일 고점 대비 %, 20일 변동성 연율 %)"""
    ret = np.concatenate([[np.nan], np.diff(np.log(K))])
    vol20 = roll(ret, 20, np.std) * np.sqrt(252)
    volavg = roll(vol20, 50, np.mean)
    mom = K / roll(K, 125, np.mean) - 1
    hi, lo = roll(K, 250, np.max), roll(K, 250, np.min)
    strength = (K - lo) / (hi - lo)
    calm = -(vol20 / volavg - 1)
    parts = np.vstack([pct_rank(mom), pct_rank(strength), pct_rank(calm)])
    ok = np.isfinite(parts).all(0)
    score = np.full(len(K), np.nan)
    score[ok] = parts[:, ok].mean(0)
    dd60 = (K / roll(K, 60, np.max) - 1) * 100
    return score, dd60, vol20 * 100


def weekly(dates):
    wk = {}
    for i, dt in enumerate(dates):
        y, w, _ = _d(int(dt[:4]), int(dt[4:6]), int(dt[6:])).isocalendar()
        wk[(y, w)] = i
    return sorted(wk.values())


def q(a, p):
    return float(np.percentile(a, p))


def main():
    dates, K = load_kospi()
    T = len(K)
    score, dd60, vol20 = state_series(K)
    samples = []
    for i in weekly(dates):
        if not (np.isfinite(score[i]) and np.isfinite(dd60[i]) and np.isfinite(vol20[i])) or i + STEP * NSTEP >= T:
            continue
        path = [round((K[i + STEP * k] / K[i] - 1) * 100, 1) for k in range(1, NSTEP + 1)]
        mdd = (K[i + 1:i + 61].min() / K[i] - 1) * 100
        samples.append(dict(d=dates[i], s=round(float(score[i]), 1), dd=round(float(dd60[i]), 1), v=round(float(vol20[i]), 1),
                            r=path, m=round(float(mdd), 1)))
    S = np.array([x["s"] for x in samples]); D = np.array([x["dd"] for x in samples]); V = np.array([x["v"] for x in samples])
    paths = np.array([x["r"] for x in samples])
    base = {}
    for h, name in ((4, "20"), (12, "60"), (24, "120")):       # 인덱스 h-1 = 5*h 거래일
        col = paths[:, h - 1]
        base[name] = dict(median=q(col, 50), p10=q(col, 10), p90=q(col, 90))
    base["path"] = dict(median=[q(paths[:, k], 50) for k in range(NSTEP)], p10=[q(paths[:, k], 10) for k in range(NSTEP)],
                        p90=[q(paths[:, k], 90) for k in range(NSTEP)])
    base["down10Pct"] = float(np.mean([x["m"] <= -10 for x in samples]) * 100)
    out = dict(
        generated=datetime.date.today().isoformat(),
        script="scripts/research/build_similar_times.py",
        period=f"{samples[0]['d'][:4]}-{samples[0]['d'][4:6]}~{samples[-1]['d'][:4]}-{samples[-1]['d'][4:6]}",
        sampleCount=len(samples),
        stepDays=STEP,
        std=dict(s=float(S.std()), dd=float(D.std()), v=float(V.std())),
        baseline=base,
        samples=samples,
    )
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{OUT} 저장 — 표본 {len(samples)}개, {out['period']}, 파일 {len(json.dumps(out)) // 1024}KB")

    # 서버 계산(sentimentState.ts)과 같은지 검증하는 사례: 서로 다른 시점 4곳의 최근 800거래일 종가와 기대값
    cases = []
    for i in (T - 1, T - 400, T - 1500, T - 3000):
        a = max(0, i - 799)
        kk = np.round(K[a:i + 1], 2)          # 서버와 같은 입력(소수 둘째 자리)으로 기대값을 계산
        cs, cd, cv = state_series(kk)
        j = len(cs) - 1
        if np.isfinite(cs[j]) and np.isfinite(cd[j]) and np.isfinite(cv[j]):
            cases.append(dict(date=dates[i], closes=[float(x) for x in kk],
                              expected=dict(score=round(float(cs[j]), 4), dd60=round(float(cd[j]), 4), vol20=round(float(cv[j]), 4))))
    with open(PARITY, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False)
    print(f"{PARITY} 저장 — 검증 사례 {len(cases)}개")


if __name__ == "__main__":
    main()
