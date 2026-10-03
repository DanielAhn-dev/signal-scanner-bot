# -*- coding: utf-8 -*-
"""
자녀 계좌 장기 시뮬레이션용 데이터 생성 (2026-10-03).

미국 S&P500 총수익의 월별 '실질'(물가 반영) 수익률 1926-02~2023-06을 web/src/data/childLongRunData.ts로 굽는다.
출처: Shiller 월별(가격·배당·CPI). validate_retirement_withdrawal.py의 us_shiller()와 같은 계산이다.
20~30년 시야는 한국 상장 지수 ETF 표본(약 24년)으로는 부족해 미국 장기 데이터를 쓰고, 화면에는 그 사실을 표시한다.
실행: python scripts/research/build_child_data.py (저장소 루트)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_retirement_withdrawal import us_shiller  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "web", "src", "data", "childLongRunData.ts")


def main():
    months, rs, _ = us_shiller("192601")
    vals = ",".join(f"{r:.4f}" for r in rs)
    body = (
        "// scripts/research/build_child_data.py가 만든 파일 — 직접 고치지 않는다.\n"
        "// 미국 S&P500 총수익 월별 실질(물가 반영) 수익률, Shiller 월 평균 가격 기준.\n"
        f"export const CHILD_LONGRUN_START = '{months[0]}'\n"
        f"export const CHILD_LONGRUN_END = '{months[-1]}'\n"
        f"export const CHILD_LONGRUN_REAL_MONTHLY: number[] = [{vals}]\n"
    )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)
    print(f"{months[0]}~{months[-1]} {len(rs)}개월, {len(body)}바이트 -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
