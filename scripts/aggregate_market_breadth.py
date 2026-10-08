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


UPSERT_CHUNK = 500


def backfill(supabase: Client, end_date: str, days: int, dry_run: bool) -> int:
    """최근 days 거래일의 시장 폭을 한 번의 가격 조회로 계산해 저장한다(upsert라 다시 돌려도 안전).

    한계: 유니버스는 end_date 기준 구성 종목으로 고정한다(과거 구성 변경·상장폐지는 반영 안 됨 → 생존 편향).
    일일 집계(날짜 하나)는 그날 구성 종목을 쓰므로 둘의 표본 수가 조금 다를 수 있다.
    """
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    universe = load_universe(supabase, end_date)
    if not universe:
        raise RuntimeError(f"{end_date} 유니버스가 없습니다")
    # 60일 평균에 직전 60거래일이 필요하다. 달력일로 days*1.5 + 100일을 읽는다
    start_date = (end_dt - timedelta(days=int(days * 1.5) + 100)).isoformat()
    codes = list(universe.keys())
    by_code: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for i in range(0, len(codes), 150):
        chunk = codes[i : i + 150]
        rows = fetch_all(
            lambda a, b, chunk=chunk: supabase.table("stock_daily")
            .select("ticker,date,close")
            .gte("date", start_date)
            .lte("date", end_date)
            .in_("ticker", chunk)
            .order("ticker")
            .order("date")
            .range(a, b)
        )
        for row in rows:
            day = parse_date(row.get("date"))
            close = float(row.get("close") or 0)
            if day and close > 0:
                by_code[str(row["ticker"])].append((day, close))
        print(f"가격 조회 {min(i + 150, len(codes))}/{len(codes)}종목")

    # 거래일 = 가장 많은 종목이 가진 날의 절반 이상이 종가를 가진 날(일부 종목만 있는 날 제외)
    per_day: dict[date, int] = defaultdict(int)
    for bars in by_code.values():
        for day, _ in bars:
            per_day[day] += 1
    if not per_day:
        raise RuntimeError("조회된 가격이 없습니다")
    threshold = max(per_day.values()) * 0.5
    trade_days = sorted(d for d, n in per_day.items() if n >= threshold)[-days:]
    target = set(trade_days)

    stats: dict[tuple[date, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for code, bars in by_code.items():
        market = universe.get(code)
        if market not in {"KOSPI", "KOSDAQ"}:
            continue
        bars.sort(key=lambda b: b[0])
        closes = [c for _, c in bars]
        for k in range(1, len(bars)):
            day, close = bars[k]
            if day not in target:
                continue
            prev20 = closes[max(0, k - 20) : k]
            prev60 = closes[max(0, k - 60) : k]
            s = stats[(day, market)]
            s["count"] += 1
            s["adv"] += close > closes[k - 1]
            s["dec"] += close < closes[k - 1]
            s["sma20"] += len(prev20) >= 20 and close > sum(prev20) / len(prev20)
            s["sma60"] += len(prev60) >= 60 and close > sum(prev60) / len(prev60)
            s["high"] += len(prev60) >= 20 and close >= max(prev60)
            s["low"] += len(prev60) >= 20 and close <= min(prev60)

    records = []
    for (day, market), s in sorted(stats.items()):
        count = s["count"]
        records.append(
            {
                "trade_date": day.isoformat(),
                "market": market,
                "universe_level": "core_extended",
                "sample_count": count,
                "advancers": s["adv"],
                "decliners": s["dec"],
                "unchanged": count - s["adv"] - s["dec"],
                "new_high_count": s["high"],
                "new_low_count": s["low"],
                "above_sma20_pct": round(s["sma20"] / count * 100, 2),
                "above_sma60_pct": round(s["sma60"] / count * 100, 2),
                "source": "stock_daily_backfill",
            }
        )
    kospi = [r for r in records if r["market"] == "KOSPI"]
    print(
        f"백필 대상 {len(trade_days)}거래일({trade_days[0]}~{trade_days[-1]}) / {len(records)}행 "
        f"(KOSPI {len(kospi)}행, 종목 수 {kospi[0]['sample_count'] if kospi else 0}~{kospi[-1]['sample_count'] if kospi else 0})"
    )
    if dry_run:
        print("dry-run: 저장하지 않았습니다")
        return 0
    for i in range(0, len(records), UPSERT_CHUNK):
        supabase.table("market_breadth_daily").upsert(
            records[i : i + UPSERT_CHUNK], on_conflict="trade_date,market,universe_level"
        ).execute()
        print(f"저장 {min(i + UPSERT_CHUNK, len(records))}/{len(records)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="거래일 YYYYMMDD")
    parser.add_argument("--backfill-days", type=int, help="기준일까지 최근 N거래일을 한 번에 계산해 저장(과거 채우기)")
    parser.add_argument("--dry-run", action="store_true", help="백필 시 저장하지 않고 개수만 출력")
    args = parser.parse_args()
    load_env()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
    supabase = create_client(url, key)
    trade_date = resolve_trade_date(supabase, args.date)
    if args.backfill_days:
        return backfill(supabase, trade_date, args.backfill_days, args.dry_run)
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
