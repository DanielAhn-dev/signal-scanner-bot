# -*- coding: utf-8 -*-
"""
웹 새 시뮬레이터용 정적 데이터 생성 (web/src/data/simData.ts). 계획: docs/plan-simulator-redesign-2026-10-22.md 6절.

섞어보기(build_mix_data.py) 자산 6개에 현금·미국 중기채·선진국·신흥국·미국 리츠·금(환노출)·코스닥을 더하고, 이력을 앞으로 늘린다.

규칙
- 섞어보기 기간(각 자산의 mixData 시작월~)에는 **섞어보기와 같은 월 수익률**이 나와야 한다(web/src/lib/sim/simData.test.ts가 대조).
  그래서 섞어보기와 같은 원천·같은 환율(야후 KRW=X)을 그대로 쓰고, 그보다 앞은 다른 원천을 **수익률로 이어 붙인다**(앞 구간 가격을 맞춰 축소).
  - 나스닥100: TIGER(2010-10~) 앞에 QQQ × 원/달러(ECOS 매매기준율) — 앞 구간에 연 0.9%p 차감을 미리 넣는다(dragPct는 0 유지).
  - 미국 원지수 ETF(SPY·TLT 등): 야후 환율(2003-12~) 앞을 ECOS 환율(1996~)로 환산한 수익률로 잇는다.
- 미국 원지수 ETF는 한국 상장 상품보다 좋게 나오는 몫을 dragPct 0.9로 뺀다(섞어보기와 같은 값). 채권·리츠·신흥국도 같은 값을 가정한다(따로 재지 않음).
- 미완성 달은 자산별로 뺀다(마지막 일자가 25일 전이면 그 달 제외). 섞어보기와 달리 전체 공통 컷이 아니라 자산마다 다르다.
- 현금(CD91): 전월 말 금리 ÷ 12를 그달 수익으로 쌓은 지수. 세금·수수료 없음.
- 코스닥: 가격지수(분배금 없음) — priceOnly로 표시.

입력: .research-cache/px_069500.json, .research-cache/allweather/(fetch_allweather_data.py), .research-cache/longrun/krw_usd_ecos.json(fetch_krw_usd_ecos.py)
갱신: python scripts/research/fetch_allweather_data.py && python scripts/research/fetch_krw_usd_ecos.py && python scripts/research/build_sim_data.py
"""
import json
import os
from datetime import date

D = ".research-cache/allweather/"
OUT = "web/src/data/simData.ts"
US_DRAG = 0.9


def load(path, col=1):
    return sorted([r[0], float(r[col])] for r in json.load(open(path, encoding="utf-8")))


def month_end(rows):
    """{YYYYMM: (마지막 일자, 값)} — 마지막 달이 25일 전에 끝나면 미완성으로 뺀다"""
    by = {}
    for d, v in rows:
        by[d[:6]] = (d, v)
    last = max(by)
    if by[last][0][6:8] < "25":
        del by[last]
    return by


def fx_lookup(rows):
    ds = [d for d, _ in rows]

    def at(d):
        if d < ds[0]:
            return None
        lo, hi = 0, len(rows) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if ds[mid] <= d:
                lo = mid
            else:
                hi = mid - 1
        return rows[lo][1]

    return at


fx_yahoo = fx_lookup(load(D + "us_KRW_X.json", 2))  # 섞어보기와 같은 환율
fx_ecos = fx_lookup(load(".research-cache/longrun/krw_usd_ecos.json"))


def us_krw(sym, fx):
    out = []
    for d, v in load(D + f"us_{sym}.json", 1):
        f = fx(d)
        if f:
            out.append([d, v * f])
    return out


def ym_prev(ym):
    y, m = int(ym[:4]), int(ym[4:])
    return f"{y - 1}12" if m == 1 else f"{y}{m - 1:02d}"


def splice(early, late, early_drag=0.0):
    """late(월말 맵) 앞에 early의 월 수익률을 이어 붙인다. late 구간 값은 그대로, 앞 구간은 late 첫 달에 맞춰 축소.
    early_drag(연 %)는 앞 구간 수익률에만 미리 뺀다."""
    first = min(late)
    out = {ym: v for ym, (_, v) in late.items()}
    ym, val = first, late[first][1]
    keep = 1 - early_drag / 100 / 12
    while ym_prev(ym) in early and ym in early:
        r = early[ym][1] / early[ym_prev(ym)][1]
        val = val / (r * keep)
        ym = ym_prev(ym)
        out[ym] = val
    return out


def plain(m):
    return {ym: v for ym, (_, v) in m.items()}


def us_spliced(sym):
    """야후 환율(섞어보기와 같음) 구간 + 그 앞 ECOS 환율 구간"""
    return splice(month_end(us_krw(sym, fx_ecos)), month_end(us_krw(sym, fx_yahoo)))


def cash_index():
    rows = load(D + "cd91.json")
    m = month_end(rows)
    yms = sorted(m)
    out, v = {yms[0]: 100.0}, 100.0
    for a, b in zip(yms, yms[1:]):
        v *= 1 + m[a][1] / 100 / 12
        out[b] = v
    return out


kq_path = D + ("us__KQ11.json" if os.path.exists(D + "us__KQ11.json") else "kr_index_KQ11.json")

