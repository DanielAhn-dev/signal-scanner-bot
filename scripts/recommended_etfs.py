"""
추천·비교에 쓰는 ETF 목록 (scripts/recommended_etfs.json).

ETF는 수집 대상(core/extended)에서 이름 규칙으로 빠져, 보유하지 않은 추천 후보는 일봉·지표가 없었다
(2026-10-19: 모아가기 후보 15종·코어 프로필 8종 중 4종만 일봉 있음). universe_level을 올리면 스캔·시장 폭·
점수 계산에까지 섞이므로, 일봉 수집 목록에만 더한다. 지표는 "그날 일봉이 있는 종목"을 계산하므로 따라온다.
"""

from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "recommended_etfs.json"


def recommended_etfs() -> list[tuple[str, str]]:
    """(코드, 이름) 목록. 파일이 없거나 깨졌으면 빈 목록 — 수집 본류는 막지 않는다."""
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        return [(str(e["code"]).strip(), str(e.get("name") or e["code"]).strip()) for e in data.get("etfs", []) if e.get("code")]
    except Exception as e:
        print(f"   recommended ETF list unavailable (skip): {e}")
        return []


def recommended_etf_codes() -> list[str]:
    return [code for code, _ in recommended_etfs()]


def with_recommended_etfs(tickers: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """수집 목록 뒤에 아직 없는 추천 ETF를 붙인다(순서 유지, 중복 제외)."""
    have = {code for code, _ in tickers}
    return tickers + [(code, name) for code, name in recommended_etfs() if code not in have]
