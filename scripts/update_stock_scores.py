# === scripts/update_stock_scores.py ===
import os
from supabase import create_client
from datetime import datetime, date

def load_env_file(filepath=".env"):
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
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(url, key)

def calculate_stock_scores():
    print("🔄 개별 종목 스코어 업데이트 시작...")
    asof = date.today().isoformat()  # YYYY-MM-DD

    # 1. Core/Extended 종목만 가져오기
    print("📥 종목 데이터 로딩 중...")
    res = supabase.table("stocks") \
        .select("code, universe_level") \
        .in_("universe_level", ["core", "extended"]) \
        .execute()
    stocks = res.data or []

    if not stocks:
        print("⚠️ 업데이트할 종목이 없습니다.")
        return

    print(f"🚀 {len(stocks)}개 우량주 점수 계산 중...")

    upserts = []
    for s in stocks:
        code = s.get("code")
        if not code:
            continue

        base = 50
        if s["universe_level"] == "core":
            base += 20
        elif s["universe_level"] == "extended":
            base += 10

        value_score = base
        momentum_score = base
        liquidity_score = base   # 임시
        total_score = base

        upserts.append({
            "code": code,
            "asof": asof,
            "score": float(total_score),   # numeric NOT NULL
            "factors": {},                # jsonb NOT NULL
            "value_score": int(value_score),
            "momentum_score": int(momentum_score),
            "liquidity_score": int(liquidity_score),
            "total_score": int(total_score),
        })

    # 2. scores 테이블 upsert
    if not upserts:
        print("⚠️ upsert 할 데이터가 없습니다.")
        return

    batch_size = 100
    for i in range(0, len(upserts), batch_size):
        batch = upserts[i:i+batch_size]
        try:
            supabase.table("scores").upsert(batch).execute()
            print(f"   ✅ 배치 {i//batch_size + 1} 완료 ({len(batch)}개)")
        except Exception as e:
            print(f"⚠️ 점수 저장 실패: {e}")

    print("✅ 개별 종목 스코어 업데이트 완료.")

if __name__ == "__main__":
    calculate_stock_scores()
