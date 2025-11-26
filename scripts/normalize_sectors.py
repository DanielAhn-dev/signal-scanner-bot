# scripts/normalize_sectors.py

import os
import unicodedata
from datetime import datetime, timezone
from supabase import create_client

def load_env_file(filepath=".env"):
    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    if k not in os.environ:
                        os.environ[k] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass

load_env_file()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
supabase = create_client(url, key)

SECTOR_CANONICAL = {
    "KRX:반도체와반도체장비": "KRX:반도체",
    "KRX:기계·장비": "KRX:기계",
    "KRX:기계 · 장비": "KRX:기계",
    "KRX:보험": "KRX:손해보험",
    "KRX:금융": "KRX:기타금융",
    "KRX:은행": "KRX:은행",
    "KRX:증권": "KRX:기타금융",
}

def norm_text(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)  # ✅ 유니코드 정규화
    s = s.strip()
    while "  " in s:
        s = s.replace("  ", " ")
    return s

def normalize_sector_id(raw: str) -> str:
    if not raw:
        return raw
    base = norm_text(raw)
    return SECTOR_CANONICAL.get(base, base)

def main():
    print("🔄 stocks.sector_id 정규화 시작...")

    res = supabase.table("stocks").select("code, name, sector_id").execute()
    rows = res.data or []

    updates = []
    target_sector_ids = set()

    for r in rows:
        code = r["code"]
        name = r["name"]
        old = r.get("sector_id") or ""
        new = normalize_sector_id(old)

        if new != old:
            updates.append({"code": code, "name": name, "sector_id": new})
            if new:
                target_sector_ids.add(new)   # ✅ 새 ID 수집

    print(f" -> 수정 대상 종목 수: {len(updates)}")

    # 새 sector_id 가 sectors 테이블에 없으면 먼저 생성
    if target_sector_ids:
        existing = supabase.table("sectors") \
            .select("id") \
            .in_("id", list(target_sector_ids)) \
            .execute()
        existing_ids = {r["id"] for r in (existing.data or [])}
        missing_ids = sorted(target_sector_ids - existing_ids)

        if missing_ids:
            print(f" -> sectors에 없는 섹터 ID {len(missing_ids)}개 생성")
            now = datetime.now(timezone.utc).isoformat()
            sector_rows = []
            for sid in missing_ids:
                name = sid.split("KRX:")[-1].strip()
                sector_rows.append({
                    "id": sid,
                    "name": name,
                    "updated_at": now,
                })
            supabase.table("sectors").upsert(sector_rows).execute()

    # stocks.sector_id 업데이트
    batch_size = 500
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        supabase.table("stocks").upsert(batch).execute()
        print(f"   💾 업로드 중... ({i+len(batch)}/{len(updates)})", end="\r")

    print("\n✅ 섹터 ID 정규화 완료.")

if __name__ == "__main__":
    main()
