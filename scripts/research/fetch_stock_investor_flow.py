# -*- coding: utf-8 -*-
"""
종목별 외국인·기관·개인 순매수(주)와 외국인 지분율 수집 → .research-cache/stock_flow_hist.json (2026-10-05).
대상: px.pkl에서 2026-09 이후에도 거래되고 최근 500일 거래대금 상위 150종목(현재 살아 있는 대형주 → 생존 편향 있음).
출처: 네이버 증권 모바일 API /api/stock/{code}/trend?pageSize=60&bizdate= (60일씩 과거로, 2016~). 행: [가격(수정 안 됨), 외국인지분율, 외국인, 기관, 개인]
약 1시간 걸린다. 이미 받은 종목은 건너뛴다.
"""
import pickle,json,urllib.request,time,os,sys,numpy as np
sys.stdout.reconfigure(encoding='utf-8')
C='.research-cache/'
x=pickle.load(open(C+'px.pkl','rb'))
tv=[]
for k,v in x.items():
    if len(v)>2000 and v[-1][0]>='20260901':
        tv.append((np.mean([r[4]*r[5] for r in v[-500:]]),k))
codes=[k for _,k in sorted(tv,reverse=True)[:150]]
out=C+'stock_flow_hist.json'
res=json.load(open(out)) if os.path.exists(out) else {}
def num(s):
    try: return float(s.replace(',','').replace('+','').replace('%',''))
    except Exception: return None
for n,c in enumerate(codes):
    if c in res: continue
    rows={};bd='20261005'
    while bd>'20160101':
        j=None
        for t in range(3):
            try: j=json.loads(urllib.request.urlopen(urllib.request.Request(f'https://m.stock.naver.com/api/stock/{c}/trend?pageSize=60&bizdate={bd}',headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read()); break
            except Exception: time.sleep(3)
        if not j: break
        for r in j: rows[r['bizdate']]=[num(r['closePrice']),num(r['foreignerHoldRatio']),num(r['foreignerPureBuyQuant']),num(r['organPureBuyQuant']),num(r['individualPureBuyQuant'])]
        nb=min(r['bizdate'] for r in j)
        if nb>=bd: break
        bd=nb; time.sleep(0.15)
    res[c]=rows
    if n%10==0: json.dump(res,open(out,'w')); print(n,c,len(rows),min(rows) if rows else None,flush=True)
json.dump(res,open(out,'w')); print('done',len(res))
