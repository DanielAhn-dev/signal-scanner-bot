"""
batch_modules/market_snapshot.py
================================
전 종목(코스피·코스닥 약 4,300개) 일별 시세 스냅샷을 Supabase Storage에 쌓는다.

유니버스(218종목) 밖 종목은 수집하지 않아 발굴 범위가 좁았다. KRX 전 종목 일괄 조회(pykrx·MDC)는
응답 변경·로그인 요구로 막혀 있어, 인증이 필요 없는 네이버 증권 모바일 목록 API(100종목/요청, 하루 약 45회)를 쓴다.
DB(무료 500MB) 대신 Storage(무료 1GB, 별도 한도)에 하루 1개 gzip CSV(약 60KB, 연 15MB)로 저장한다.
파일 날짜는 요청 시각이 아니라 응답의 마지막 체결 시각(localTradedAt) 기준이라 배치가 자정을 넘겨도 틀리지 않는다.

  bucket: market-snapshots / 경로: YYYY/YYYY-MM-DD.csv.gz
  컬럼: code,name,market,type,close,change_pct,volume,value_mil,mcap_eok,trading_status

같은 응답의 상품 유형(stockEndType)과 네이버 ETF 목록의 분류(etfTabCode)로 stocks.product_type·etf_category·
etf_tax_class도 고친다(db/migrations/036, docs/plan-etf-product-type-and-tax-2026-10-19.md).
"""

import csv
import gzip
import io
import json
import time
from collections import Counter
from datetime import datetime, timezone

import requests

BUCKET = "market-snapshots"
API = "https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100"
HEADERS = {"User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"}
COLUMNS = ["code", "name", "market", "type", "close", "change_pct", "volume", "value_mil", "mcap_eok", "trading_status"]

# 국내 ETF 전체 목록 — 한 번 요청에 전부(2026-10-19 1,176종). 서버는 src/services/etfMarketList.ts가 같은 주소를 읽는다.
ETF_LIST_API = "https://finance.naver.com/api/sise/etfItemList.nhn"
# 이보다 적으면 응답이 잘린 것으로 보고 ETF 분류를 쓰지 않는다 — 일시 오류로 기존 분류를 지우지 않게
MIN_ETF_LIST_SIZE = 500
PRODUCT_TYPES = ("stock", "etf", "etn")
# etfTabCode 1 국내 시장지수 · 2 국내 업종/테마 → 국내주식형(매매차익 비과세).
# 3 국내 파생 · 4 해외 주식 · 5 원자재 · 6 채권 · 7 기타 → 기타 ETF(매매차익 배당소득세 15.4%)
DOMESTIC_EQUITY_ETF_CATEGORIES = (1, 2)
PRODUCT_TYPE_RPC_BATCH = 500


def _num(value) -> str:
    s = str(value or "").replace(",", "").strip()
    try:
        float(s)
        return s
    except ValueError:
        return ""


def fetch_market_rows(market: str, sleep_sec: float = 0.3) -> tuple[list[dict], list[str], str]:
    rows: list[dict] = []
    traded_dates: list[str] = []
    status = ""
    page = 1
    while True:
        r = requests.get(API.format(market=market, page=page), headers=HEADERS, timeout=15)
        r.raise_for_status()
        payload = r.json()
        status = str(payload.get("marketStatus") or status)
        stocks = payload.get("stocks") or []
        for s in stocks:
            traded_at = str(s.get("localTradedAt") or "")
            if traded_at:
                traded_dates.append(traded_at[:10])
            rows.append({
                "code": s.get("itemCode", ""),
                "name": s.get("stockName", ""),
                "market": market,
                "type": s.get("stockEndType", ""),  # stock | etf | etn ...
                "close": _num(s.get("closePrice")),
                "change_pct": _num(s.get("fluctuationsRatio")),
                "volume": _num(s.get("accumulatedTradingVolume")),
                "value_mil": _num(s.get("accumulatedTradingValue")),  # 백만원
                "mcap_eok": _num(s.get("marketValue")),  # 억원
                "trading_status": ((s.get("tradeStopType") or {}).get("name") or ""),
            })
        total = int(payload.get("totalCount") or 0)
        if not stocks or page * 100 >= total:
            break
        page += 1
        time.sleep(sleep_sec)
    return rows, traded_dates, status


