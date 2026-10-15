# -*- coding: utf-8 -*-
"""
H51(V6 재검증): 감사의견 비적정·계속기업 불확실성이 나온 종목은 이후 1년 큰 손실이 잦은가 (2026-10-15).
판정 기준은 hypothesis-ledger.md H51에 결과 보기 전 고정(커밋 후 이 스크립트 작성).
데이터: .research-cache/audit_opinions/ (fetch_audit_opinions.py), disclosures/(회사→종목코드), px.pkl, kospi.json(거래일 달력),
  allweather/kr_069500.json(KODEX 200, 분배금 반영).
출력: .research-cache/audit_opinion_out.txt
"""
import bisect, glob, json, os, pickle, re, sys
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

C = ".research-cache/"
OUT = C + "audit_opinion_out.txt"
H, H_SHORT, ENTRY_WIN, SEVERE, SPLIT_FY = 250, 60, 20, -0.50, 2019
# 보정(측정 후 발견한 데이터 오류): 052670이 2,080원→320,000원처럼 주식 병합이 수정주가에 반영 안 된 경우가 있다.
# 정규 가격제한폭(±30%)을 넘는 하루 상승(+35% 초과)이 창 안에 있으면 범주 구분 없이 뺀다.
# 하락 쪽은 정리매매(제한폭 없음) 손실이라 빼지 않는다. 보정 전 결과도 함께 출력한다.
JUMP = 1.35
lines = []


def say(s=""):
    print(s)
    lines.append(s)


cal = [d for d, _ in json.load(open(C + "kospi.json"))]
bench = {d: c for d, c in json.load(open(C + "allweather/kr_069500.json"))}
px = pickle.load(open(C + "px.pkl", "rb"))
stock_of = {}
for f in glob.glob(C + "disclosures/*_B.json"):
    d = json.load(open(f, encoding="utf-8"))
    if d.get("stock_code"):
        stock_of[d["corp_code"]] = d["stock_code"]

NEG_GC = re.compile(r"계속기업[^/]{0,30}(해당\s*사항\s*없|없음|해당\s*없)")


def offset(label):
    label = label or ""
    if "전전기" in label:
        return 2
    if "전기" in label:
        return 1
    if "당기" in label:
        return 0
    return None


def classify(rows):
    ops = " ".join((r["adt_opinion"] or "").replace(" ", "").replace("\n", "") for r in rows)
    emph = " ".join((r["emphs_matter"] or "") for r in rows)
    if re.search(r"거절|부적정|한정", ops.replace("한정없음", "")):
        return "N"
    if "적정" not in ops:
        return None
    if "계속기업" in emph and not NEG_GC.search(emph.replace("\n", "/")):
        return "G"
    return "B"


# 회사·회계연도별 행 모으기 (당기 > 전기 > 전전기)
events = []
for f in glob.glob(C + "audit_opinions/*.json"):
    corp = os.path.basename(f)[:-5]
    code = stock_of.get(corp)
    if not code or not px.get(code):
        continue
    by_fy = {}
    for y, rows in json.load(open(f, encoding="utf-8")).items():
        for r in rows:
            off = offset(r["bsns_year"])
            if off is None:
                continue
            fy = int(y) - off
            by_fy.setdefault(fy, {}).setdefault(off, []).append(r)
    for fy, offs in by_fy.items():
        if not 2014 <= fy <= 2024:
            continue
        off = min(offs)
        cls = classify(offs[off])
        if cls is None:
            continue
        known = offs[off][0]["rcept_no"][:8] if off == 0 and offs[off][0].get("rcept_no") else f"{fy + 1}0401"
        events.append((corp, code, fy, cls, known))
say(f"사건 후보 {len(events)} (회사·회계연도)")


def series(code):
    rows = px[code]
    return [r[0] for r in rows], {r[0]: (r[1], r[4]) for r in rows}


