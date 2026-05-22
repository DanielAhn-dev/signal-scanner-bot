"""
map_sectors.py
==============
Naver Finance 업종 페이지를 기반으로 종목 → WICS 섹터 매핑을 DB에 업데이트합니다.

데이터 소스: https://finance.naver.com/sise/sise_group.naver?type=upjong
  - KRX data.krx.co.kr API 대비 인증 불필요, 안정적
  - Naver 업종명이 FnGuide WICS 분류명과 동일하여 sectorMeta.ts와 1:1 매핑
"""

import os
import re
import time

import requests
from supabase import create_client


# ── 환경 변수 ──────────────────────────────────────────────────────────────────
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

NAVER_HEADERS = {"User-Agent": "Mozilla/5.0"}
NAVER_UPJONG_URL = "https://finance.naver.com/sise/sise_group.naver?type=upjong"
NAVER_DETAIL_URL = "https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no={no}"


# ── WICS 정규 이름 목록 (sectorMeta.ts와 동일) ────────────────────────────────
# Naver 업종명과 매핑할 기준 목록
WICS_NAMES = {
    # 건강관리
    "건강관리기술", "건강관리업체및서비스", "건강관리장비와용품",
    "생명과학도구및서비스", "생물공학", "제약",
    # 소재
    "건축자재", "건축제품", "비철금속", "철강", "종이와목재", "포장재", "화학",
    # 산업재
    "건설", "기계", "도로와철도운송", "상업서비스와공급품", "우주항공과국방",
    "운송인프라", "전기장비", "조선", "항공사", "항공화물운송과물류", "해운사",
    "복합기업", "무역회사와판매업체",
    # 경기소비재
    "가구", "가정용기기와용품", "게임엔터테인먼트", "다각화된소비자서비스",
    "레저용장비와제품", "방송과엔터테인먼트", "백화점과일반상점",
    "섬유,의류,신발,호화품", "양방향미디어와서비스", "자동차", "자동차부품",
    "전문소매", "호텔,레스토랑,레저", "인터넷과카탈로그소매", "광고",
    # 필수소비재
    "담배", "식품", "식품과기본식료품소매", "음료", "화장품", "가정용품", "판매업체",
    # 금융
    "은행", "카드", "증권", "창업투자", "기타금융", "손해보험", "생명보험",
    # IT
    "반도체와반도체장비", "소프트웨어", "IT서비스", "컴퓨터와주변기기",
    "전자장비와기기", "전자제품", "전기제품", "통신장비", "디스플레이장비및부품",
    "디스플레이패널", "사무용전자제품", "핸드셋",
    # 통신서비스
    "다각화된통신서비스", "무선통신서비스", "출판",
    # 유틸리티
    "복합유틸리티", "전기유틸리티", "가스유틸리티",
    # 에너지
    "석유와가스", "에너지장비및서비스",
    # 부동산
    "부동산",
    # 기타
    "교육서비스", "문구류", "기타",
}


