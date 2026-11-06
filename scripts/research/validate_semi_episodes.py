# -*- coding: utf-8 -*-
"""코스피 큰 하락 사건별 반도체 동조 (2026-11-06, 설명용). 입력: ks11_all, sox_all, samsung, hynix, ixic, gspc_1950 (.research-cache)"""
import datetime as D, json
def ld(n):
    return {(D.datetime(1970,1,1)+D.timedelta(seconds=t)).date(): c for t, c in json.load(open(f".research-cache/{n}.json"))}
S = {k: ld(v) for k, v in [("코스피","ks11_all"),("삼성전자","samsung"),("SK하이닉스","hynix"),("SOX","sox_all"),("나스닥","ixic"),("S&P500","gspc_1950")]}
kd = sorted(S["코스피"])
def near(s, d, before=True):
    ds = sorted(x for x in s if (x <= d if before else x >= d))
    return (ds[-1] if before else ds[0]) if ds else None
def chg(k, a, b):
    s = S[k]; x, y = near(s, a), near(s, b)
    return (s[y]/s[x]-1)*100 if x and y and (a - x).days < 10 and (y - b).days > -10 else float("nan")
# 코스피 -20% 이상 하락 사건(2001-09~): 고점은 직전 52주 최고, 사건 간 독립 = 이전 저점 이후 새 고점
ev, pk = [], kd[0]
for d in kd:
    if S["코스피"][d] > S["코스피"][pk]: pk = d
    elif S["코스피"][d]/S["코스피"][pk]-1 <= -0.20 and (not ev or ev[-1][0] != pk):
        tr = min((x for x in kd if pk <= x <= pk + D.timedelta(days=500)), key=lambda x: S["코스피"][x])
        ev.append((pk, tr))
print("사건: 코스피 고점→저점 / 같은 기간 삼성·하이닉스·SOX·나스닥·S&P500 변화(%) / SOX 고점일 (코스피 고점 ±60일 내)")
for pk, tr in ev:
    row = {k: chg(k, pk, tr) for k in S}
    w = [x for x in S["SOX"] if abs((x-pk).days) <= 90]
    sp = max(w, key=lambda x: S["SOX"][x]) if w else None
    print(f"{pk}→{tr} 코스피 {row['코스피']:.0f} | 삼성 {row['삼성전자']:.0f} 하이닉스 {row['SK하이닉스']:.0f} SOX {row['SOX']:.0f} 나스닥 {row['나스닥']:.0f} S&P {row['S&P500']:.0f} | SOX 고점 {sp}")
