"""
Generate per-symbol upload CSV using KRX short-trade API (via srtLoader route).

Output columns:
  code,date,shortRatio,creditRatio

shortRatio = (short_trade_volume / total_trade_volume) * 100
creditRatio is left blank (no stable free API source confirmed yet).

Usage:
  python scripts/generate_credit_short_from_krx_srt.py --date 2026-05-12
  python scripts/generate_credit_short_from_krx_srt.py --date 20260512 --limit 50
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime
from io import StringIO
from typing import Any

import requests
import pandas as pd
from supabase import Client, create_client


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate upload CSV from KRX short trade API")
    p.add_argument("--date", required=True, help="Target date (YYYY-MM-DD or YYYYMMDD)")
    p.add_argument("--output", default="", help="Output file path")
    p.add_argument(
        "--scope",
        choices=["universe", "all-krx"],
        default="universe",
        help="Symbol scope: universe(core+extended active stocks) or all-krx(data/all_krx.json)",
    )
    p.add_argument("--limit", type=int, default=0, help="Optional symbol limit")
    p.add_argument("--offset", type=int, default=0, help="Optional symbol offset for chunk runs")
    p.add_argument("--sleep", type=float, default=0.15, help="Sleep seconds between requests")
    p.add_argument(
        "--keep-empty",
        action="store_true",
        help="Keep rows even when both shortRatio and creditRatio are empty",
    )
    return p.parse_args()


def normalize_date(raw: str) -> str:
    v = raw.strip()
    if len(v) == 8 and v.isdigit():
        return f"{v[:4]}-{v[4:6]}-{v[6:8]}"
    try:
        return datetime.strptime(v, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as e:
        raise ValueError("--date must be YYYY-MM-DD or YYYYMMDD") from e


def to_yyyymmdd(iso_date: str) -> str:
    return iso_date.replace("-", "")


def load_env_file(path: str = ".env") -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except FileNotFoundError:
        pass


def get_supabase() -> Client:
    load_env_file()
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required")
    return create_client(url, key)


def fetch_active_codes(supabase: Client, limit: int) -> list[str]:
    q = (
        supabase.table("stocks")
        .select("code")
        .eq("is_active", True)
        .in_("universe_level", ["core", "extended"])
        .order("code")
    )
    if limit > 0:
        q = q.limit(limit)
    rows = q.execute().data or []
    out: list[str] = []
    for r in rows:
        code = str(r.get("code") or "").strip()
        if len(code) == 6 and code.isdigit():
            out.append(code)
    return out


def fetch_all_krx_codes(limit: int) -> list[str]:
    path = os.path.join("data", "all_krx.json")
    with open(path, "r", encoding="utf-8") as f:
        items = json.load(f)
    out: list[str] = []
    for item in items:
        code = str((item or {}).get("code") or "").strip()
        if len(code) == 6 and code.isdigit():
            out.append(code)
    # de-duplicate while preserving order
    out = list(dict.fromkeys(out))
    if limit > 0:
        out = out[:limit]
    return out


def fetch_total_volume_naver(code6: str, iso_date: str) -> int:
    target = iso_date.replace("-", ".")
    url = f"https://finance.naver.com/item/sise_day.naver?code={code6}&page=1"
    try:
        html = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).text
        tables = pd.read_html(StringIO(html))
    except Exception:
        return 0
    if not tables:
        return 0
    df = tables[0]
    if "날짜" not in df.columns or "거래량" not in df.columns:
        return 0
    df = df.dropna(subset=["날짜", "거래량"])
    if df.empty:
        return 0
    row = df[df["날짜"].astype(str) == target]
    if row.empty:
        return 0
    try:
        return int(float(row.iloc[0]["거래량"]))
    except Exception:
        return 0


def resolve_isu_code(session: requests.Session, code6: str) -> str:
    url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd?bld=dbms/comm/finder/get_srtisu"
    try:
        r = session.post(url, data={"isuCd": code6, "locale": "ko_KR"}, timeout=20)
        if not r.ok:
            return ""
        data = r.json()
        out = data.get("output") or []
        if not out:
            return ""
        return str(out[0].get("code") or "")
    except Exception:
        return ""


def to_int(v: Any) -> int:
    s = str(v or "").replace(",", "").strip()
    if not s or s == "-":
        return 0
    try:
        return int(float(s))
    except Exception:
        return 0


def fetch_short_trade_volume(session: requests.Session, isu_code: str, yyyymmdd: str) -> int:
    url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
    form = {
        "bld": "dbms/MDC_OUT/STAT/srt/MDCSTAT30001_OUT",
        "isuCd": isu_code,
        "strtDd": yyyymmdd,
        "endDd": yyyymmdd,
        "locale": "ko_KR",
        "share": "1",
        "money": "1",
        "csvxls_isNo": "false",
    }
    try:
        r = session.post(url, data=form, timeout=20)
        if not r.ok:
            return 0
        data = r.json()
    except Exception:
        return 0
    rows = data.get("OutBlock_1") or []
    if not rows:
        return 0
    # same-day row first; fallback to first row
    row = None
    for item in rows:
        trd = str(item.get("TRD_DD", "")).replace("/", "")
        if trd == yyyymmdd:
            row = item
            break
    if row is None:
        row = rows[0]
    return to_int(row.get("CVSRTSELL_TRDVOL"))


def main() -> int:
    args = parse_args()
    try:
        iso_date = normalize_date(args.date)
    except ValueError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1

    yyyymmdd = to_yyyymmdd(iso_date)
    output = args.output or f"tmp/credit_short_upload_{iso_date}_from_krx.csv"
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    try:
        if args.scope == "all-krx":
            codes = fetch_all_krx_codes(0)
        else:
            supabase = get_supabase()
            codes = fetch_active_codes(supabase, 0)
    except Exception as e:
        print(f"[ERROR] failed to load symbols: {e}", file=sys.stderr)
        return 1

    if args.offset > 0:
        codes = codes[args.offset :]
    if args.limit > 0:
        codes = codes[: args.limit]

    if not codes:
        print("[ERROR] no active symbols", file=sys.stderr)
        return 1

    loader = "https://data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT300&isuCd=005930"
    referer = loader
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
            "Origin": "https://data.krx.co.kr",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        }
    )

    # warm-up
    try:
        session.get(loader, timeout=20)
    except Exception:
        pass

    ok_ratio = 0
    skipped_empty = 0
    isu_cache: dict[str, str] = {}
    with open(output, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "date", "shortRatio", "creditRatio"])
        for i, code in enumerate(codes, start=1):
            isu_code = isu_cache.get(code)
            if isu_code is None:
                isu_code = resolve_isu_code(session, code)
                isu_cache[code] = isu_code

            short_vol = fetch_short_trade_volume(session, isu_code, yyyymmdd) if isu_code else 0
            total_vol = fetch_total_volume_naver(code, iso_date)
            ratio = None
            if short_vol > 0 and total_vol > 0:
                ratio = round((short_vol / total_vol) * 100, 4)
                ok_ratio += 1

            if ratio is None and not args.keep_empty:
                skipped_empty += 1
            else:
                w.writerow([
                    code,
                    iso_date,
                    "" if ratio is None else ratio,
                    "",  # creditRatio unavailable in stable free source
                ])

            if i % 50 == 0:
                print(f"[INFO] progress {i}/{len(codes)} ratio={ok_ratio}")
                f.flush()
            if args.sleep > 0:
                time.sleep(args.sleep)

    print(f"[OK] Generated: {output}")
    print(f"[OK] scope: {args.scope}")
    print(f"[OK] offset: {args.offset}")
    print(f"[OK] Symbols: {len(codes)}")
    print(f"[OK] shortRatio filled: {ok_ratio}")
    print(f"[OK] skipped empty rows: {skipped_empty}")
    print("[INFO] creditRatio left blank (source not confirmed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
