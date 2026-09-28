"""
지수 추세 코어 전략 백테스트.

규칙: 전일 종가가 N일 이동평균 위면 지수 ETF 보유, 아래면 CD금리(연 CASH_YIELD) 파킹.
다음 날 시가가 아니라 당일 종가 기준 신호 → 다음 날 종가 수익부터 반영(룩어헤드 없음).
ETF는 증권거래세가 없고, 전환마다 수수료+슬리피지 COST_PCT를 뗀다.

  python scripts/backtest_index_trend.py
  python scripts/backtest_index_trend.py --code 229200 --start 20150101
"""
import argparse
import math

import pandas as pd
from pykrx import stock

CASH_YIELD = 0.028  # CD금리 ETF 최근 1년 수익률(2.82%) 근사
COST_PCT = 0.0007  # 수수료 0.015% + 슬리피지 약 0.05%


def load(code: str, start: str, end: str) -> pd.Series:
    df = stock.get_market_ohlcv(start, end, code)
    close = df.iloc[:, 3].astype(float)
    close.index = pd.to_datetime(close.index)
    return close[close > 0]


def simulate(close: pd.Series, window: int | None, band: float = 0.0) -> pd.Series:
    """일별 전략 수익률. window=None이면 단순 보유."""
    ret = close.pct_change().fillna(0.0)
    daily_cash = (1 + CASH_YIELD) ** (1 / 250) - 1
    if window is None:
        return ret
    sma = close.rolling(window).mean()
    # 히스테리시스: 위로 band 이상 돌파해야 진입, 아래로 band 이상 이탈해야 청산 (잦은 전환 방지)
    state = []
    holding = False
    for c, m in zip(close, sma):
        if math.isnan(m):
            state.append(False)
            continue
        if not holding and c > m * (1 + band):
            holding = True
        elif holding and c < m * (1 - band):
            holding = False
        state.append(holding)
    pos = pd.Series(state, index=close.index, dtype=bool).shift(1, fill_value=False)
    switches = pos.astype(int).diff().abs().fillna(0)
    strat = pos * ret + (~pos) * daily_cash - switches * COST_PCT
    return strat


def stats(daily: pd.Series) -> dict:
    eq = (1 + daily).cumprod()
    years = len(daily) / 250
    cagr = eq.iloc[-1] ** (1 / years) - 1 if years > 0 else 0
    mdd = (eq / eq.cummax() - 1).min()
    vol = daily.std() * math.sqrt(250)
    sharpe = (daily.mean() * 250 - CASH_YIELD) / vol if vol > 0 else 0
    return {"CAGR": cagr * 100, "MDD": mdd * 100, "Sharpe": sharpe, "Total": (eq.iloc[-1] - 1) * 100}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--code", default="069500")
    p.add_argument("--start", default="20150101")
    p.add_argument("--end", default="20260925")
    args = p.parse_args()

    close = load(args.code, args.start, args.end)
    print(f"{args.code}: {close.index[0].date()} ~ {close.index[-1].date()} ({len(close)}일)")
    mid = close.index[len(close) // 2]
    variants = [("보유", None, 0.0)] + [(f"SMA{w}", w, 0.0) for w in (20, 50, 100, 200)] + [
        (f"SMA{w}±2%", w, 0.02) for w in (50, 100, 200)
    ]
    rows = []
    for name, w, band in variants:
        d = simulate(close, w, band)
        full, first, second = stats(d), stats(d[d.index < mid]), stats(d[d.index >= mid])
        rows.append((name, full, first, second))
    print(f"구간 분할: 전반 ~{mid.date()} / 후반 {mid.date()}~  (CD금리 {CASH_YIELD*100:.1f}%·전환비용 {COST_PCT*100:.2f}%)")
    print(f"{'전략':<10}{'CAGR':>8}{'MDD':>8}{'Sharpe':>8}{'전반CAGR':>10}{'전반MDD':>9}{'후반CAGR':>10}{'후반MDD':>9}")
    for name, f, a, b in rows:
        print(f"{name:<10}{f['CAGR']:>7.1f}%{f['MDD']:>7.1f}%{f['Sharpe']:>8.2f}{a['CAGR']:>9.1f}%{a['MDD']:>8.1f}%{b['CAGR']:>9.1f}%{b['MDD']:>8.1f}%")


if __name__ == "__main__":
    main()
