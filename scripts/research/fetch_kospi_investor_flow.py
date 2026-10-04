# -*- coding: utf-8 -*-
"""
코스피 시장 전체 투자자별 일별 순매수(억원) 수집 → .research-cache/kospi_investor_flow.json (2026-10-05).
  {"YYYYMMDD": [개인, 외국인, 기관] | null}
출처: 네이버 증권 모바일 API /api/index/KOSPI/trend?bizdate= (인증 불필요, 2016-01부터 응답).
  예전 finance.naver.com/sise/investorDealTrendDay.naver 는 410(사라짐).
하루 1회 요청이라 전체(약 2,600일)는 20~30분 걸린다. 이미 받은 날은 건너뛴다.
"""
import json, os, sys, time, urllib.request
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

C = '.research-cache/'
out = C + 'kospi_investor_flow.json'
days = [d for d, _ in json.load(open(C + 'kospi.json')) if d >= '20160101']
res = json.load(open(out)) if os.path.exists(out) else {}


def num(s):
    return int(s.replace(',', '').replace('+', '')) if s not in (None, '') else None


for n, d in enumerate(days):
    if d in res:
        continue
    for _ in range(3):
        try:
            req = urllib.request.Request(f'https://m.stock.naver.com/api/index/KOSPI/trend?bizdate={d}', headers={'User-Agent': 'Mozilla/5.0'})
            j = json.loads(urllib.request.urlopen(req, timeout=15).read())
            res[d] = [num(j['personalValue']), num(j['foreignValue']), num(j['institutionalValue'])] if j.get('bizdate') == d else None
            break
        except Exception:
            time.sleep(2)
    time.sleep(0.12)
    if n % 200 == 0:
        json.dump(res, open(out, 'w')); print(n, d, res.get(d), flush=True)
json.dump(res, open(out, 'w')); print('done', len(res))
