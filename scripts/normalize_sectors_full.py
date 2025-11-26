# scripts/normalize_sectors_full.py

import os
import unicodedata
from collections import defaultdict
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ["SUPABASE_SERVICE_KEY"]
)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def norm_text(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s)
    s = s.strip()
    while "  " in s:
        s = s.replace("  ", " ")
    return s


def main():
    print("🔄 sectors / stocks.sector_id 정규화 시작...")

    # 1) 전체 섹터 로딩
    res = supabase.table("sectors").select("id, name").execute()
    rows = res.data or []

    # 2) 정규화 이름(공백 제거)별 그룹 만들기
    groups: dict[str, list[dict]] = defaultdict(list)  # key -> [row...]
    for r in rows:
        old_id = r["id"]
        raw_name = r.get("name") or ""
        norm_name = norm_text(raw_name)
        if not norm_name:
            continue
        key = norm_name.replace(" ", "")  # ✅ 공백 제거한 키
        if not key:
            continue
        groups[key].append({"id": old_id, "name": raw_name})

    by_name: dict[str, str] = {}    # key -> canonical_id
    id_to_new: dict[str, str] = {}  # old_id -> canonical_id

    # 3) 각 그룹에서 대표 섹터 id 선택
    for key, items in groups.items():
        preferred = next(
            (it for it in items if norm_text(it["name"]) == it["name"]),
            None,
        )
        if not preferred:
            preferred = items[0]

        canon_id = preferred["id"]
        by_name[key] = canon_id        # ✅ key 로 저장

        for it in items:
            id_to_new[it["id"]] = canon_id

    print(f" -> 정규화 대상 섹터 수: {len(id_to_new)}")
    print(f" -> 서로 다른 정규화 이름 수: {len(by_name)}")

    dupe_ids = [old for (old, new) in id_to_new.items() if old != new]
    print(" -> 중복 후보 목록:", dupe_ids)

    # 4) stocks.sector_id 리매핑
    print(" -> stocks.sector_id 리매핑 중...")
    res_s = supabase.table("stocks").select("code, name, sector_id").execute()
    srows = res_s.data or []

    updates = []
    for r in srows:
        old = r.get("sector_id")
        if not old:
            continue
        new = id_to_new.get(old)
        if not new or new == old:
            continue
        updates.append({
            "code": r["code"],
            "name": r["name"],
            "sector_id": new,
        })

    print(f" -> 변경 대상 종목 수: {len(updates)}")
    batch_size = 500
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        supabase.table("stocks").upsert(batch).execute()
        print(f"   💾 업로드... {i+len(batch)}/{len(updates)}", end="\r")

    print("\n✅ stocks.sector_id 정규화 완료.")

    # 5) sectors 중복 row 삭제
    dupe_ids = [old for (old, new) in id_to_new.items() if old != new]
    if not dupe_ids:
        print(" -> 삭제할 중복 섹터 없음.")
        return

    print(f" -> 삭제 후보 중복 섹터 수: {len(dupe_ids)}")

    res_chk = (
        supabase.table("stocks")
        .select("sector_id")
        .in_("sector_id", dupe_ids)
        .execute()
    )
    still_used = {r["sector_id"] for r in (res_chk.data or []) if r.get("sector_id")}
    final_delete = [sid for sid in dupe_ids if sid not in still_used]

    print(f" -> 실제 삭제 섹터 수: {len(final_delete)}")
    for i in range(0, len(final_delete), 100):
        batch = final_delete[i:i+100]
        supabase.table("sectors").delete().in_("id", batch).execute()

    print("✅ sectors 테이블 중복 row 삭제 완료.")


if __name__ == "__main__":
    main()
