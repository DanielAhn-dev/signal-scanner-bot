# -*- coding: utf-8 -*-
"""
채택한 매매 규칙의 분기 재검증 (생존편향 없는 데이터).

규칙을 새로 "맞추는" 스크립트가 아니다. 이미 채택한 규칙이 새 데이터에서도 여전히 통하는지
미리 정한 기준으로 확인하고, 약해진 규칙을 알린다. 기준은 아래 CHECKS 설명에 고정돼 있다.

데이터 (모두 무료, 로컬 캐시 --cache 폴더):
  - DART 분기 재무(fnlttMultiAcnt): 발표일(rcept_no 앞 8자리) 기준으로만 사용 → 미래 정보 누수 없음
    DART는 2015년 분기 자료가 없어 최근 4분기 합산은 2017-04부터 가능
  - 네이버 수정주가(siseJson): 상장폐지 종목 포함 (DART 고유번호 목록의 모든 종목코드)
  - 야후 KOSPI 지수(1997~)

검사 (근거: 2026-09-28 검증):
  C1 실적 관문 통과 종목 — 전 종목 평균 대비 월 초과수익 > 0, t >= 2. 최근 3년만 따로 봐서 0 이하면 경고
  C2 최근 4분기 적자 종목 — 전 종목 평균 대비 월 초과수익 < 0, t <= -2
  C3 코스피 50일선 규칙 — 전체(1997~)와 최근 10년 모두 최대 낙폭이 계속 보유보다 작고,
     연수익이 계속 보유보다 1%p 넘게 뒤지지 않음
  C4 봇 매도 규칙 — 6개월 추적에서 평균/표준편차가 계속 보유 이상이고, 최악 5% 손실이 더 작음

사용:
  python scripts/research/revalidate_rules.py                     # 다운로드(캐시 재사용) + 검사
  python scripts/research/revalidate_rules.py --refresh           # 캐시를 지우고 전부 새로 받기
  python scripts/research/revalidate_rules.py --telegram          # 결과를 TELEGRAM_ADMIN_CHAT_ID로 전송
환경변수: DART_API_KEY (필수), TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID (선택)

주의: DART는 병렬 호출을 하면 연결을 끊는다 — 순차 호출만 한다.
"""
from __future__ import annotations

import argparse
import ast
import bisect
import collections
import glob
import io
import json
import os
import pickle
import re
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

QN = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}
REGIMES = [("18↓", "2018", "2018"), ("19", "2019", "2019"), ("20", "2020", "2020"), ("21", "2021", "2021"),
           ("22↓", "2022", "2022"), ("23-24", "2023", "2024"), ("25-26", "2025", "2026")]


def load_env(path: str = ".env") -> None:
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


def http_get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()


# ── 1. 데이터 수집 ─────────────────────────────────────────────

