import os
import time
from datetime import datetime

from pykrx import stock
from supabase import create_client


# 환경 변수 및 Supabase 설정
def load_env_file(filepath: str = ".env") -> None:
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    if key not in os.environ:
                        os.environ[key] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


load_env_file()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("❌ 에러: Supabase 환경변수가 설정되지 않았습니다.")
    raise SystemExit(1)

supabase = create_client(url, key)


def fetch_all_stocks() -> dict[str, str]:
    """stocks 테이블의 기존 종목 코드/이름 맵을 가져온다."""
    all_data = []
    page = 0
    page_size = 1000
    print("📥 기존 종목 정보 로딩 시작...")

    while True:
        start = page * page_size
        end = start + page_size - 1
        try:
            res = supabase.table("stocks").select("code, name").range(start, end).execute()
            data = res.data
            if not data:
                break
            all_data.extend(data)
            if len(data) < page_size:
                break
            page += 1
            time.sleep(0.1)
        except Exception as e:
            print(f"⚠️ 종목 로딩 중 에러: {e}")
            break

    return {item["code"]: item["name"] for item in all_data}


def map_sectors() -> None:
    print("🔄 종목별 섹터 매핑 시작...")
    today = datetime.now().strftime("%Y%m%d")

    name_map = fetch_all_stocks()
    markets = ["KOSPI", "KOSDAQ"]

    stock_updates: list[dict] = []
    sector_inserts: dict[str, str] = {}

    # 너무 광범위한 지수/테마/파생 스타일은 제외
    SKIP_KEYWORDS = [
        "레버리지", "인버스", "선물", "옵션",
        "배당", "ESG", "우량", "밸류", "모멘텀", "LowVol",
        "종합지수",
        "K-", "아시아", "글로벌", "달러", "엔",
    ]
    SKIP_EXACT = {
        "코스피 200", "코스피 100", "코스피 50",
        "코스닥 150", "KRX 300",
    }

    print("📊 KRX 섹터 정보 수집 중...")
    for market in markets:
        sectors = stock.get_index_ticker_list(today, market=market)
        print(f"   👉 {market}: 총 {len(sectors)}개 섹터 스캔 중...")

        for i, sector_code in enumerate(sectors):
            sector_name = stock.get_index_ticker_name(sector_code)
            name = sector_name.strip()

            # 대표지수/스타일 지수 제외, WICS 업종·업종지수는 통과
            if name in SKIP_EXACT or any(k in name for k in SKIP_KEYWORDS):
                continue

            sector_id = f"KRX:{name}"
            sector_inserts[sector_id] = name

            tickers = stock.get_index_portfolio_deposit_file(sector_code)

            if i % 20 == 0:
                print(f"      [{i}/{len(sectors)}] {name} ({len(tickers)}종목)...")

            for ticker in tickers:
                stock_name = name_map.get(ticker)
                if not stock_name:
                    try:
                        stock_name = stock.get_market_ticker_name(ticker)
                        if stock_name:
                            name_map[ticker] = stock_name
                        time.sleep(0.05)
                    except Exception:
                        stock_name = ticker

                if stock_name:
                    stock_updates.append(
                        {
                            "code": ticker,
                            "name": stock_name,
                            "sector_id": sector_id,
                        }
                    )

    print(f"\n🏗️ 총 {len(sector_inserts)}개 유효 섹터 정보 동기화 중...")
    sector_batch_data = [
        {"id": sid, "name": sname, "updated_at": datetime.now().isoformat()}
        for sid, sname in sector_inserts.items()
    ]

    sector_batch_size = 100
    for i in range(0, len(sector_batch_data), sector_batch_size):
        batch = sector_batch_data[i : i + sector_batch_size]
        try:
            supabase.table("sectors").upsert(batch).execute()
        except Exception as e:
            print(f"⚠️ 섹터 등록 에러: {e}")

    unique_updates_map = {item["code"]: item for item in stock_updates}
    final_updates = list(unique_updates_map.values())

    print(f"🚀 총 {len(final_updates)}개 종목 섹터 정보 업데이트 시작...")

    stock_batch_size = 100
    total_batches = (len(final_updates) + stock_batch_size - 1) // stock_batch_size

    for i in range(0, len(final_updates), stock_batch_size):
        batch = final_updates[i : i + stock_batch_size]
        try:
            supabase.table("stocks").upsert(batch).execute()
            current_batch = (i // stock_batch_size) + 1
            print(f"   💾 업로드 중... ({current_batch}/{total_batches})", end="\r")
        except Exception as e:
            print(f"\n⚠️ 종목 업데이트 에러: {e}")

    print("\n✅ 섹터 매핑 및 종목 업데이트 완료.")


if __name__ == "__main__":
    map_sectors()
