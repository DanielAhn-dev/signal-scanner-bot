# -*- coding: utf-8 -*-
"""
종목 단위 외국인 수급 신호 검증 (2026-10-05). 결론: 채택하지 않음(가격 과열만 쓴다).
데이터: stock_flow_hist.json(fetch_stock_investor_flow.py, 150종목) + px.pkl 수정주가(수익률은 수정주가, 수급 금액은 주식 수 × 당일 실제 가격).
표본: 약 월 1회, ±31% 급변 구간 제외. 기준값은 검증 전에 고정.
  S1 52주 고점 95%+ 이고 외국인 60일 누적 순매수 금액이 그 종목 지난 1년 중 하위 10%
  S2 52주 고점 95%+ 이고 외국인 지분율 60일 -2%p 이상
결과(2017~2025): 60거래일 내 -20% 확률 — 고점 부근 기준 20%, S1 20%, S2 31%(91건), 과열 아님&(S1|S2) 16%,
  과열(A) 40~41%, A&(S1|S2) 47%(64건). S1은 정보 없음, S2·결합은 표본이 작고 방향이 일관되지 않음.
한계: 대상이 현재 살아 있는 대형주라 생존 편향이 있다(기준치끼리의 비교만 의미).
"""
import pickle,json,sys,numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
C='.research-cache/'
x=pickle.load(open(C+'px.pkl','rb')); fh=json.load(open(C+'stock_flow_hist.json'))
H=60
S={}
def add(k,rec): S.setdefault(k,[]).append(rec)
for code,rows in fh.items():
    v=x.get(code)
    if not v or len(rows)<400: continue
    pd={r[0]:r[4] for r in v}
    ds=[d for d in sorted(rows) if d in pd and rows[d][0] and rows[d][2] is not None and rows[d][1] is not None]
    if len(ds)<400: continue
    c=np.array([pd[d] for d in ds],float); raw=np.array([rows[d][0] for d in ds],float)
    fval=np.array([rows[d][2]*rows[d][0] for d in ds],float)   # 외국인 순매수 금액(원) = 주식 수 × 당일 실제 가격
    hr=np.array([rows[d][1] for d in ds],float)
    if (c<=0).any(): continue
    jump=np.abs(np.diff(c)/c[:-1])>0.31
    cs60=np.convolve(fval,np.ones(60),'valid')   # cs60[j] = fval[j..j+59] 합 → 끝 인덱스 j+59
    for i in range(320,len(c)-H,20):
        if jump[i-20:i+H].any(): continue
        y=ds[i][:4]
        near=c[i]>=0.95*c[i-250:i+1].max()
        cur=cs60[i-59]; hist=cs60[i-59-250:i-59]; rank=(hist<cur).mean()
        a=c[i]/c[i-199:i+1].mean()-1>0.6
        s1=near and rank<0.1; s2=near and hr[i]-hr[i-60]<=-2
        rec=(c[i+H]/c[i]-1, c[i:i+H+1].min()/c[i]-1, y)
        add('ALL',rec)
        if near: add('고점부근(기준)',rec)
        if s1: add('S1 고점부근+외국인60일 1년 하위10%',rec)
        if s2: add('S2 고점부근+외국인지분 60일 -2%p',rec)
        if a: add('A 과열',rec)
        if a and (s1 or s2): add('A 과열 & (S1|S2)',rec)
        if a and not (s1 or s2): add('A 과열 & 수급신호 없음',rec)
        if near and not a and (s1 or s2): add('과열 아님 & (S1|S2)',rec)
def show(title,yrs):
    print('==',title)
    for k,L in S.items():
        L=[r for r in L if r[2] in yrs]
        if not L: continue
        f=np.array([r[0] for r in L]); m=np.array([r[1] for r in L])
        print(f'  {k:<30} n={len(L):>5} 60일중앙 {np.median(f):+6.1%} 평균 {f.mean():+6.1%}  -20%확률 {(m<=-0.2).mean():4.0%}  -10%확률 {(m<=-0.1).mean():4.0%}')
show('2017~2025',{str(y) for y in range(2017,2026)})
show('2017~2026',{str(y) for y in range(2017,2027)})
for k in ['S1 고점부근+외국인60일 1년 하위10%','고점부근(기준)']:
    by={}
    for f,m,y in S.get(k,[]): by.setdefault(y,[]).append(m<=-0.1)
    print(k[:10],' '.join(f'{y[2:]}:{np.mean(z):.0%}({len(z)})' for y,z in sorted(by.items())))