def download_corps(cache: str, key: str) -> list:
    path = f"{cache}/corps.json"
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    raw = http_get(f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={key}", 120)
    xml = zipfile.ZipFile(io.BytesIO(raw)).read("CORPCODE.xml").decode("utf-8")
    corps = []
    for blk in re.findall(r"<list>(.*?)</list>", xml, re.S):  # <list> 단위로 잘라야 코드가 섞이지 않는다
        sc = re.search(r"<stock_code>(\d{6})</stock_code>", blk)
        if not sc:
            continue
        corps.append((re.search(r"<corp_code>(\d+)</corp_code>", blk).group(1),
                      re.search(r"<corp_name>(.*?)</corp_name>", blk).group(1), sc.group(1)))
    json.dump(corps, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return corps


def download_financials(cache: str, key: str, corps: list) -> None:
    os.makedirs(f"{cache}/fin", exist_ok=True)
    codes = [c[0] for c in corps]
    this_year = date.today().year
    for year in range(2015, this_year + 1):
        for rep in ["11013", "11012", "11014", "11011"]:
            for b in range(0, len(codes), 100):
                fn = f"{cache}/fin/{year}_{rep}_{b}.json"
                # 지난 해 이전 파일은 재사용, 올해·작년은 새 공시가 붙을 수 있어 다시 받는다
                if os.path.exists(fn) and year < this_year - 1:
                    continue
                url = (f"https://opendart.fss.or.kr/api/fnlttMultiAcnt.json?crtfc_key={key}"
                       f"&corp_code={','.join(codes[b:b + 100])}&bsns_year={year}&reprt_code={rep}")
                data = None
                for _ in range(3):
                    try:
                        data = json.loads(http_get(url).decode("utf-8"))
                        break
                    except Exception:
                        time.sleep(5)
                if data is None:
                    continue
                if data["status"] == "020":
                    raise SystemExit("DART 일일 호출 한도 초과 — 내일 --cache 그대로 다시 실행")
                if data["status"] not in ("000", "013"):
                    raise SystemExit(f"DART 오류 {data['status']} {data.get('message')}")
                json.dump(data.get("list", []), open(fn, "w", encoding="utf-8"), ensure_ascii=False)
                time.sleep(0.2)
        print(f"  DART {year} 완료", flush=True)


def download_prices(cache: str, corps: list) -> None:
    today = date.today().strftime("%Y%m%d")

    def get(code: str):
        url = (f"https://api.finance.naver.com/siseJson.naver?symbol={code}&requestType=1"
               f"&startTime=20140101&endTime={today}&timeframe=day")
        for _ in range(3):
            try:
                rows = ast.literal_eval(http_get(url, 15).decode("utf-8", "replace").strip())[1:]
                return code, [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows if r[4]]
            except Exception:
                time.sleep(1)
        return code, []

    with ThreadPoolExecutor(8) as ex:
        px = dict(ex.map(get, [c[2] for c in corps]))
    pickle.dump(px, open(f"{cache}/px.pkl", "wb"))
    print(f"  가격 {sum(1 for v in px.values() if v)}종목", flush=True)


def download_kospi(cache: str) -> None:
    now = int(time.time())
    d = json.loads(http_get(f"https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?period1=0&period2={now}&interval=1d"))
    res = d["chart"]["result"][0]
    ts, closes = res["timestamp"], res["indicators"]["quote"][0]["close"]
    rows = [(datetime.utcfromtimestamp(t).strftime("%Y%m%d"), c) for t, c in zip(ts, closes) if c]
    json.dump(rows, open(f"{cache}/kospi.json", "w"))
    print(f"  KOSPI {rows[0][0]}~{rows[-1][0]}", flush=True)


# ── 2. 재무 정리 ─────────────────────────────────────────────

def parse_financials(cache: str) -> dict:
    def num(v):
        try:
            return float(str(v).replace(",", ""))
        except Exception:
            return None

    raw = collections.defaultdict(dict)
    for f in glob.glob(f"{cache}/fin/*.json"):
        for r in json.load(open(f, encoding="utf-8")):
            k = (r["stock_code"], int(r["bsns_year"]), QN[r["reprt_code"]])
            e = raw[k].setdefault(r["fs_div"], {"rcept": r["rcept_no"][:8], "a": {}})
            nm = r["account_nm"].replace(" ", "")
            if nm.startswith("당기순이익"):
                nm = "NI"
            if nm not in e["a"]:  # 첫 행(전체 순이익)을 쓴다
                e["a"][nm] = num(r.get("thstrm_amount"))
    out = collections.defaultdict(list)
    for (code, y, q), v in raw.items():
        fs = "CFS" if "CFS" in v else "OFS"
        a = v[fs]["a"]
        out[code].append(dict(y=y, q=q, rcept=v[fs]["rcept"], fs=fs, op=a.get("영업이익"), ni=a.get("NI"),
                              eq=a.get("자본총계")))
    for L in out.values():  # Q4 분기값 = 연간 - (Q1+Q2+Q3)
        L.sort(key=lambda r: (r["y"], r["q"]))
        idx = {(r["y"], r["q"]): r for r in L}
        for r in L:
            for f in ("op", "ni"):
                r[f + "_q"] = r[f] if r["q"] < 4 else None
                if r["q"] == 4 and r[f] is not None:
                    qs = [idx.get((r["y"], i)) for i in (1, 2, 3)]
                    if all(x and x[f] is not None and x["fs"] == r["fs"] for x in qs):
                        r[f + "_q"] = r[f] - sum(x[f] for x in qs)
    return out


# ── 3. 월말 패널 ─────────────────────────────────────────────

def build_panel(px: dict, fin: dict, names: dict):
    codes = [c for c, v in px.items() if len(v) > 60 and not any(k in names.get(c, "") for k in ("스팩", "기업인수목적"))]
    dates = sorted({r[0] for c in codes for r in px[c]})
    di = {d: i for i, d in enumerate(dates)}
    T, N = len(dates), len(codes)
    C = np.full((T, N), np.nan)
    TV = np.full((T, N), np.nan)
    for j, c in enumerate(codes):
        for r in px[c]:
            i = di[r[0]]
            C[i, j] = r[4]
            TV[i, j] = r[4] * r[5]
    first = np.argmax(~np.isnan(C), axis=0)
    last = T - 1 - np.argmax(~np.isnan(C[::-1]), axis=0)
    Cf = C.copy()
    for j in range(N):  # 거래정지 구간은 직전가, 상장폐지 뒤는 마지막 가격(그 가격에 청산)
        v = np.nan
        for i in range(first[j], T):
            if i <= last[j] and not np.isnan(Cf[i, j]):
                v = Cf[i, j]
            else:
                Cf[i, j] = v
    me = [i for i in range(T - 1) if dates[i][:6] != dates[i + 1][:6] and dates[i] >= "20170428"]
    fin_sorted = {c: sorted(fin.get(c, []), key=lambda r: r["rcept"]) for c in codes}
    rows = []
    for k, i in enumerate(me):
        d = dates[i]
        nx = me[k + 1] if k + 1 < len(me) else None
        for j, c in enumerate(codes):
            if not (first[j] + 250 <= i <= last[j]) or np.isnan(C[i, j]) or nx is None:
                continue
            tv = np.nanmean(TV[i - 19:i + 1, j])
            if not tv or tv < 1e9:  # 20일 평균 거래대금 10억 이상
                continue
            L = fin_sorted[c]
            n_avail = bisect.bisect_left([r["rcept"] for r in L], d)
            avail = {(r["y"], r["q"]): r for r in L[:n_avail]}
            feat = dict(t=i, d=d, code=c, p=Cf[i, j], fnx=Cf[nx, j] / Cf[i, j] - 1)
            if avail:
                y, q = max(avail)
                stale = (int(d[:4]) - y) * 4 + (int(d[4:6]) - 1) // 3 + 1 - q

                def back(n, y=y, q=q):
                    for _ in range(n):
                        q -= 1
                        if q == 0:
                            y, q = y - 1, 4
                    return avail.get((y, q))

                last4 = [back(m) for m in range(4)]
                ni_ttm = sum(x["ni_q"] for x in last4) if all(x and x.get("ni_q") is not None for x in last4) else None
                cur, ya = back(0), back(4)
                opg_q = ((cur["op_q"] - ya["op_q"]) / abs(ya["op_q"])
                         if ya and cur.get("op_q") is not None and ya.get("op_q") else None)
                feat.update(stale=stale, ni_ttm=ni_ttm, opg_q=opg_q)
            rows.append(feat)
    return rows, dates, Cf, codes


# ── 4. 검사 ─────────────────────────────────────────────

def regime_signs(values_by_date: dict) -> str:
    out = []
    for _, a, b in REGIMES:
        v = [x for d, x in values_by_date.items() if a <= d[:4] <= b]
        if v:
            out.append("+" if np.mean(v) > 0 else "-")
    return "".join(out)


def screen_excess(rows, cond, since="20180427"):
    bym = collections.defaultdict(list)
    for r in rows:
        if r["d"] >= since:
            bym[r["d"]].append(r)
    ex = {}
    for d, L in bym.items():
        s = [r["fnx"] for r in L if cond(r)]
        if len(s) >= 5:
            ex[d] = np.mean(s) - np.mean([r["fnx"] for r in L])
    v = np.array(list(ex.values()))
    t = v.mean() / (v.std() / np.sqrt(len(v))) if len(v) > 1 and v.std() > 0 else 0.0
    return v.mean() if len(v) else 0.0, t, ex


def kospi_rule(kospi, since):
    d = [x[0] for x in kospi]
    c = np.array([x[1] for x in kospi], float)
    i0 = max(51, bisect.bisect_left(d, since))
    eq = eh = pk = pkh = 1.0
    mdd = mddh = 0.0
    cd = 0.025 / 252
    for i in range(i0, len(c) - 1):
        on = c[i] > c[i - 50:i].mean()
        r = c[i + 1] / c[i] - 1
        eq *= (1 + r) if on else (1 + cd)
        eh *= 1 + r
        pk, pkh = max(pk, eq), max(pkh, eh)
        mdd, mddh = min(mdd, eq / pk - 1), min(mddh, eh / pkh - 1)
    yrs = (len(c) - 1 - i0) / 252
    return eq ** (1 / yrs) - 1, mdd, eh ** (1 / yrs) - 1, mddh


def exit_rules_check(rows, px, dates):
    """관문 통과 종목을 월말에 사서 126거래일 추적 — 봇 매도 규칙 vs 그냥 보유"""
    di = {d: i for i, d in enumerate(dates)}
    ser = {}

    def s(code):
        if code not in ser:
            rr = [r for r in px[code] if r[0] in di]
            ser[code] = (np.array([di[r[0]] for r in rr]), np.array([r[2] for r in rr], float),
                         np.array([r[3] for r in rr], float), np.array([r[4] for r in rr], float))
        return ser[code]

    def lock(pg, g):
        if pg < 8:
            return False
        return g <= pg * (0.65 if pg >= 25 else 0.55 if pg >= 15 else 0.4)

    hold, bot = [], []
    for r in rows:
        if r["d"] < "20180427" or r.get("stale", 9) > 2 or (r.get("ni_ttm") or -1) <= 0 or (r.get("opg_q") or -1) <= 0:
            continue
        idx, h, l, c = s(r["code"])
        k0 = np.searchsorted(idx, r["t"])
        if k0 >= len(idx) or idx[k0] != r["t"] or k0 < 15:
            continue
        buy = c[k0]
        end = r["t"] + 126
        kend = np.searchsorted(idx, end, side="right") - 1
        if end > len(dates) - 1 or kend <= k0:
            continue  # 아직 6개월이 안 지난 진입 제외 (상장폐지 종목은 마지막 거래가로 청산)
        hold.append(c[kend] / buy - 1)
        tr = np.maximum(h[k0 - 13:k0 + 1] - l[k0 - 13:k0 + 1],
                        np.maximum(abs(h[k0 - 13:k0 + 1] - c[k0 - 14:k0]), abs(l[k0 - 13:k0 + 1] - c[k0 - 14:k0])))
        stop = max(4, min(10, 2.2 * tr.mean() / buy * 100))
        pos, realized, tranches, peak, half_done = 1.0, 0.0, 0, buy, False
        k = k0
        while k < kend:
            k += 1
            g = (c[k] / buy - 1) * 100
            peak = max(peak, c[k])
            pg = (peak / buy - 1) * 100
            days = idx[k] - r["t"]
            sell = 0.0
            if g <= -10:
                sell = pos
            elif g <= -7 and stop > 7 and not half_done:
                sell, half_done = pos / 2, True
            elif g <= -stop:
                sell = pos
            elif lock(pg, g):
                sell = pos
            elif g >= 8:
                sell = pos if tranches >= 1 else pos / 2
                tranches += 1
            if sell > 0:
                realized += sell * (c[k] / buy) * (1 + 0.025 / 252 * (126 - days))
                pos -= sell
                if pos <= 1e-9:
                    break
        if pos > 1e-9:
            realized += pos * c[kend] / buy
        bot.append(realized - 1)
    h, b = np.array(hold), np.array(bot)
    return dict(n=len(h), hold_mean=h.mean(), hold_sd=h.std(), hold_p5=np.percentile(h, 5),
                bot_mean=b.mean(), bot_sd=b.std(), bot_p5=np.percentile(b, 5))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=".research-cache")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--telegram", action="store_true")
    args = ap.parse_args()
    load_env()
    key = os.environ.get("DART_API_KEY")
    if not key:
        raise SystemExit("DART_API_KEY 필요")
    cache = args.cache
    if args.refresh and os.path.isdir(cache):
        import shutil
        shutil.rmtree(cache)
    os.makedirs(cache, exist_ok=True)

    print("1) 데이터 수집", flush=True)
    corps = download_corps(cache, key)
    download_financials(cache, key, corps)
    download_prices(cache, corps)
    download_kospi(cache)

    print("2) 패널 구성", flush=True)
    px = pickle.load(open(f"{cache}/px.pkl", "rb"))
    fin = parse_financials(cache)
    names = {c[2]: c[1] for c in corps}
    rows, dates, _, _ = build_panel(px, fin, names)
    kospi = json.load(open(f"{cache}/kospi.json"))
    print(f"  월말 관측 {len(rows)} · {dates[0]}~{dates[-1]}", flush=True)

    fresh = lambda r: r.get("stale", 9) <= 2
    gate = lambda r: fresh(r) and (r.get("ni_ttm") or -1) > 0 and (r.get("opg_q") or -1) > 0
    loss = lambda r: fresh(r) and r.get("ni_ttm") is not None and r["ni_ttm"] < 0
    recent = f"{int(dates[-1][:4]) - 3}{dates[-1][4:]}"

    lines, ok_all = [], True

    m, t, ex = screen_excess(rows, gate)
    m3, t3, _ = screen_excess(rows, gate, since=recent)
    c1 = m > 0 and t >= 2
    ok_all &= c1
    lines.append(f"{'✅' if c1 else '⚠️'} C1 실적 관문 통과: 평균 대비 월 {m*100:+.2f}% (t={t:.1f}) 장세 {regime_signs(ex)}"
                 f" · 최근 3년 월 {m3*100:+.2f}% (t={t3:.1f}){'' if m3 > 0 else ' ← 최근 약해짐'}")

    m, t, ex = screen_excess(rows, loss)
    c2 = m < 0 and t <= -2
    ok_all &= c2
    lines.append(f"{'✅' if c2 else '⚠️'} C2 적자 종목: 평균 대비 월 {m*100:+.2f}% (t={t:.1f}) 장세 {regime_signs(ex)}")

    c3_ok = True
    for label, since in (("1997~", "19970101"), ("최근 10년", f"{int(dates[-1][:4]) - 10}{dates[-1][4:]}")):
        rc, rm, hc, hm = kospi_rule(kospi, since)
        ok = rm > hm and rc >= hc - 0.01
        c3_ok &= ok
        lines.append(f"{'✅' if ok else '⚠️'} C3 코스피 50일선 {label}: 규칙 연 {rc*100:.1f}%·낙폭 {rm*100:.0f}% vs 보유 연 {hc*100:.1f}%·낙폭 {hm*100:.0f}%")
    ok_all &= c3_ok

    e = exit_rules_check(rows, px, dates)
    c4 = e["bot_mean"] / e["bot_sd"] >= e["hold_mean"] / e["hold_sd"] and e["bot_p5"] > e["hold_p5"]
    ok_all &= c4
    lines.append(f"{'✅' if c4 else '⚠️'} C4 봇 매도 규칙(6개월, {e['n']}건): 평균 {e['bot_mean']*100:+.1f}%·최악5% {e['bot_p5']*100:.0f}%·평균/편차 {e['bot_mean']/e['bot_sd']:.2f}"
                 f" vs 보유 {e['hold_mean']*100:+.1f}%·{e['hold_p5']*100:.0f}%·{e['hold_mean']/e['hold_sd']:.2f}")

    head = f"[분기 규칙 재검증] 데이터 {dates[-1]}까지 · {'모든 규칙 유효' if ok_all else '약해진 규칙 있음 — 확인 필요'}"
    report = "\n".join([head, *lines, "", "규칙을 새로 맞추지 않습니다. ⚠️ 항목은 원인을 확인한 뒤 퇴출 여부를 정합니다."])
    print("\n" + report)
    open(f"{cache}/report_{dates[-1]}.txt", "w", encoding="utf-8").write(report)

    if args.telegram:
        token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
        if token and chat:
            body = json.dumps({"chat_id": chat, "text": report}).encode("utf-8")
            urllib.request.urlopen(urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage", data=body,
                headers={"content-type": "application/json"}), timeout=20)
        else:
            print("TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID 없음 — 전송 생략")


if __name__ == "__main__":
    main()