cache = {}
res = {"N": [], "G": [], "B": []}
jumped = {"N": 0, "G": 0, "B": 0}
skipped = {"N": 0, "G": 0, "B": 0}
for corp, code, fy, cls, known in events:
    if code not in cache:
        cache[code] = series(code)
    ds, val = cache[code]
    k = bisect.bisect_left(cal, known)  # 알게 된 날(또는 그 뒤 첫 거래일)
    if k + H >= len(cal):
        skipped[cls] += 1
        continue
    if cls == "N":
        j = bisect.bisect_left(ds, cal[k]) - 1  # 직전 종가(보유 관점)
        if j < 0:
            skipped[cls] += 1
            continue
        d0, p0 = ds[j], val[ds[j]][1]
    else:
        d0 = None
        for t in range(k + 1, min(k + 1 + ENTRY_WIN, len(cal))):
            v = val.get(cal[t])
            if v and v[0]:
                d0, p0 = cal[t], v[0]
                break
        if d0 is None:
            skipped[cls] += 1
            continue
    s0 = bisect.bisect_left(cal, d0)
    out = {}
    for h in (H, H_SHORT):
        end = cal[min(s0 + h, len(cal) - 1)]
        j = bisect.bisect_right(ds, end) - 1
        cut = ds[-1] < end and ds[-1] < cal[-1]  # 이후 가격이 아예 없음 = 끊김
        p1 = val[ds[j]][1]
        b0 = bench.get(d0) or bench[max(x for x in bench if x <= d0)]
        b1 = bench.get(end) or bench[max(x for x in bench if x <= end)]
        out[h] = (p1 / p0 - 1) - (b1 / b0 - 1)
        if h == H:
            out["cut"] = cut
            i0 = bisect.bisect_left(ds, d0)
            closes = [val[x][1] for x in ds[i0:j + 1]]
            out["jump"] = any(b > a * JUMP for a, b in zip(closes, closes[1:]) if a)
    jumped[cls] += out["jump"]
    res[cls].append((fy, out[H], out[H_SHORT], out["cut"], out["jump"]))

say(f"제외(창 부족·진입 불가): N {skipped['N']} · G {skipped['G']} · 기준 {skipped['B']}")
NAMES = {"N": "N 비적정(보유 관점)", "G": "G 계속기업 불확실성(매매 가능 관점)", "B": "기준 적정(매매 가능 관점)"}


def stats(rows):
    x = np.array([r[1] for r in rows])
    x60 = np.array([r[2] for r in rows])
    cut = np.array([r[3] for r in rows])
    return dict(n=len(x), mean=x.mean(), severe=np.mean(x <= SEVERE), cut=cut.mean(),
                p5=np.percentile(x, 5), med=np.median(x), mean60=x60.mean())


def report(res, title):
    say(f"\n==== {title} ====")
    table = {}
    for nm, sel in (("안(~2018)", lambda fy: fy < SPLIT_FY), ("밖(2019~)", lambda fy: fy >= SPLIT_FY), ("전체", lambda fy: True)):
        say(f"\n[{nm}]")
        for cls in ("N", "G", "B"):
            rows = [r for r in res[cls] if sel(r[0])]
            if not rows:
                say(f"  {NAMES[cls]}: 사건 없음")
                continue
            st = stats(rows)
            table[(nm, cls)] = st
            say(f"  {NAMES[cls]}: {st['n']}건 · 250일 초과 평균 {st['mean']*100:+.1f}% 중앙 {st['med']*100:+.1f}% · −50% 이하 {st['severe']*100:.1f}%"
                f" · 끊김 {st['cut']*100:.1f}% · 하위5% {st['p5']*100:.0f}% · 60일 평균 {st['mean60']*100:+.1f}%")

    say("\n[판정 — H51 사전 기준]")
    verdicts = {}
    for cls in ("G", "N"):
        ok, short = True, False
        for nm in ("안(~2018)", "밖(2019~)"):
            a, b = table.get((nm, cls)), table.get((nm, "B"))
            if not a or a["n"] < 20:
                short = True
                continue
            ratio = a["severe"] / b["severe"] if b["severe"] > 0 else float("inf")
            cond = ratio >= 2 and a["mean"] < b["mean"]
            ok &= cond
            say(f"  {NAMES[cls]} {nm}: 큰 손실 비율 {a['severe']*100:.1f}% vs 기준 {b['severe']*100:.1f}% ({ratio:.1f}배) · 평균 {a['mean']*100:+.1f}% vs {b['mean']*100:+.1f}% → {'충족' if cond else '미달'}")
        verdicts[cls] = "표본 부족 — 보류" if short else ("통과" if ok else "기각")
        say(f"  ⇒ {NAMES[cls]}: {verdicts[cls]}")
    if list(verdicts.values()).count("통과") == 1:
        say("  둘 중 하나만 통과 → '약한 근거'")
    return verdicts


say(f"하루 +35% 초과 불연속 사건: N {jumped['N']} · G {jumped['G']} · 기준 {jumped['B']}")
report(res, "보정 전(사전 등록 그대로)")
final = report({k: [r for r in v if not r[4]] for k, v in res.items()}, "보정 후(가격 불연속 제외) — 판정에 쓰는 결과")
say("  한계: 거래대금 상위 300 이력 회사만, 정리매매 가격이 없으면 손실 과소, 전기·전전기 행 날짜 근사(다음 해 4/1)")

open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
