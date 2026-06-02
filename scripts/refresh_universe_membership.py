#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Refresh stocks universe membership (core/extended/tail) and active flags.

Rules (defaults):
- listed + active => is_active=true
- rank <= 200 and close >= 1000 => core
- rank <= 500 and close >= 1000 => extended
- otherwise => tail

Artifacts:
- logs/universe_membership_status.json
- logs/universe_membership_history.ndjson
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
from pykrx import stock
from supabase import Client, create_client


@dataclass
class UniverseConfig:
    core_top_n: int
    extended_top_n: int
    min_price: int
    mark_missing_inactive: bool


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    val = str(raw).strip().lower()
    if val in ("1", "true", "yes", "y", "on"):
        return True
    if val in ("0", "false", "no", "n", "off"):
        return False
    return default


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        value = int(str(raw)) if raw is not None else default
        return value if value > 0 else default
    except Exception:
        return default


def load_env_file(filepath: str = ".env") -> None:
    try:
        with open(filepath, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key not in os.environ:
                    os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


def resolve_trading_date(explicit: Optional[str]) -> str:
    if explicit and len(explicit) == 8 and explicit.isdigit():
        return explicit

    today = datetime.now().date()
    for i in range(0, 10):
        d = today - timedelta(days=i)
        d_str = d.strftime("%Y%m%d")
        try:
            kospi = stock.get_market_ticker_list(d_str, market="KOSPI")
            kosdaq = stock.get_market_ticker_list(d_str, market="KOSDAQ")
            if kospi or kosdaq:
                return d_str
        except Exception:
            continue
    return today.strftime("%Y%m%d")


def status_paths() -> Tuple[Path, Path]:
    base = Path(__file__).resolve().parents[1] / "logs"
    return base / "universe_membership_status.json", base / "universe_membership_history.ndjson"


def write_status(snapshot: dict) -> None:
    status_path, history_path = status_paths()
    status_path.parent.mkdir(parents=True, exist_ok=True)
    with status_path.open("w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    with history_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(snapshot, ensure_ascii=False) + "\n")


def load_market_frames(trading_date: str) -> Tuple[pd.DataFrame, Dict[str, str], Dict[str, str]]:
    market_tickers = {
        "KOSPI": stock.get_market_ticker_list(trading_date, market="KOSPI"),
        "KOSDAQ": stock.get_market_ticker_list(trading_date, market="KOSDAQ"),
    }

    name_by_code: Dict[str, str] = {}
    market_by_code: Dict[str, str] = {}
    for market, tickers in market_tickers.items():
        for code in tickers:
            market_by_code[code] = market
            try:
                name_by_code[code] = stock.get_market_ticker_name(code)
            except Exception:
                name_by_code[code] = code

    cap_frames: List[pd.DataFrame] = []
    for market in ("KOSPI", "KOSDAQ"):
        df = stock.get_market_cap(trading_date, market=market)
        if df is None or df.empty:
            continue
        df = df.copy()
        df["market"] = market
        cap_frames.append(df)

    if not cap_frames:
        return pd.DataFrame(), name_by_code, market_by_code

    total = pd.concat(cap_frames)
    total = total.sort_values(by="시가총액", ascending=False)
    total["rank"] = range(1, len(total) + 1)
    return total, name_by_code, market_by_code


def load_market_frame_from_db(supabase: Client) -> Tuple[pd.DataFrame, Dict[str, str], Dict[str, str]]:
    rows: List[dict] = []
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("stocks")
            .select("code,name,market,market_cap,close,liquidity,is_active")
            .eq("is_active", True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        data = res.data or []
        if not data:
            break
        rows.extend(data)
        if len(data) < page_size:
            break
        offset += page_size

    if not rows:
        return pd.DataFrame(), {}, {}

    normalized: List[dict] = []
    name_by_code: Dict[str, str] = {}
    market_by_code: Dict[str, str] = {}
    for row in rows:
        code = str(row.get("code") or "").strip()
        if not code:
            continue
        name_by_code[code] = str(row.get("name") or code)
        market_by_code[code] = str(row.get("market") or "")
        normalized.append(
            {
                "code": code,
                "종가": int(row.get("close") or 0),
                "시가총액": int(row.get("market_cap") or 0),
                "거래대금": int(row.get("liquidity") or 0),
                "market": str(row.get("market") or ""),
            }
        )

    frame = pd.DataFrame(normalized)
    if frame.empty:
        return pd.DataFrame(), {}, {}

    frame = frame.sort_values(by="시가총액", ascending=False)
    frame["rank"] = range(1, len(frame) + 1)
    frame = frame.set_index("code")
    return frame, name_by_code, market_by_code


def build_universe_level(rank: int, close_price: int, cfg: UniverseConfig) -> str:
    if close_price >= cfg.min_price:
        if rank <= cfg.core_top_n:
            return "core"
        if rank <= cfg.extended_top_n:
            return "extended"
    return "tail"


def fetch_existing_map(supabase: Client) -> Dict[str, dict]:
    existing: Dict[str, dict] = {}
    page_size = 1000
    offset = 0
    while True:
        res = (
            supabase.table("stocks")
            .select("code,name,is_active,universe_level,mcap_rank,market")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for row in rows:
            code = str(row.get("code") or "").strip()
            if code:
                existing[code] = row
        if len(rows) < page_size:
            break
        offset += page_size
    return existing


def apply_upserts(supabase: Client, rows: List[dict]) -> int:
    if not rows:
        return 0
    upserted = 0
    for i in range(0, len(rows), 300):
        batch = rows[i : i + 300]
        try:
            supabase.table("stocks").upsert(batch).execute()
            upserted += len(batch)
        except Exception:
            for j in range(0, len(batch), 50):
                chunk = batch[j : j + 50]
                try:
                    supabase.table("stocks").upsert(chunk).execute()
                    upserted += len(chunk)
                except Exception:
                    pass
    return upserted


def apply_inactive_updates(supabase: Client, codes: List[str]) -> int:
    if not codes:
        return 0
    updated = 0
    for i in range(0, len(codes), 200):
        chunk = codes[i : i + 200]
        try:
            supabase.table("stocks").update(
                {
                    "is_active": False,
                    "universe_level": "tail",
                    "updated_at": datetime.now().isoformat(),
                }
            ).in_("code", chunk).execute()
            updated += len(chunk)
        except Exception:
            pass
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh stocks universe membership")
    parser.add_argument("--date", type=str, help="Trading date YYYYMMDD")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--mark-missing-inactive", action="store_true")
    args = parser.parse_args()

    load_env_file()

    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not supabase_key:
        print("[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing")
        return 1

    cfg = UniverseConfig(
        core_top_n=env_int("UNIVERSE_CORE_TOP_N", 200),
        extended_top_n=env_int("UNIVERSE_EXTENDED_TOP_N", 500),
        min_price=env_int("UNIVERSE_MIN_PRICE", 1000),
        mark_missing_inactive=args.mark_missing_inactive
        or env_bool("UNIVERSE_MARK_MISSING_INACTIVE", False),
    )

    run_id = f"universe-refresh-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    trading_date = resolve_trading_date(args.date)

    status = {
        "run_id": run_id,
        "started_at": datetime.now().isoformat(),
        "finished_at": None,
        "status": "running",
        "reason": "",
        "trading_date": trading_date,
        "dry_run": bool(args.dry_run),
        "config": {
            "core_top_n": cfg.core_top_n,
            "extended_top_n": cfg.extended_top_n,
            "min_price": cfg.min_price,
            "mark_missing_inactive": cfg.mark_missing_inactive,
        },
        "summary": {},
    }

    try:
        supabase = create_client(supabase_url, supabase_key)
        try:
            frame, name_by_code, market_by_code = load_market_frames(trading_date)
        except Exception as e:
            print(f"[WARN] pykrx market-cap fetch failed, fallback to DB source: {e}")
            frame, name_by_code, market_by_code = load_market_frame_from_db(supabase)

        if frame.empty:
            status["status"] = "failed"
            status["reason"] = "empty_market_frame"
            return 1

        existing = fetch_existing_map(supabase)
        listed_codes = set(frame.index.astype(str).tolist())

        upserts: List[dict] = []
        promoted_to_core = 0
        promoted_to_extended = 0
        demoted_to_tail = 0
        reactivated_or_new = 0

        for ticker, row in frame.iterrows():
            code = str(ticker)
            close_price = int(row.get("종가") or 0)
            rank = int(row.get("rank") or 999999)
            mcap = int(row.get("시가총액") or 0)
            value = row.get("거래대금")
            liquidity = int(value) if pd.notnull(value) else None
            universe_level = build_universe_level(rank, close_price, cfg)

            prev = existing.get(code, {})
            prev_level = str(prev.get("universe_level") or "")
            prev_active = bool(prev.get("is_active")) if prev.get("is_active") is not None else False

            if universe_level == "core" and prev_level != "core":
                promoted_to_core += 1
            elif universe_level == "extended" and prev_level not in ("core", "extended"):
                promoted_to_extended += 1
            elif universe_level == "tail" and prev_level in ("core", "extended"):
                demoted_to_tail += 1

            if not prev_active:
                reactivated_or_new += 1

            upserts.append(
                {
                    "code": code,
                    "name": name_by_code.get(code, prev.get("name") or code),
                    "market": market_by_code.get(code) or prev.get("market"),
                    "market_cap": mcap,
                    "mcap_rank": rank,
                    "close": close_price,
                    "liquidity": liquidity,
                    "universe_level": universe_level,
                    "is_active": True,
                    "updated_at": datetime.now().isoformat(),
                }
            )

        missing_active_codes: List[str] = []
        if cfg.mark_missing_inactive:
            for code, prev in existing.items():
                was_active = bool(prev.get("is_active")) if prev.get("is_active") is not None else False
                if was_active and code not in listed_codes:
                    missing_active_codes.append(code)

        upserted = len(upserts) if args.dry_run else apply_upserts(supabase, upserts)
        inactivated = len(missing_active_codes) if args.dry_run else apply_inactive_updates(supabase, missing_active_codes)

        status["status"] = "success"
        status["summary"] = {
            "listed_count": len(listed_codes),
            "upserted": upserted,
            "inactivated_missing": inactivated,
            "promoted_to_core": promoted_to_core,
            "promoted_to_extended": promoted_to_extended,
            "demoted_to_tail": demoted_to_tail,
            "reactivated_or_new": reactivated_or_new,
            "core_count": int((frame["rank"] <= cfg.core_top_n).sum()),
            "extended_count": int(((frame["rank"] > cfg.core_top_n) & (frame["rank"] <= cfg.extended_top_n)).sum()),
        }

        print("[universe-refresh] success")
        print(
            f"  listed={len(listed_codes)} upserted={upserted} inactivated_missing={inactivated} "
            f"core+={promoted_to_core} ext+={promoted_to_extended} tail+={demoted_to_tail}"
        )
        return 0
    except Exception as e:
        status["status"] = "failed"
        status["reason"] = str(e)
        print(f"[universe-refresh] failed: {e}")
        return 1
    finally:
        status["finished_at"] = datetime.now().isoformat()
        write_status(status)


if __name__ == "__main__":
    raise SystemExit(main())
