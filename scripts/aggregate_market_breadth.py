"""Aggregate daily market breadth from stock_daily and universe snapshots.

Usage:
  python scripts/aggregate_market_breadth.py
  python scripts/aggregate_market_breadth.py --date 20260930
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from supabase import Client, create_client

from _env import load_env


def fetch_all(build: Any) -> list[dict]:
    rows: list[dict] = []
    for offset in range(0, 200_000, 1000):
        response = build(offset, offset + 999).execute()
        page = response.data or []
        rows.extend(page)
        if len(page) < 1000:
            break
    return rows


def parse_date(raw: str | None) -> date | None:
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def resolve_trade_date(supabase: Client, requested: str | None) -> str:
    if requested:
        return datetime.strptime(requested, "%Y%m%d").date().isoformat()
    row = supabase.table("stock_daily").select("date").order("date", desc=True).limit(1).execute()
    if not row.data:
        raise RuntimeError("stock_daily에 거래일 데이터가 없습니다")
    return str(row.data[0]["date"])[:10]


def load_universe(supabase: Client, trade_date: str) -> dict[str, str]:
    membership = fetch_all(
        lambda a, b: supabase.table("universe_membership_daily")
        .select("code,market,universe_level,is_active")
        .eq("trade_date", trade_date)
        .in_("universe_level", ["core", "extended"])
        .eq("is_active", True)
        .range(a, b)
    )
    if membership:
        return {str(row["code"]): str(row.get("market") or "UNKNOWN") for row in membership}

    fallback = fetch_all(
        lambda a, b: supabase.table("stocks")
        .select("code,market")
        .in_("universe_level", ["core", "extended"])
        .eq("is_active", True)
        .range(a, b)
    )
    return {str(row["code"]): str(row.get("market") or "UNKNOWN") for row in fallback}


def build_metric(code_rows: list[dict]) -> dict[str, Any] | None:
    bars = sorted(
        [(parse_date(row.get("date")), float(row.get("close") or 0)) for row in code_rows],
        key=lambda item: item[0] or date.min,
    )
    bars = [(day, close) for day, close in bars if day and close > 0]
    if len(bars) < 2:
        return None
    current_day, current_close = bars[-1]
    previous_close = bars[-2][1]
    sample = len(bars)
    previous_20 = [close for _, close in bars[-21:-1]]
    previous_60 = [close for _, close in bars[-61:-1]]
    return {
        "trade_date": current_day.isoformat(),
        "advancer": current_close > previous_close,
        "decliner": current_close < previous_close,
        "above_sma20": bool(len(previous_20) >= 20 and current_close > sum(previous_20) / len(previous_20)),
        "above_sma60": bool(len(previous_60) >= 60 and current_close > sum(previous_60) / len(previous_60)),
        "new_high": bool(len(previous_60) >= 20 and current_close >= max(previous_60)),
        "new_low": bool(len(previous_60) >= 20 and current_close <= min(previous_60)),
        "sample": sample,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="거래일 YYYYMMDD")
    args = parser.parse_args()
    load_env()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
    supabase = create_client(url, key)
    trade_date = resolve_trade_date(supabase, args.date)
    trade_dt = datetime.strptime(trade_date, "%Y-%m-%d").date()
    universe = load_universe(supabase, trade_date)
    if not universe:
        raise RuntimeError(f"{trade_date} 유니버스가 없습니다")

    start_date = (trade_dt - timedelta(days=100)).isoformat()
    codes = list(universe.keys())
    price_rows: list[dict] = []
    for i in range(0, len(codes), 150):
        chunk = codes[i : i + 150]
        price_rows.extend(
            fetch_all(
                lambda a, b, chunk=chunk: supabase.table("stock_daily")
                .select("ticker,date,close")
                .gte("date", start_date)
                .lte("date", trade_date)
                .in_("ticker", chunk)
                .order("ticker")
                .order("date")
                .range(a, b)
            )
        )
    by_code: dict[str, list[dict]] = defaultdict(list)
    for row in price_rows:
        if str(row.get("ticker")) in universe:
            by_code[str(row["ticker"])].append(row)

    grouped: dict[str, list[dict]] = defaultdict(list)
    for code, rows in by_code.items():
        metric = build_metric(rows)
        if metric and metric["trade_date"] == trade_date:
            metric["market"] = universe[code]
            grouped[universe[code]].append(metric)

    records: list[dict] = []
    for market, metrics in grouped.items():
        if market not in {"KOSPI", "KOSDAQ"}:
            print(f"breadth 제외: 시장 식별 불가 {market} ({len(metrics)}개)")
            continue
        count = len(metrics)
        if not count:
            continue
        advancers = sum(1 for item in metrics if item["advancer"])
        decliners = sum(1 for item in metrics if item["decliner"])
        records.append(
            {
                "trade_date": trade_date,
                "market": market,
                "universe_level": "core_extended",
                "sample_count": count,
                "advancers": advancers,
                "decliners": decliners,
                "unchanged": count - advancers - decliners,
                "new_high_count": sum(1 for item in metrics if item["new_high"]),
                "new_low_count": sum(1 for item in metrics if item["new_low"]),
                "above_sma20_pct": round(sum(1 for item in metrics if item["above_sma20"]) / count * 100, 2),
                "above_sma60_pct": round(sum(1 for item in metrics if item["above_sma60"]) / count * 100, 2),
                "source": "stock_daily",
            }
        )

    if records:
        supabase.table("market_breadth_daily").upsert(records, on_conflict="trade_date,market,universe_level").execute()
    supabase.table("market_breadth_daily").delete().eq("trade_date", trade_date).eq("market", "UNKNOWN").execute()
    print(f"market breadth 저장: {trade_date} / {len(records)}개 시장 / 표본 {sum(r['sample_count'] for r in records)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
