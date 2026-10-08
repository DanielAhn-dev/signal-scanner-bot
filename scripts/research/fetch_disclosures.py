# -*- coding: utf-8 -*-
"""DART 공시 목록 수집 — 손실 차단형 후보 V4(유상증자·전환사채)·V5(자사주 취득)·V6(감사의견·관리종목) 검증 준비.

대상: 거래대금 상위 300에 한 번이라도 든 회사(.research-cache/shares/ 의 corp_code, 상장폐지 포함 약 2,255개).
종류: B(주요사항보고 — 유상증자결정·전환사채권발행결정·자기주식취득결정·감자 등),
      I(거래소공시 — 관리종목지정·상장적격성 실질심사·감사의견 관련·불성실공시 등).
기간: 2015-01-01 ~ 실행일. corp_code를 주면 기간 제한 없이 한 번에 조회된다(2026-10-08 확인).

출력: .research-cache/disclosures/{corp_code}_{B|I}.json
      {"corp_code", "stock_code", "type", "end_de", "status", "rows": [[rcept_dt, report_nm, rcept_no, flr_nm, rm], ...]}
재개 가능(파일이 있으면 건너뜀). 일일 한도(status 020)에 닿으면 멈추고, 다음 날 다시 실행하면 이어서 받는다.
이 데이터로 매매 규칙을 만드는 것은 11/23 관문 뒤 — 지금은 수집만 한다(docs/data-expansion-plan-2026-10-07.md).
"""
import glob, json, os, sys, time, urllib.request
from datetime import date

OUT = ".research-cache/disclosures"
BEGIN = "20150101"
TYPES = ("B", "I")


def load_key() -> str:
    key = os.environ.get("DART_API_KEY", "").strip()
    if not key and os.path.exists(".env"):
        for line in open(".env", encoding="utf-8"):
            if line.startswith("DART_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("DART_API_KEY가 없습니다(.env 또는 환경변수)")
    return key


def get(url: str) -> dict:
    for attempt in range(8):
        try:
            return json.load(urllib.request.urlopen(url, timeout=30))
        except Exception:
            time.sleep(30 * (attempt + 1))  # 연결 차단 시 점점 길게 쉬었다 재시도
    print("연결 실패 반복, 중단", flush=True)
    sys.exit(1)


def main() -> None:
    key = load_key()
    os.makedirs(OUT, exist_ok=True)
    end = date.today().strftime("%Y%m%d")
    stock_by_corp = {c[0]: c[2] for c in json.load(open(".research-cache/corps.json", encoding="utf-8"))}
    targets = sorted({os.path.basename(f).split("_")[0] for f in glob.glob(".research-cache/shares/*.json")})
    print("대상 회사", len(targets), flush=True)
    calls = done = 0
    for cc in targets:
        for ty in TYPES:
            fn = f"{OUT}/{cc}_{ty}.json"
            if os.path.exists(fn):
                continue
            rows, page, status = [], 1, None
            while True:
                d = get(f"https://opendart.fss.or.kr/api/list.json?crtfc_key={key}&corp_code={cc}"
                        f"&bgn_de={BEGIN}&end_de={end}&pblntf_ty={ty}&page_no={page}&page_count=100")
                calls += 1
                status = d.get("status")
                if status == "020":  # 일일 한도 — 이 회사·종류는 저장하지 않아 다음 실행에서 처음부터 받는다
                    print(f"한도 도달(호출 {calls}), 중단 — 내일 다시 실행", flush=True)
                    sys.exit(0)
                for r in d.get("list", []) or []:
                    rows.append([r.get("rcept_dt"), (r.get("report_nm") or "").strip(), r.get("rcept_no"),
                                 r.get("flr_nm"), r.get("rm")])
                time.sleep(0.2)
                if status != "000" or page >= int(d.get("total_page") or 1):
                    break
                page += 1
            if status not in ("000", "013"):  # 013 = 조회 결과 없음(정상)
                print(f"{cc} {ty} 상태 {status} {d.get('message')} — 저장 안 함", flush=True)
                continue
            json.dump({"corp_code": cc, "stock_code": stock_by_corp.get(cc), "type": ty, "end_de": end,
                       "status": status, "rows": rows}, open(fn, "w", encoding="utf-8"), ensure_ascii=False)
        done += 1
        if done % 100 == 0:
            print(f"진행 {done}/{len(targets)} · 호출 {calls}", flush=True)
    print(f"완료 · 호출 {calls}", flush=True)


if __name__ == "__main__":
    main()
