# -*- coding: utf-8 -*-
"""
.research-cache/incoming/ 의 운용사 분배금 엑셀(KODEX .xls, TIGER 'PDF_DATA*.xls'(실제로는 HTML), RISE .xlsx)을
.research-cache/div_<코드>.json({"recordDate": "YYYY-MM-DD", "amount": 원/주, "rate": 분배율% 또는 null})으로 변환한다.
기간은 파일에 들어 있는 만큼(보통 상장 후 2~3년)이다. 보유종목 표(KODEX 금융고배당TOP10 PDF)는 분배금이 아니라 건너뛴다.
"""
import glob, html, json, os, re, sys, zipfile
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import xlrd
INC = ".research-cache/incoming"
KODEX = {"KODEX_200타겟위클리커버드콜": "498400", "KODEX_미국나스닥100데일리커버드콜OTM": "494300", "KODEX_미국배당다우존스타겟커버드콜": "483290"}

def norm(d):
    d = str(d).strip().replace("/", "-")
    if re.fullmatch(r"\d{8}", d): return f"{d[:4]}-{d[4:6]}-{d[6:]}"
    return d

out = {}
for f in sorted(glob.glob(f"{INC}/*")):
    base = os.path.basename(f)
    if base.startswith("KODEX_금융고배당TOP10"):
        print("건너뜀(보유종목 표, 분배금 아님):", base); continue
    rows = []; code = None
    if base.startswith("KODEX_"):
        code = next((c for k, c in KODEX.items() if base.startswith(k)), None)
        sh = xlrd.open_workbook(f).sheet_by_index(0)
        for i in range(sh.nrows):
            r = sh.row_values(i)
            if re.fullmatch(r"\d{8}", str(r[0]).strip()):
                rows.append((norm(r[0]), float(r[3]), float(r[2])))
    elif base.endswith(".xlsx"):
        z = zipfile.ZipFile(f); x = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
        for rw in re.findall(r"<row [^>]*>(.*?)</row>", x, re.S):
            cells = re.findall(r"<c [^>]*?(?:t=\"(\w+)\")?[^>]*>(?:<is><t>([^<]*)</t></is>|<v>([^<]*)</v>)</c>", rw, re.S)
            vals = [(a or b) for _, a, b in cells]
            if vals and re.fullmatch(r"\d{4}-\d{2}-\d{2}", vals[0]):
                rows.append((vals[0], float(vals[2]), float(vals[4])))
        code = "475720"  # RISE 200위클리커버드콜 (파일명 44G3은 운용사 내부 코드)
    elif base.startswith("PDF_DATA"):
        t = open(f, encoding="utf-8", errors="replace").read()
        for rw in re.findall(r"<tr>(.*?)</tr>", t, re.S):
            c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", rw, re.S)]
            if len(c) >= 6 and re.fullmatch(r"KR7\d{9}", c[1]):
                code = c[1][3:9]; rows.append((c[3], float(c[5].replace(",", "")), None))
    if not code or not rows:
        print("처리 못 함:", base); continue
    out.setdefault(code, {}).update({d: (a, r) for d, a, r in rows})
for code, d in sorted(out.items()):
    items = [{"recordDate": k, "amount": v[0], "rate": v[1]} for k, v in sorted(d.items())]
    json.dump(items, open(f".research-cache/div_{code}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{code}: {len(items)}건 {items[0]['recordDate']}~{items[-1]['recordDate']}  최근 {items[-1]['amount']:.0f}원 / 평균 {sum(i['amount'] for i in items)/len(items):.0f}원")