# id, 이름, 자산군, 원천 설명, dragPct, 월말 맵, priceOnly, 한계 메모
ASSETS = [
    ("kospi200", "코스피200", "equity", "KODEX 200", 0.0, plain(month_end(load(".research-cache/px_069500.json"))), False,
     "2002-10 상장 전 이력은 없다."),
    ("sp500", "미국 S&P500", "equity", "SPY 원화 환산(한국 상장은 2020~)", US_DRAG, us_spliced("SPY"), False,
     "미국 원지수 ETF를 원화로 환산하고 한국 상장 상품과의 격차 연 0.9%p를 뺐다. 2003-12 전은 한국은행 환율."),
    ("nasdaq100", "미국 나스닥100", "equity", "TIGER 미국나스닥100(2010-10~), 그 전은 QQQ 원화 환산",
     0.0, splice(month_end(us_krw("QQQ", fx_ecos)), month_end(load(D + "kr_133690.json")), US_DRAG), False,
     "2010-10 전은 QQQ를 원화로 환산하고 연 0.9%p를 뺀 값. 2000년 닷컴 붕괴가 들어간다."),
    ("kosdaq", "코스닥", "equity", "코스닥 지수(가격)", 0.0, plain(month_end(load(kq_path))), True,
     "지수 가격만 — 분배금이 빠져 실제 상품보다 조금 낮게 나온다. 보수도 빼지 않았다."),
    ("developed", "선진국(미국 제외)", "equity", "EFA 원화 환산", US_DRAG, us_spliced("EFA"), False,
     "MSCI EAFE(유럽·일본 등). 한국 상장 상품과의 격차는 S&P500과 같은 연 0.9%p로 가정."),
    ("emerging", "신흥국", "equity", "EEM 원화 환산", US_DRAG, us_spliced("EEM"), False,
     "MSCI 신흥국 — 한국이 10% 안팎 들어 있어 코스피200과 겹친다. 격차 연 0.9%p 가정."),
    ("kbond10", "한국 국고채10년", "bond", "KIWOOM 국고채10년", 0.0, plain(month_end(load(D + "kr_148070.json"))), False,
     "2011-10 상장 전 이력은 없다."),
    ("usbond7", "미국 중기채(7~10년)", "bond", "IEF 원화 환산", US_DRAG, us_spliced("IEF"), False,
     "환노출 — 원/달러가 오르면 수익이 커진다. 격차 연 0.9%p 가정."),
    ("usbond20", "미국 장기채(20년+)", "bond", "TLT 원화 환산(한국 상장은 2018~, 환헤지 상품 많음)", US_DRAG, us_spliced("TLT"), False,
     "환노출 기준. 한국 상장 상품은 환헤지(H)가 많아 실제와 다를 수 있다."),
    ("cash", "현금(CD91)", "cash", "CD 91일물 금리", 0.0, cash_index(), False,
     "금리 그대로 쌓은 값 — 예금·CMA·파킹 상품 대용. 세금(15.4%)을 빼지 않았다."),
    ("gold", "금", "gold", "KODEX 골드선물(H)", 0.0, plain(month_end(load(D + "kr_132030.json"))), False,
     "환헤지(H) 선물 — 금값만 따라가고 환율 효과는 없다."),
    ("gold_usd", "금(환노출)", "gold", "GLD 원화 환산", US_DRAG, us_spliced("GLD"), False,
     "달러 금값 × 원/달러 — 환율이 오르면 같이 오른다. 격차 연 0.9%p 가정."),
    ("reits", "미국 리츠", "reit", "VNQ 원화 환산", US_DRAG, us_spliced("VNQ"), False,
     "미국 부동산 리츠. 격차 연 0.9%p 가정. 2008년 낙폭이 주식보다 컸다."),
]

out = []
for aid, name, cls, src, drag, m, price_only, note in ASSETS:
    pts = [[ym, round(v, 4)] for ym, v in sorted(m.items())]
    out.append({
        "id": aid, "name": name, "class": cls, "source": src, "dragPct": drag, "first": pts[0][0], "last": pts[-1][0],
        "priceOnly": price_only, "note": note, "monthly": pts,
    })

asof = max(a["last"] for a in out)
body = (
    "// 자동 생성 — scripts/research/build_sim_data.py. 직접 고치지 말고 스크립트를 다시 돌린다.\n"
    "export type SimAssetClass = 'equity' | 'bond' | 'cash' | 'gold' | 'reit'\n"
    "export type SimAsset = {\n"
    "  id: string; name: string; class: SimAssetClass; source: string; dragPct: number; first: string; last: string\n"
    "  /** true면 가격지수(분배금 미반영) */\n  priceOnly: boolean\n  /** 화면 '읽을 때 주의'용 한계 */\n  note: string\n"
    "  /** [YYYYMM, 원화 월말 값(분배금 반영 수정주가, priceOnly면 가격)] */\n  monthly: Array<[string, number]>\n}\n\n"
    f"/** 가장 최근 완성된 달 YYYY-MM */\nexport const SIM_ASOF = '{asof[:4]}-{asof[4:]}'\n"
    f"/** 생성일 — 180일 지나면 화면에 낡음 표시 */\nexport const SIM_BUILT = '{date.today().isoformat()}'\n\n"
    f"export const SIM_ASSETS: SimAsset[] = {json.dumps(out, ensure_ascii=False)}\n"
)
open(OUT, "w", encoding="utf-8", newline="\n").write(body)
print(OUT, f"{len(body) / 1024:.0f}KB")
for a in out:
    print(f"  {a['id']:<10} {a['first']}~{a['last']} {len(a['monthly'])}개월")
