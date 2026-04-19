import os
from datetime import date
from supabase import create_client


def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
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


def clamp_int(value, default=0):
    try:
        n = int(round(float(value)))
    except Exception:
        n = default
    return max(0, min(100, n))


def clamp_float(value, default=0.0):
    try:
        n = float(value)
    except Exception:
        n = default
    return max(0.0, min(100.0, n))


def derive_signal(total_score):
    score = clamp_int(total_score, 0)
    if score >= 85:
        return "STRONG_BUY"
    if score >= 70:
        return "BUY"
    if score >= 55:
        return "WATCH"
    if score <= 20:
        return "SELL"
    return "HOLD"


def normalize_existing_scores(asof=None):
    print("🔄 score 동기화(정합성 보정) 시작...")

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    supabase = create_client(url, key)

    if not asof:
        latest = supabase.table("scores").select("asof").order("asof", desc=True).limit(1).execute()
        asof = (latest.data or [{}])[0].get("asof") if latest.data else None

    if not asof:
        asof = date.today().isoformat()

    print(f"📅 기준 asof: {asof}")

    rows_res = (
        supabase.table("scores")
        .select("code, asof, total_score, momentum_score, liquidity_score, value_score, score, factors")
        .eq("asof", asof)
        .limit(20000)
        .execute()
    )

    rows = rows_res.data or []
    if not rows:
        print("⚠️ 해당 asof 점수 데이터가 없습니다.")
        print("   엔진 기반 동기화를 먼저 실행하세요: pnpm run sync:scores")
        return

    upserts = []
    for row in rows:
        code = row.get("code")
        if not code:
            continue

        total = clamp_int(row.get("total_score"), 0)
        momentum = clamp_int(row.get("momentum_score"), total)
        liquidity = clamp_int(row.get("liquidity_score"), 50)
        value = clamp_int(row.get("value_score"), 50)
        score = clamp_float(row.get("score"), float(total))
        factors = row.get("factors") if isinstance(row.get("factors"), dict) else {}

        upserts.append(
            {
                "code": code,
                "asof": asof,
                "total_score": total,
                "signal": derive_signal(total),
                "momentum_score": momentum,
                "liquidity_score": liquidity,
                "value_score": value,
                "score": score,
                "factors": factors,
            }
        )

    if not upserts:
        print("⚠️ 보정 대상 데이터가 없습니다.")
        return

    batch_size = 200
    for i in range(0, len(upserts), batch_size):
        batch = upserts[i : i + batch_size]
        supabase.table("scores").upsert(batch).execute()
        print(f"   ✅ 배치 {i // batch_size + 1} 완료 ({len(batch)}건)")

    print(f"✅ score 정합성 동기화 완료: {len(upserts)}건")


if __name__ == "__main__":
    normalize_existing_scores()
