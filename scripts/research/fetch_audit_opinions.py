# -*- coding: utf-8 -*-
"""
V6(감사의견 비적정·계속기업 불확실성 전후 회피) 검증용 감사의견 이력 수집 (2026-10-15).
  .research-cache/audit_opinions/{corp_code}.json  {"YYYY": [{"bsns_year", "adt_opinion", "emphs_matter", "adtor", "rcept_no", "stlm_dt"}...]}
대상: disclosures/ 에 있는 회사(거래대금 상위 300에 한 번이라도 든 2,255곳, 상장폐지 포함).
출처: DART 정기보고서 주요정보 accnutAdtorNmNdAdtOpinion(사업보고서 11011). 보고서 1건에 당기·전기·전전기가 들어 있어
  2016·2018·2020·2022·2024·2025 사업연도만 요청해도 2014~2025를 겹쳐 덮는다(회사당 6회, 일일 한도 2만 회 안).
한계: 의견거절을 받고 바로 상장폐지된 회사는 그 해 사업보고서가 없을 수 있다 → 공시 목록의
  '감사보고서제출'·'상장폐지결정'·'반기검토의견부적정…' 공시와 함께 본다.
이미 받은 (회사, 연도)는 건너뛰므로 한도에 걸리면(status 020) 다음 날 그대로 다시 실행한다.
"""
import glob, json, os, sys, time, urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT = ".research-cache/audit_opinions"
YEARS = ["2016", "2018", "2020", "2022", "2024", "2025"]
KEEP = ("bsns_year", "adt_opinion", "emphs_matter", "adtor", "rcept_no", "stlm_dt")


def dart_key():
    if os.environ.get("DART_API_KEY"):
        return os.environ["DART_API_KEY"]
    for line in open(".env", encoding="utf-8"):
        if line.startswith("DART_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("DART_API_KEY 필요")


def main():
    key = dart_key()
    os.makedirs(OUT, exist_ok=True)
    corps = sorted({os.path.basename(f).split("_")[0] for f in glob.glob(".research-cache/disclosures/*_B.json")})
    calls = 0
    for n, corp in enumerate(corps):
        fn = f"{OUT}/{corp}.json"
        res = json.load(open(fn, encoding="utf-8")) if os.path.exists(fn) else {}
        todo = [y for y in YEARS if y not in res]
        for y in todo:
            url = (f"https://opendart.fss.or.kr/api/accnutAdtorNmNdAdtOpinion.json?crtfc_key={key}"
                   f"&corp_code={corp}&bsns_year={y}&reprt_code=11011")
            data = None
            for _ in range(3):
                try:
                    data = json.loads(urllib.request.urlopen(url, timeout=30).read().decode("utf-8"))
                    break
                except (OSError, ValueError):
                    time.sleep(5)
            calls += 1
            if data is None:
                continue  # 다음 실행 때 다시 받는다
            if data["status"] == "020":
                json.dump(res, open(fn, "w", encoding="utf-8"), ensure_ascii=False)
                raise SystemExit(f"DART 일일 한도 — {n}/{len(corps)}곳에서 멈춤, 내일 다시 실행")
            if data["status"] not in ("000", "013"):
                raise SystemExit(f"DART 오류 {data['status']} {data.get('message')}")
            res[y] = [{k: r.get(k) for k in KEEP} for r in data.get("list", [])]
            time.sleep(0.15)
        if todo:
            json.dump(res, open(fn, "w", encoding="utf-8"), ensure_ascii=False)
        if n % 200 == 0:
            print(f"  {n}/{len(corps)} 호출 {calls}", flush=True)
    print(f"완료 {len(corps)}곳, 이번 호출 {calls}")


if __name__ == "__main__":
    main()
