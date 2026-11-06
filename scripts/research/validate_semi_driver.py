# -*- coding: utf-8 -*-
"""코스피 하락의 반도체(SOX·삼성전자·SK하이닉스) 연동 확인 (2026-11-06, 설명용). 입력: .research-cache/{ks11_all,sox_all,samsung,hynix,ixic,gspc_1950}.json"""
import datetime as D, json, statistics as S
def ld(n):
    r = json.load(open(".research-cache/" + n + ".json"))
    return {(D.datetime(1970,1,1)+D.timedelta(seconds=t)).date(): c for t, c in r}
ser = {k: ld(v) for k, v in [("코스피","ks11_all"),("SOX","sox_all"),("삼성전자","samsung"),("SK하이닉스","hynix"),("나스닥","ixic"),("S&P500","gspc_1950")]}
START = D.date(2026,1,1); ELEC = D.date(2026,11,3)
print("== 2026년 고점·현재·선거일 ==")
for k, s in ser.items():
    ds = sorted(d for d in s if d >= START)
    pk = max(ds, key=lambda d: s[d]); last = ds[-1]
    el = max(d for d in ds if d <= ELEC)
    print(f"{k}: 고점 {pk} → 현재 {last} {(s[last]/s[pk]-1)*100:.1f}% | 고점→선거일 {(s[el]/s[pk]-1)*100:.1f}% 선거일→현재 {(s[last]/s[el]-1)*100:.1f}% | 연초 대비 현재 {(s[last]/s[ds[0]]-1)*100:.0f}%")
print("\n== 월별 종가 지수화(2026-01-02=100) ==")
base = {k: s[min(d for d in s if d >= START)] for k, s in ser.items()}
ms = sorted({(d.year,d.month) for d in ser["코스피"] if d >= START})
for y, m in ms:
    row = []
    for k in ("코스피","삼성전자","SK하이닉스","SOX"):
        s = ser[k]; d = max(x for x in s if (x.year,x.month)==(y,m))
        row.append(f"{k} {s[d]/base[k]*100:5.0f}")
    print(f"{y}-{m:02d}  " + "  ".join(row))
print("\n== 일별 수익률 상관(2026-06-22 이후, 한국장 다음날 보정 없음/있음) ==")
ks = sorted(d for d in ser["코스피"] if d >= D.date(2026,6,22))
def r(k, d0, d1): return ser[k][d1]/ser[k][d0]-1
for other in ("SOX","삼성전자","SK하이닉스","나스닥","S&P500"):
    xs, ys, ys_lag = [], [], []
    for a, b in zip(ks, ks[1:]):
        xs.append(r("코스피", a, b))
        if other in ("삼성전자","SK하이닉스"):
            if a in ser[other] and b in ser[other]: ys.append(r(other, a, b))
            else: xs.pop()
        else:
            us = sorted(d for d in ser[other])
            # 미국 전일(한국 날짜 b 이전 마지막 두 거래일) 수익률 → 코스피 b 수익률 선행 상관
            prev = [d for d in us if d < b]
            if len(prev) >= 2: ys.append(ser[other][prev[-1]]/ser[other][prev[-2]]-1)
            else: xs.pop()
    mx, my = S.mean(xs), S.mean(ys)
    c = sum((x-mx)*(y-my) for x,y in zip(xs,ys))/((sum((x-mx)**2 for x in xs)*sum((y-my)**2 for y in ys))**.5)
    print(f"코스피 vs {other}{'(전날 미국장)' if other in ('SOX','나스닥','S&P500') else ''}: n={len(xs)} 상관 {c:.2f}")
