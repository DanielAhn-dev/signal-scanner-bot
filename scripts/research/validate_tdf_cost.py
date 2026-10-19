# -*- coding: utf-8 -*-
"""
H54(V9): 저보수 지수 ETF로 직접 맞춘 단계 전환이 같은 주식 비중의 TDF ETF보다 연 비용이 0.3%p 이상 싼가 (2026-10-15).
판정 기준은 hypothesis-ledger.md H54에 결과 보기 전 고정(커밋 후 이 스크립트 작성).
TDF 비용: 총보수+편입 ETF 보수+기타비용을 합친 총수수료율, 2차 자료 econsis.kr(2025-07-27 기준, 출처 네이버페이증권) —
  https://econsis.kr/tdf-2050-etf-comparison-miraeasset-samsung-kb-koreainvest/ (공시 원문 아님).
직접 조합: 네이버 총보수(실행 시점 조회) 중 시가총액 1,000억 이상 상품에서 가장 낮은 것.
출력: .research-cache/tdf_cost_out.txt
"""
import json, sys, time, urllib.request
from datetime import date

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/tdf_cost_out.txt"
# (상품, 총수수료율 %, 위험자산 비중 %) — econsis.kr 2025-07-27
TDF = [("RISE TDF2050액티브", 0.1735, 77.0), ("TIGER TDF2045", 0.2959, 79.9),
       ("KODEX TDF2050액티브", 0.4159, 72.6), ("ACE TDF2050액티브", 0.4542, 69.0)]
CANDIDATES = {
    "미국 S&P500": ["360750", "379800", "360200", "379780", "0026S0", "433330"],
    "코스피200": ["069500", "102110", "148020", "105190", "152100", "069660", "293180"],
    "국고채": ["365780", "114260", "471230", "148070", "438560", "438570", "114100"],
}
MIN_CAP = 1000  # 억원
TURNOVER, COMMISSION = 0.10, 0.00015
lines = []


def say(s=""):
    print(s)
    lines.append(s)


def info(code):
    req = urllib.request.Request(f"https://m.stock.naver.com/api/stock/{code}/integration", headers={"User-Agent": "Mozilla/5.0"})
    d = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
    i = {x["code"]: x["value"] for x in d.get("totalInfos", [])}
    # 총보수는 etfKeyIndicator.totalFee — fundPay는 보수 인하가 늦게 반영된다
    total = (d.get("etfKeyIndicator") or {}).get("totalFee")
    fee = float(total) if total is not None else (float(str(i.get("fundPay", "")).replace("%", "")) if i.get("fundPay") else None)
    return d.get("stockName"), fee, MARKET_SUM.get(code, 0)


def load_market_sum():
    # 종목 상세에는 시가총액이 없어 ETF 목록(억원)에서 가져온다
    req = urllib.request.Request("https://finance.naver.com/api/sise/etfItemList.nhn", headers={"User-Agent": "Mozilla/5.0"})
    items = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("cp949"))["result"]["etfItemList"]
    return {it["itemcode"]: it["marketSum"] for it in items}


MARKET_SUM = load_market_sum()


say(f"조회일 {date.today()} (네이버 총보수, 시가총액 {MIN_CAP}억 이상만)")
best = {}
for group, codes in CANDIDATES.items():
    rows = []
    for c in codes:
        try:
            name, fee, cap = info(c)
            rows.append((fee, name, c, cap))
        except Exception as e:
            say(f"  {c} 조회 실패: {e}")
        time.sleep(0.3)
    say(f"\n[{group}]")
    for fee, name, c, cap in sorted(rows, key=lambda r: (r[0] is None, r[0])):
        say(f"  {c} {name}: 총보수 {fee}% · 시가총액 {cap:,}억")
    ok = [r for r in rows if r[0] is not None and r[3] >= MIN_CAP]
    best[group] = min(ok)
    say(f"  → 가장 낮은 것: {best[group][1]} {best[group][0]}%")

trade = TURNOVER * COMMISSION * 2 * 100  # %/년 (사고팔기)
say(f"\n리밸런싱 매매비용 가정: 연 회전 {TURNOVER*100:.0f}% × 수수료 {COMMISSION*100:.3f}% × 매수·매도 = {trade:.4f}%/년")
say("\n[TDF vs 직접 조합 — 같은 위험자산 비중]")
verdict = {}
for name, cost, risk in TDF:
    w = risk / 100
    for eq_name in ("미국 S&P500", "코스피200"):
        diy = w * best[eq_name][0] + (1 - w) * best["국고채"][0] + trade
        gap = cost - diy
        # 1억 원, 연 7% 가정 20년 누적 비용 차(최종 금액 차)
        fv = lambda c: 1e8 * (1 + 0.07 - c / 100) ** 20
        say(f"  {name}(위험 {risk}%) {cost:.3f}% vs 직접({eq_name}+국고채) {diy:.3f}% → 차 {gap:+.3f}%p"
            f" · 1억 20년(연 7% 가정) 차 {(fv(diy) - fv(cost))/1e4:,.0f}만원")
        if eq_name == "미국 S&P500":
            verdict[name] = gap >= 0.3

say("\n[판정 — H54 사전 기준] (주식 칸 = 미국 S&P500 기준, 직접이 0.3%p 이상 싸면 통과)")
for name, ok in verdict.items():
    say(f"  {name}: {'통과(직접이 0.3%p 이상 쌈)' if ok else '0.3%p 미만 — 비용 차이 작음'}")
say("  보조: 퇴직연금(IRP·DC)에서 TDF '적격' 상품은 안전자산 칸에 100%까지 담을 수 있어, 위험자산 70% 한도가 있는 직접 조합과 계좌 제약이 다르다.")
say("  한계: TDF 비용은 2차 자료·한 시점(2025-07-27), 직접 조합은 총보수만(기타비용 빠짐 → 실제 차이는 약간 작음), 수익·추적오차는 비교하지 않음")

open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