def build_new_listing_rows(rows: list[dict], existing_codes: set[str], now_iso: str) -> list[dict]:
    """스냅샷에는 있고 stocks에는 없는 종목(신규 상장 ETF 등)을 검색용 행으로 만든다.

    stocks를 채우는 다른 배치(KRX 상장사 목록·pykrx 종목 목록)는 ETF를 빼고 가져와서,
    시드 이후 상장한 ETF는 웹·봇 검색에 나오지 않았다. 스캔·브리핑은 core/extended + is_active만
    읽으므로 tail·비활성으로 넣으면 검색에만 보이고 매수 후보에는 섞이지 않는다.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        code = str(r.get("code") or "").strip()
        name = str(r.get("name") or "").strip()
        if not code or not name or code in existing_codes or code in seen:
            continue
        seen.add(code)
        close = r.get("close")
        out.append({
            "code": code,
            "name": name,
            "market": r.get("market") or None,
            "close": int(float(close)) if close else None,
            "is_active": False,
            "universe_level": "tail",
            "updated_at": now_iso,
        })
    return out


def _fetch_stock_codes(supabase) -> set[str] | None:
    """stocks 전체 코드. 조회 실패는 None(없음으로 취급해 전부 넣지 않도록)."""
    codes: set[str] = set()
    offset = 0
    while True:
        res = supabase.table("stocks").select("code").order("code").range(offset, offset + 999).execute()
        data = res.data or []
        codes.update(str(row.get("code") or "") for row in data)
        if len(data) < 1000:
            return codes
        offset += 1000


def register_new_listings(supabase, rows: list[dict]) -> int:
    """신규 상장 종목을 stocks에 등록한다. 기존 행은 건드리지 않는다. 실패해도 배치는 계속."""
    try:
        existing = _fetch_stock_codes(supabase)
        if not existing or len(existing) < 1000:
            print(f"   new listings skipped: stocks lookup looks incomplete ({len(existing or [])})")
            return 0
        now_iso = datetime.now(timezone.utc).isoformat()
        new_rows = build_new_listing_rows(rows, existing, now_iso)
        for i in range(0, len(new_rows), 200):
            supabase.table("stocks").upsert(new_rows[i:i + 200], on_conflict="code", ignore_duplicates=True).execute()
        if new_rows:
            sample = ", ".join(f"{r['name']}({r['code']})" for r in new_rows[:5])
            print(f"   registered {len(new_rows)} new listings → stocks: {sample}")
        return len(new_rows)
    except Exception as e:
        print(f"   new listings failed (non-fatal): {e}")
        return 0


def normalize_product_type(raw) -> str | None:
    """stockEndType → stocks.product_type. 비었으면 None(모름 — 기존 값을 덮지 않는다), 낯선 값은 other."""
    s = str(raw or "").strip().lower()
    if not s:
        return None
    return s if s in PRODUCT_TYPES else "other"


def etf_tax_class_for(category) -> str | None:
    """etfTabCode → etf_tax_class. 1~7 밖이면 None."""
    if category in DOMESTIC_EQUITY_ETF_CATEGORIES:
        return "domestic_equity"
    if isinstance(category, int) and 3 <= category <= 7:
        return "other"
    return None


def parse_etf_categories(payload) -> dict[str, int]:
    """ETF 목록 응답 → {코드: etfTabCode}. 형식이 다르면 빈 dict."""
    items = ((payload or {}).get("result") or {}).get("etfItemList") if isinstance(payload, dict) else None
    out: dict[str, int] = {}
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        code = str(item.get("itemcode") or "").strip()
        try:
            category = int(item.get("etfTabCode"))
        except (TypeError, ValueError):
            continue
        if len(code) == 6 and 1 <= category <= 7:
            out[code] = category
    return out


def fetch_etf_categories() -> dict[str, int] | None:
    """{코드: etfTabCode}. 실패하거나 목록이 너무 짧으면 None — 이날은 ETF 분류를 건드리지 않는다."""
    try:
        r = requests.get(ETF_LIST_API, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        r.raise_for_status()
        # 응답은 EUC-KR — 코드·숫자만 읽지만 JSON 파싱이 깨지지 않게 디코딩한다
        categories = parse_etf_categories(json.loads(r.content.decode("euc-kr", errors="replace")))
    except Exception as e:
        print(f"   ETF list unavailable (ETF categories skipped): {e}")
        return None
    if len(categories) < MIN_ETF_LIST_SIZE:
        print(f"   ETF list too short ({len(categories)} < {MIN_ETF_LIST_SIZE}) — ETF categories skipped")
        return None
    return categories


def build_product_type_rows(snapshot_rows: list[dict], etf_categories: dict[str, int] | None) -> tuple[list[dict], Counter]:
    """스냅샷 행 → apply_stock_product_types 입력 행.

    RPC는 세 필드를 함께 덮어쓰므로, 값을 모르는 행은 아예 빼서 기존 값을 지킨다:
      - stockEndType이 빈 행
      - ETF인데 ETF 목록을 못 받았거나(None) 목록에 그 코드가 없는 행(상장 직후 등)
    반환: (행 목록, 건너뛴 이유별 개수)
    """
    out: list[dict] = []
    skipped: Counter = Counter()
    seen: set[str] = set()
    for r in snapshot_rows:
        code = str(r.get("code") or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        product_type = normalize_product_type(r.get("type"))
        if product_type is None:
            skipped["no_type"] += 1
            continue
        category = None
        if product_type == "etf":
            if etf_categories is None:
                skipped["etf_list_unavailable"] += 1
                continue
            category = etf_categories.get(code)
            if category is None:
                skipped["etf_not_in_list"] += 1
                continue
        out.append({
            "code": code,
            "product_type": product_type,
            "etf_category": category,
            "etf_tax_class": etf_tax_class_for(category),
        })
    return out, skipped


def _fetch_current_product_types(supabase) -> dict[str, tuple] | None:
    """stocks의 현재 (product_type, etf_category, etf_tax_class). 조회 실패는 None."""
    current: dict[str, tuple] = {}
    offset = 0
    try:
        while True:
            res = supabase.table("stocks").select("code, product_type, etf_category, etf_tax_class") \
                .order("code").range(offset, offset + 999).execute()
            data = res.data or []
            for row in data:
                current[str(row.get("code") or "")] = (row.get("product_type"), row.get("etf_category"), row.get("etf_tax_class"))
            if len(data) < 1000:
                return current
            offset += 1000
    except Exception as e:
        print(f"   current product types lookup failed: {e}")
        return None


def diff_product_types(rows: list[dict], current: dict[str, tuple]) -> list[dict]:
    """stocks에 있고 값이 달라질 행만 (RPC의 is distinct from 조건과 같다)."""
    return [
        r for r in rows
        if r["code"] in current
        and current[r["code"]] != (r["product_type"], r["etf_category"], r["etf_tax_class"])
    ]


def sync_product_types(supabase, snapshot_rows: list[dict], dry_run: bool = False) -> int:
    """stocks.product_type·etf_category·etf_tax_class를 스냅샷·ETF 목록에 맞춘다. 실패해도 배치는 계속.

    반환: 바뀐(dry_run이면 바뀔) 행 수. 실패는 -1.
    """
    try:
        rows, skipped = build_product_type_rows(snapshot_rows, fetch_etf_categories())
        kinds = Counter(r["product_type"] for r in rows)
        tax = Counter(r["etf_tax_class"] for r in rows if r["etf_tax_class"])
        print(f"   product types: {dict(kinds)} · ETF tax {dict(tax)} · skipped {dict(skipped) or 0}")
        if dry_run:
            current = _fetch_current_product_types(supabase)
            if current is None:
                return -1
            changes = diff_product_types(rows, current)
            print(f"   [dry-run] would change {len(changes)} rows")
            for r in changes[:20]:
                print(f"     {r['code']}: {current[r['code']]} → ({r['product_type']}, {r['etf_category']}, {r['etf_tax_class']})")
            return len(changes)
        changed = 0
        for i in range(0, len(rows), PRODUCT_TYPE_RPC_BATCH):
            res = supabase.rpc("apply_stock_product_types", {"p_rows": rows[i:i + PRODUCT_TYPE_RPC_BATCH]}).execute()
            changed += int(res.data or 0)
        print(f"   product types updated: {changed} rows changed")
        return changed
    except Exception as e:
        print(f"   product types failed (non-fatal): {e}")
        return -1


def collect_market_snapshot(supabase) -> bool:
    """전 종목 스냅샷을 수집해 Storage에 올린다. 장중(마감 전)이면 저장하지 않는다."""
    print("\n[8/8] Collecting full-market snapshot (Naver)...")
    try:
        all_rows: list[dict] = []
        dates: list[str] = []
        for market in ("KOSPI", "KOSDAQ"):
            rows, traded, status = fetch_market_rows(market)
            if status.upper() == "OPEN":
                print(f"   snapshot skipped: {market} market is open (종가 확정 후 저장)")
                return False
            all_rows.extend(rows)
            dates.extend(traded)
        if len(all_rows) < 1000 or not dates:
            print(f"   snapshot skipped: too few rows ({len(all_rows)})")
            return False
        snap_date = Counter(dates).most_common(1)[0][0]

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(all_rows)
        payload = gzip.compress(buf.getvalue().encode("utf-8"))

        storage = supabase.storage
        try:
            storage.create_bucket(BUCKET, options={"public": False})
        except Exception:
            pass  # 이미 있음
        path = f"{snap_date[:4]}/{snap_date}.csv.gz"
        storage.from_(BUCKET).upload(path, payload, {"content-type": "application/gzip", "upsert": "true"})
        print(f"   stored {len(all_rows)} rows → {BUCKET}/{path} ({len(payload) / 1024:.0f}KB)")
        register_new_listings(supabase, all_rows)
        # 신규 상장 등록 뒤에 돌려야 새 ETF도 같은 날 분류된다
        sync_product_types(supabase, all_rows)
        return True
    except Exception as e:
        print(f"   snapshot failed (non-fatal): {e}")
        return False