def fetch_naver_sector_list() -> dict[str, str]:
    """Naver Finance 업종 목록 반환. {no: 업종명}"""
    resp = requests.get(NAVER_UPJONG_URL, headers=NAVER_HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    matches = re.findall(r'no=(\d+).*?>([^<]{2,40})</a>', resp.text)
    seen: dict[str, str] = {}
    for no, name in matches:
        name = name.strip()
        if name and no not in seen:
            seen[no] = name
    return seen


def fetch_naver_sector_stocks(no: str) -> list[str]:
    """Naver Finance 업종 구성종목 코드 목록 반환 (6자리 숫자만)."""
    resp = requests.get(
        NAVER_DETAIL_URL.format(no=no),
        headers=NAVER_HEADERS,
        timeout=15,
    )
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    codes = re.findall(r'code=(\d{6})', resp.text)
    return list(dict.fromkeys(codes))


def fetch_all_stocks() -> dict[str, str]:
    """stocks 테이블의 기존 종목 코드/이름 맵."""
    all_data: list[dict] = []
    page = 0
    page_size = 1000
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
            print(f"⚠️ 종목 로딩 에러: {e}")
            break
    return {item["code"]: item["name"] for item in all_data}


def map_sectors() -> None:
    print("🔄 종목별 섹터 매핑 시작 (Naver Finance 업종 기반)...")

    name_map = fetch_all_stocks()
    print(f"   기존 종목 {len(name_map)}개 로딩 완료")

    print("📋 Naver 업종 목록 수집 중...")
    try:
        sector_list = fetch_naver_sector_list()
    except Exception as e:
        print(f"❌ 업종 목록 수집 실패: {e}")
        raise SystemExit(1)

    # WICS_NAMES에 있는 업종만 처리
    valid_sectors = {
        no: name for no, name in sector_list.items()
        if name in WICS_NAMES
    }
    skipped = {name for name in sector_list.values() if name not in WICS_NAMES}
    print(f"   총 {len(sector_list)}개 업종 중 {len(valid_sectors)}개 처리, {len(skipped)}개 스킵")
    if skipped:
        print(f"   스킵: {sorted(skipped)}")

    stock_updates: list[dict] = []
    sector_inserts: dict[str, str] = {}

    print("\n📊 업종별 구성종목 수집 중...")
    for i, (no, sector_name) in enumerate(sorted(valid_sectors.items(), key=lambda x: x[1])):
        try:
            codes = fetch_naver_sector_stocks(no)
        except Exception as e:
            print(f"   ⚠️ [{sector_name}] 구성종목 수집 실패: {e}")
            codes = []

        sector_id = f"KRX:{sector_name}"
        sector_inserts[sector_id] = sector_name

        for code in codes:
            stock_name = name_map.get(code, code)
            stock_updates.append({
                "code": code,
                "name": stock_name,
                "sector_id": sector_id,
            })

        print(f"   [{i+1}/{len(valid_sectors)}] {sector_name}: {len(codes)}종목", end="\r")
        time.sleep(0.15)

    # ── 섹터 동기화: name 기준으로 기존 ID 재사용 ──────────────────────────────
    # sectors 테이블에 name UNIQUE 제약이 있으므로,
    # 같은 name이 다른 id로 이미 존재하면 그 기존 id를 재사용함
    print(f"\n\n🏗️ 총 {len(sector_inserts)}개 섹터 동기화 중...")

    existing_res = supabase.table("sectors").select("id, name").execute()
    name_to_db_id: dict[str, str] = {
        row["name"]: row["id"] for row in (existing_res.data or [])
    }

    # 기존 id 있으면 재사용, 없으면 KRX:{name} 신규
    resolved: dict[str, str] = {}  # {실제 sector_id: sector_name}
    old_to_real: dict[str, str] = {}  # {임시 KRX:{name}: 실제 sector_id}
    for tmp_id, sname in sector_inserts.items():
        real_id = name_to_db_id.get(sname, tmp_id)
        resolved[real_id] = sname
        old_to_real[tmp_id] = real_id

    sector_batch = [{"id": sid, "name": sname} for sid, sname in resolved.items()]
    for i in range(0, len(sector_batch), 100):
        try:
            supabase.table("sectors").upsert(sector_batch[i:i+100]).execute()
        except Exception as e:
            print(f"⚠️ 섹터 등록 에러: {e}")

    # stock_updates 의 sector_id 를 실제 DB id 로 교체
    for item in stock_updates:
        item["sector_id"] = old_to_real.get(item["sector_id"], item["sector_id"])

    # 중복 제거: 같은 종목이 여러 업종에 있으면 마지막 것으로 덮어씀
    unique_map = {item["code"]: item for item in stock_updates}
    final_updates = list(unique_map.values())

    print(f"🚀 총 {len(final_updates)}개 종목 섹터 업데이트 시작...")
    total_batches = (len(final_updates) + 99) // 100
    for i in range(0, len(final_updates), 100):
        batch = final_updates[i:i+100]
        try:
            supabase.table("stocks").upsert(batch).execute()
            print(f"   💾 업로드 중... ({i // 100 + 1}/{total_batches})", end="\r")
        except Exception as e:
            print(f"\n⚠️ 종목 업데이트 에러: {e}")

    print(f"\n✅ 완료 — {len(sector_inserts)}개 섹터, {len(final_updates)}개 종목 업데이트")


if __name__ == "__main__":
    map_sectors()
