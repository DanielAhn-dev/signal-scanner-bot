from __future__ import annotations

from typing import Iterable, List, Tuple

import numpy as np
import pandas as pd

COMMON_SPLIT_RATIOS: Tuple[int, ...] = (2, 3, 4, 5, 10)
SPLIT_RATIO_TOLERANCE = 0.35
MIN_SPLIT_TRIGGER = 1.8


def _safe_float(value) -> float:
    try:
        result = float(value)
        if np.isnan(result) or np.isinf(result):
            return float("nan")
        return result
    except Exception:
        return float("nan")


def _match_split_ratio(raw_ratio: float) -> float | None:
    if not np.isfinite(raw_ratio) or raw_ratio < MIN_SPLIT_TRIGGER:
        return None

    nearest = min(COMMON_SPLIT_RATIOS, key=lambda item: abs(raw_ratio - item))
    if abs(raw_ratio - nearest) / nearest > SPLIT_RATIO_TOLERANCE:
        return None
    return float(nearest)


def adjust_ohlcv_for_splits(
    df: pd.DataFrame,
    *,
    open_col: str = "시가",
    high_col: str = "고가",
    low_col: str = "저가",
    close_col: str = "종가",
    volume_col: str = "거래량",
) -> tuple[pd.DataFrame, list[str]]:
    if df is None or df.empty or close_col not in df.columns:
        return df, []

    adjusted = df.copy()
    adjusted = adjusted.sort_index()
    closes = adjusted[close_col].astype(float).to_numpy()
    if len(closes) < 2:
        return adjusted, []

    price_factors = np.ones(len(adjusted), dtype=float)
    volume_factors = np.ones(len(adjusted), dtype=float)
    detected: List[str] = []
    cumulative_price = 1.0
    cumulative_volume = 1.0

    for idx in range(len(closes) - 1, 0, -1):
        prev_close = _safe_float(closes[idx - 1])
        curr_close = _safe_float(closes[idx])
        if not np.isfinite(prev_close) or not np.isfinite(curr_close) or curr_close <= 0:
            price_factors[idx - 1] = cumulative_price
            volume_factors[idx - 1] = cumulative_volume
            continue

        ratio = _match_split_ratio(prev_close / curr_close)
        if ratio:
            cumulative_price /= ratio
            cumulative_volume *= ratio
            prev_label = str(adjusted.index[idx - 1])[:10]
            curr_label = str(adjusted.index[idx])[:10]
            detected.append(f"{prev_label}->{curr_label} x{int(ratio)}")

        price_factors[idx - 1] = cumulative_price
        volume_factors[idx - 1] = cumulative_volume

    for col in (open_col, high_col, low_col, close_col):
        if col in adjusted.columns:
            adjusted[col] = (
                adjusted[col].astype(float).to_numpy() * price_factors
            ).round(4)

    if volume_col in adjusted.columns:
        adjusted[volume_col] = (
            adjusted[volume_col].astype(float).to_numpy() * volume_factors
        ).round()

    return adjusted, detected[::-1]