# -*- coding: utf-8 -*-
"""
웹 '하락 중 팔았다면' 계산용 KODEX200 일별 수정종가 (web/src/data/behaviorData.ts).
입력: .research-cache/px_069500.json (네이버 일봉, 분배금 소급 반영 수정주가, 2002-10~)
갱신: python scripts/research/build_behavior_data.py
"""
import json

px = sorted(json.load(open(".research-cache/px_069500.json", encoding="utf-8")))
dates = [d for d, _ in px]
closes = [float(c) for _, c in px]
body = (
    "// 자동 생성 — scripts/research/build_behavior_data.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "/** KODEX 200 일별 종가(분배금 반영 수정주가). 거래일 순서, YYYYMMDD */\n"
    f"export const KODEX200_DAILY_DATES: string[] = {json.dumps(dates)}\n"
    f"export const KODEX200_DAILY_CLOSE: number[] = {json.dumps(closes)}\n"
)
open("web/src/data/behaviorData.ts", "w", encoding="utf-8", newline="\n").write(body)
print(len(dates), dates[0], dates[-1])
