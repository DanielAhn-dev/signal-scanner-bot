"""
batch_modules/truncation_guard.py
=================================
Supabase 응답 잘림 감지기 (Python 배치용, TS의 src/lib/supabaseTruncationGuard.ts와 같은 판정).

PostgREST는 한 번에 최대 1000행만 돌려준다. 2026-10-06 점검에서 섹터 매핑(4,135종목 중 1,000개)·섹터 점수
(90일 중 가장 오래된 5~6일) 등이 이 때문에 조용히 틀렸다. GET 응답이 정확히 1000행이고 요청한 limit이
없거나 1000보다 크면 잘림으로 보고 로그와 관리자 텔레그램(실행당 최대 3건)으로 알린다.
install()을 배치 시작 때 한 번 부른다. 조회 결과는 바꾸지 않는다.
"""

import os
import json
import urllib.request

MAX_ROWS = 1000
_installed = False
_seen: set = set()
_alerts = 0
events: list = []


def is_likely_truncated(row_count: int, limit_param) -> bool:
    if row_count != MAX_ROWS:
        return False
    try:
        limit = int(limit_param) if limit_param is not None else None
    except (TypeError, ValueError):
        limit = None
    return not (limit is not None and 0 < limit <= MAX_ROWS)


def _alert(table: str, query: str) -> None:
    global _alerts
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    if not token or not chat_id or os.environ.get("SUPABASE_TRUNCATION_ALERT") == "false" or _alerts >= 3:
        return
    _alerts += 1
    text = f"⚠️ [조회 잘림 감지·배치] {table} 응답이 1000행에서 잘렸을 수 있습니다.\n{query[:300]}\n→ select_all로 끝까지 받도록 고쳐야 합니다 (scripts/batch_modules/truncation_guard.py)"
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def _record(path: str, params) -> None:
    table = str(path).rstrip("/").split("/")[-1]
    query = str(params)
    key = f"{table}?{query}"
    if key in _seen:
        return
    _seen.add(key)
    events.append({"table": table, "query": query})
    print(f"[truncation-guard] {table} 응답 {MAX_ROWS}행 — 잘림 의심: {query[:200]}", flush=True)
    _alert(table, query)


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    try:
        from postgrest._sync.request_builder import SyncQueryRequestBuilder
    except Exception as e:  # 라이브러리 구조가 바뀌면 감지만 꺼진다
        print(f"[truncation-guard] 설치 실패: {e}")
        return
    original = SyncQueryRequestBuilder.execute

    def guarded_execute(self):
        res = original(self)
        try:
            req = self.request
            data = getattr(res, "data", None)
            if getattr(req, "http_method", "") == "GET" and isinstance(data, list):
                params = getattr(req, "params", None)
                limit = params.get("limit") if params is not None else None
                if is_likely_truncated(len(data), limit):
                    _record(getattr(req, "path", "?"), params)
        except Exception:
            pass
        return res

    SyncQueryRequestBuilder.execute = guarded_execute
