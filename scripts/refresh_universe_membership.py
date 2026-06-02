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
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import requests
from pykrx import stock
from supabase import Client, create_client


@dataclass
class UniverseConfig:
    core_top_n: int
    extended_top_n: int
    min_price: int
    min_market_cap: int
    min_liquidity: int
    allowed_markets: set[str]
    mark_missing_inactive: bool
    missing_grace_runs: int
    min_listed_count_guard: int
    notify_always: bool


EXCLUDED_NAME_PATTERNS = [
    r"스팩",
    r"리츠",
    r"레버리지",
    r"인버스",
    r"선물",
    r"채권",
    r"ETN",
    r"ETF",
    r"우B?$",
    r"우선주",
    r"풋",
    r"콜",
    r"BLANK",
]

EXCLUDED_NAME_REGEX = [re.compile(pat, re.IGNORECASE) for pat in EXCLUDED_NAME_PATTERNS]


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


def env_csv_set(name: str, default_csv: str) -> set[str]:
    raw = str(os.environ.get(name, default_csv))
    return {item.strip().upper() for item in raw.split(",") if item.strip()}


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


def missing_tracker_path() -> Path:
    return Path(__file__).resolve().parents[1] / "logs" / "universe_missing_tracker.json"


def write_status(snapshot: dict) -> None:
    status_path, history_path = status_paths()
    status_path.parent.mkdir(parents=True, exist_ok=True)
    with status_path.open("w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    with history_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(snapshot, ensure_ascii=False) + "\n")


def load_missing_tracker() -> dict:
    path = missing_tracker_path()
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_missing_tracker(tracker: dict) -> None:
    path = missing_tracker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(tracker, f, ensure_ascii=False, indent=2)


def should_exclude_name(name: str) -> bool:
    normalized = str(name or "").strip()
    if not normalized:
        return True
    return any(regex.search(normalized) for regex in EXCLUDED_NAME_REGEX)


def send_telegram_alert(text: str) -> bool:
    token = str(os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
    chat_id = (
        str(os.environ.get("UNIVERSE_ALERT_CHAT_ID", "")).strip()
        or str(os.environ.get("AUTO_TRADE_ALERT_CHAT_ID", "")).strip()
        or str(os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "")).strip()
    )
    if not token or not chat_id:
        return False
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        return bool(resp.ok)
    except Exception:
        return False


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
            .select("code,name,market,market_cap,close,liquidity,avg_volume_20d,is_active")
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
                "거래대금": int(
                    row.get("liquidity")
                    or (int(row.get("avg_volume_20d") or 0) * int(row.get("close") or 0))
                    or 0
                ),
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


def is_eligible_candidate(name: str, market: str, close_price: int, market_cap: int, liquidity: int, cfg: UniverseConfig) -> bool:
    if should_exclude_name(name):
        return False
    if market and market.upper() not in cfg.allowed_markets:
        return False
    if close_price < cfg.min_price:
        return False
    if market_cap < cfg.min_market_cap:
        return False
    if liquidity < cfg.min_liquidity:
        return False
    return True


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
        min_market_cap=env_int("UNIVERSE_MIN_MARKET_CAP", 300_000_000_000),
        min_liquidity=env_int("UNIVERSE_MIN_LIQUIDITY", 5_000_000_000),
        allowed_markets=env_csv_set("UNIVERSE_ALLOWED_MARKETS", "KOSPI,KOSDAQ"),
        mark_missing_inactive=args.mark_missing_inactive
        or env_bool("UNIVERSE_MARK_MISSING_INACTIVE", False),
        missing_grace_runs=env_int("UNIVERSE_MISSING_GRACE_RUNS", 3),
        min_listed_count_guard=env_int("UNIVERSE_MIN_LISTED_COUNT_GUARD", 1000),
        notify_always=env_bool("UNIVERSE_ALERT_ALWAYS", False),
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
            "min_market_cap": cfg.min_market_cap,
            "min_liquidity": cfg.min_liquidity,
            "allowed_markets": sorted(cfg.allowed_markets),
            "mark_missing_inactive": cfg.mark_missing_inactive,
            "missing_grace_runs": cfg.missing_grace_runs,
            "min_listed_count_guard": cfg.min_listed_count_guard,
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
        excluded_by_rule = 0
        promoted_samples: List[str] = []
        demoted_samples: List[str] = []

        for ticker, row in frame.iterrows():
            code = str(ticker)
            prev = existing.get(code, {})
            close_price = int(row.get("종가") or 0)
            rank = int(row.get("rank") or 999999)
            mcap = int(row.get("시가총액") or 0)
            value = row.get("거래대금")
            liquidity = int(value) if pd.notnull(value) else None
            name = name_by_code.get(code, prev.get("name") or code)
            market = market_by_code.get(code) or prev.get("market")
            eligible = is_eligible_candidate(
                name=name,
                market=str(market or ""),
                close_price=close_price,
                market_cap=mcap,
                liquidity=int(liquidity or 0),
                cfg=cfg,
            )
            universe_level = build_universe_level(rank, close_price, cfg) if eligible else "tail"
            if not eligible:
                excluded_by_rule += 1

            prev_level = str(prev.get("universe_level") or "")
            prev_active = bool(prev.get("is_active")) if prev.get("is_active") is not None else False

            if universe_level == "core" and prev_level != "core":
                promoted_to_core += 1
                if len(promoted_samples) < 8:
                    promoted_samples.append(code)
            elif universe_level == "extended" and prev_level not in ("core", "extended"):
                promoted_to_extended += 1
                if len(promoted_samples) < 8:
                    promoted_samples.append(code)
            elif universe_level == "tail" and prev_level in ("core", "extended"):
                demoted_to_tail += 1
                if len(demoted_samples) < 8:
                    demoted_samples.append(code)

            if not prev_active:
                reactivated_or_new += 1

            upserts.append(
                {
                    "code": code,
                    "name": name,
                    "market": market,
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
        missing_tracker = load_missing_tracker()
        next_tracker: dict = {}
        if cfg.mark_missing_inactive:
            listed_count = len(listed_codes)
            inactivation_guard = listed_count >= cfg.min_listed_count_guard
            for code, prev in existing.items():
                was_active = bool(prev.get("is_active")) if prev.get("is_active") is not None else False
                if not was_active:
                    continue
                if code in listed_codes:
                    continue
                prev_info = missing_tracker.get(code, {}) if isinstance(missing_tracker.get(code, {}), dict) else {}
                miss_count = int(prev_info.get("missing_runs", 0)) + 1
                next_tracker[code] = {
                    "missing_runs": miss_count,
                    "last_missing_at": datetime.now().isoformat(),
                }
                if inactivation_guard and miss_count > cfg.missing_grace_runs:
                    missing_active_codes.append(code)

        upserted = len(upserts) if args.dry_run else apply_upserts(supabase, upserts)
        inactivated = len(missing_active_codes) if args.dry_run else apply_inactive_updates(supabase, missing_active_codes)
        if not args.dry_run:
            save_missing_tracker(next_tracker)

        status["status"] = "success"
        status["summary"] = {
            "listed_count": len(listed_codes),
            "upserted": upserted,
            "inactivated_missing": inactivated,
            "promoted_to_core": promoted_to_core,
            "promoted_to_extended": promoted_to_extended,
            "demoted_to_tail": demoted_to_tail,
            "reactivated_or_new": reactivated_or_new,
            "excluded_by_rule": excluded_by_rule,
            "core_count": int((frame["rank"] <= cfg.core_top_n).sum()),
            "extended_count": int(((frame["rank"] > cfg.core_top_n) & (frame["rank"] <= cfg.extended_top_n)).sum()),
            "promoted_samples": promoted_samples,
            "demoted_samples": demoted_samples,
            "inactivated_samples": missing_active_codes[:8],
        }

        changed = (promoted_to_core + promoted_to_extended + demoted_to_tail + inactivated) > 0
        if (cfg.notify_always or changed) and not args.dry_run:
            alert_lines = [
                f"[유니버스 자동화] {trading_date}",
                f"listed={len(listed_codes)} core+={promoted_to_core} ext+={promoted_to_extended} tail+={demoted_to_tail}",
                f"inactive={inactivated} excludedByRule={excluded_by_rule}",
                f"samples promoted={','.join(promoted_samples[:5]) if promoted_samples else '-'}",
                f"samples demoted={','.join(demoted_samples[:5]) if demoted_samples else '-'}",
            ]
            sent = send_telegram_alert("\n".join(alert_lines))
            status["summary"]["telegram_alert_sent"] = bool(sent)

        print("[universe-refresh] success")
        print(
            f"  listed={len(listed_codes)} upserted={upserted} inactivated_missing={inactivated} "
            f"core+={promoted_to_core} ext+={promoted_to_extended} tail+={demoted_to_tail}"
        )
        return 0
    except Exception as e:
        status["status"] = "failed"
        status["reason"] = str(e)
        send_telegram_alert(f"[유니버스 자동화 실패] {trading_date}\nreason={e}")
        print(f"[universe-refresh] failed: {e}")
        return 1
    finally:
        status["finished_at"] = datetime.now().isoformat()
        write_status(status)


if __name__ == "__main__":
    raise SystemExit(main())
