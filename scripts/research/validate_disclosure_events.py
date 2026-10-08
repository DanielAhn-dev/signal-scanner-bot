# -*- coding: utf-8 -*-
"""
공시 사건 뒤 성과 (2026-10-08) — H31(희석, V4)·H32(자사주, V5)·H33(위험 지정, V6).
판정 기준은 docs/hypothesis-ledger.md에 결과 보기 전 고정.

사건: DART 접수일 다음 거래일 시가 진입. 같은 종목·같은 범주는 60거래일 안 반복을 한 건으로.
      정정([기재정정] 등)은 접두어를 떼고 같은 범주로 보되 반복 규칙에 걸러지고, 철회·취소·자회사 공시는 뺀다.
성과: 진입 시가 → 20·60거래일 뒤 종가, KODEX 200 같은 구간 대비 초과. 비용 미반영.
판정: 공시일 거래대금 상위 300. 전체 상장 종목(UNIV)은 참고(화면 안내용 수치).
출력: 표준출력 + .research-cache/disclosure_events_summary.json (화면 표 생성용)

실행: python scripts/research/validate_disclosure_events.py
"""
import bisect, collections, glob, json, os, re, sys
from datetime import date
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import validate_large_cap_trading as lc

vt = lc.vt
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
dates, T, O, Cf, UNIV = vt.dates, vt.T, vt.O, vt.Cf, vt.UNIV
EO, EC = lc.EO, lc.EC
cidx = {c: j for j, c in enumerate(vt.codes)}
GAP = 60

CATS = {
    "dilution": ("희석(유상증자·CB·BW)", r"유상증자결정|전환사채권발행결정|신주인수권부사채권발행결정"),
    "buyback": ("자사주 직접 취득 결정", r"자기주식취득결정\)$"),
    "admin": ("관리종목·상장폐지 사유", r"관리종목지정(?!우려)|형식적상장폐지|상장폐지사유발생"),
    "admin_warn": ("관리종목 지정 우려", r"관리종목지정우려"),
    "review": ("상장적격성 실질심사", r"상장적격성\s*실질심사\s*(대상\s*\(?\s*사유발생|대상\s*결정|대상결정|사유발생|사유추가)"),
    "unfaithful": ("불성실공시법인 지정·예고", r"불성실공시법인\s*지정"),
    "capital_cut": ("감자 결정", r"^주요사항보고서\(감자결정\)$"),
    "audit": ("감사의견 비적정(설)", r"감사의견.*(비적정|거절|한정|부적정)"),
}
EXCLUDE = re.compile(r"철회|취소|자회사|종속회사|미지정|해제|제외|해당되지|해당없음|미해당|신탁")


def load_events():
    ev = collections.defaultdict(list)  # cat -> [(entry_t, j)]
    last = {}
    raw = []
    for f in glob.glob(".research-cache/disclosures/*.json"):
        d = json.load(open(f, encoding="utf-8"))
        j = cidx.get(d.get("stock_code") or "")
        if j is None:
            continue
        for r in d["rows"]:
            name = re.sub(r"\s+", " ", re.sub(r"^\[[^\]]+\]", "", r[1] or "")).strip()
            if EXCLUDE.search(name):
                continue
            for cat, (_, pat) in CATS.items():
                if re.search(pat, name.replace(" (", "(")):
                    raw.append((r[0], j, cat))
    raw.sort()
    for d, j, cat in raw:
        t = bisect.bisect_right(dates, d)  # 접수일 '다음' 거래일
        if t >= T - 1:
            continue
        k = (j, cat)
        if k in last and t - last[k] < GAP:
            continue
        last[k] = t
        ev[cat].append((t, j))
    return ev


def excess(t, j, h):
    x = t + h
    if x >= T or np.isnan(O[t, j]) or O[t, j] <= 0 or np.isnan(Cf[x, j]) or np.isnan(EO[t]) or EO[t] <= 0:
        return np.nan
    return Cf[x, j] / O[t, j] - 1 - (EC[x] / EO[t] - 1)


def base_tail(t, h, mask):
    """같은 날 같은 범위 종목의 h일 초과 −30% 이하 비율(꼬리 기준선)"""
    x = t + h
    if x >= T or np.isnan(EO[t]):
        return np.nan
    r = Cf[x] / O[t] - 1 - (EC[x] / EO[t] - 1)
    r = r[mask & np.isfinite(r)]
    return float(np.mean(r <= -0.30)) if len(r) else np.nan


def main():
    ev = load_events()
    summary = {"generated": date.today().isoformat(), "period": f"{dates[0]}~{dates[-1]}",
               "method": "접수일 다음 거래일 시가 진입, KODEX 200 대비 초과, 비용 미반영, 같은 종목·범주 60거래일 안 반복 1건", "cats": {}}
    for cat, (label, _) in CATS.items():
        print(f"\n[{label}]")
        out = {"label": label}
        for scope in ("top300", "all"):
            res = {}
            for h in (20, 60):
                items = []
                tails, btails = [], []
                for t, j in ev[cat]:
                    if t < 261 or not UNIV[t, j]:
                        continue
                    if scope == "top300" and not lc.topm(t)[j]:
                        continue
                    x = excess(t, j, h)
                    if not np.isfinite(x):
                        continue
                    items.append((dates[t], x))
                    if h == 60:
                        tails.append(x <= -0.30)
                        btails.append(base_tail(t, h, lc.topm(t) if scope == "top300" else UNIV[t]))
                if not items:
                    continue
                r = lc.judge_events(f"{scope} {h}일", items)
                xs = np.array([x for _, x in items])
                res[h] = {"n": len(xs), "mean": float(xs.mean()), "median": float(np.median(xs)),
                          "is": [float(r["안"][0]), float(r["안"][1]), r["안"][2]],
                          "oos": [float(r["밖"][0]), float(r["밖"][1]), r["밖"][2]]}
                if h == 60 and tails:
                    res[h]["tail30"] = float(np.mean(tails))
                    res[h]["tail30_base"] = float(np.nanmean(btails))
                    print(f"    60일 −30% 이하 비율 {np.mean(tails)*100:.1f}% (같은 날 기준선 {np.nanmean(btails)*100:.1f}%)")
            out[scope] = res
        a = out.get("top300", {}).get(20)
        if a:
            is_m, is_t, _ = a["is"]
            os_m, os_t, _ = a["oos"]
            if cat == "buyback":
                ok = is_m > 0 and os_m > 0 and is_t > 2 and os_t > 2
                out["verdict"] = "채택 후보(수익형, 11/23 관문)" if ok else "기각"
            else:
                ok = is_m < 0 and os_m < 0 and is_t < -3 and os_t < -3
                out["verdict"] = "채택(손실 차단형)" if ok else "기각/판정 미달"
            print(f"  → 판정(상위 300·20일): {out['verdict']}")
        summary["cats"][cat] = out
    json.dump(summary, open(".research-cache/disclosure_events_summary.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
