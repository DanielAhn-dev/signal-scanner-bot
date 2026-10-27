# -*- coding: utf-8 -*-
"""
'해설 점검' 화면(web/src/features/commentary-check)이 읽는 숫자를 validate_common_beliefs.py 결과에서 직접 만들어
web/src/data/commonBeliefs.json으로 내보낸다 (손으로 옮겨 적지 않는다). 데이터가 바뀌면 다시 돌린다(분기 재검증 때).

실행: python scripts/research/build_common_beliefs.py
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_common_beliefs as vcb  # noqa: E402

OUT = "web/src/data/commonBeliefs.json"

# 항목 문구 (검증 정의는 docs/plan-forecast-ledger-2026-10-27.md §17)
TEXT = {
    1: dict(quote="달러가 오르면(원화가 약해지면) 증시가 빠진다", rule="원/달러 환율이 20일 동안 3% 이상 오른 날", short="달러 강세·원화 약세"),
    2: dict(quote="금리가 급하게 오르면 증시가 빠진다", rule="미국 10년 금리가 60거래일 동안 0.75%p 이상 오른 날", short="금리 급등"),
    3: dict(quote="금리가 급하게 내리면 불황 신호라 증시가 빠진다", rule="미국 10년 금리가 60거래일 동안 0.75%p 이상 내린 날", short="금리 급락"),
    4: dict(quote="장단기 금리가 뒤집히면(역전) 증시가 빠진다", rule="미국 10년 금리가 3개월 금리보다 낮은 달(전달 말 값)", short="장단기 금리 역전"),
    5: dict(quote="금값이 급등하면 위험 신호라 증시가 빠진다", rule="금 선물이 60거래일 동안 10% 이상 오른 날", short="금값 급등"),
    6: dict(quote="원자재(유가)가 급등하면 증시가 빠진다", rule="원자재 바스켓(DBC)이 60거래일 동안 15% 이상 오른 날", short="원자재 급등"),
    7: dict(quote="원자재(유가)가 급락하면 경기 걱정에 증시가 빠진다", rule="원자재 바스켓(DBC)이 60거래일 동안 15% 이상 내린 날", short="원자재 급락"),
    8: dict(quote="공포지수(VIX)가 급등하면 곧 더 빠진다", rule="미국 VIX가 5거래일 동안 30% 이상 오른 날", short="공포지수 급등"),
}


def iso(d):
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def main():
    res = vcb.compute()
    claims = []
    for r in res:
        cid = int(r["name"].split(" ")[0])
        verdict = {"성립": "confirmed", "보류": "insufficient"}.get(r["v"], "not_confirmed")
        claims.append(dict(
            id=cid, **TEXT[cid],
            first=iso(r["first"]), last=iso(r["last"]),
            weeks=int(r["n"]), onWeeks=int(r["n_on"]), independentEvents=int(r["ev"]),
            rateOnPct=round(float(r["r_on"]) * 100, 1), rateOffPct=round(float(r["r_off"]) * 100, 1),
            ratio=round(float(r["ratio"]), 2), controlledDiffPp=round(float(r["s"]) * 100, 1),
            pHolm=round(float(r["p_holm"]), 3),
            laterReturn60dDiffPct=round(float(r["d60"]) * 100, 1),
            verdict=verdict,
            # 켜진 날 낙폭이 더 잦았고 변동성을 맞춰도 같은 방향이지만, 8개를 동시에 시험한 보정 뒤엔 우연과 구분되지 않는 경우
            directionOnly=bool(verdict != "confirmed" and r["s"] > 0 and r["ratio"] > 1.3),
        ))
    out = dict(
        generated=datetime.date.today().isoformat(),
        script="scripts/research/validate_common_beliefs.py",
        outcome="신호가 켜진 주(週)의 이후 20거래일 안에 코스피가 −7% 이하로 내려간 적이 있는가",
        market="코스피, 주 1회 표본",
        method="최근 변동성 수준을 5구간으로 나눠 맞춘 뒤 켜진 날과 아닌 날의 차이를 비교, 8개를 동시에 시험한 보정(Holm) 적용",
        caveats=[
            "같이 움직이는 것(동행)은 사실일 수 있습니다. 여기서 본 것은 '먼저 알려 주는가(선행)'입니다.",
            "'확인되지 않았다'는 '틀렸다'가 아니라 이 자료에서는 우연과 구분되지 않았다는 뜻입니다. 반대로 하라는 뜻도 아닙니다.",
            "코스피 하나, 20거래일 급락 하나만 봤습니다. 장기 수익이나 업종별 영향은 다를 수 있습니다.",
            "미국 고용지표 수치, 순수 유가, 달러지수는 자료가 없어 빠졌습니다(유가는 원자재 바스켓, 달러는 원/달러로 대신).",
        ],
        claims=claims,
    )
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{OUT} 저장 — 항목 {len(claims)}개, 생성일 {out['generated']}")


if __name__ == "__main__":
    main()
