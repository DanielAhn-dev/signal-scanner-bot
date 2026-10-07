# -*- coding: utf-8 -*-
"""
H22 공모주 균등배정을 상장 첫날 시초가에 팔면 손실 확률이 낮은 부수입인가 (2026-10-07).
데이터: 38커뮤니케이션 신규상장 표(.research-cache/ipo/ipo_38.json; 종목·상장일·공모가·시초가·첫날 종가 등, 2022-01~2026-10-01 상장 520건).
       시장 구분: 코스피 상장은 이름 뒤에 '(유가)'가 붙는 표기를 따른다. 스팩(SPAC)은 이름에 '스팩'이 들어간 종목으로 따로 본다.
기준: 2023-06-26 이후 상장(첫날 가격 범위가 공모가의 60~400%로 넓어진 뒤) 일반 기업. 균등배정 1계좌 1주를 시초가에 매도한다고 본다.
사전 판정 기준(결과 보기 전 고정):
  ① 공모가 대비 시초가 손실 종목 비율 < 20%
  ② 연 기대 수익(수수료·세금 차감, 1계좌 1주 × 연 상장 건수) > 0
  ③ 코스피가 내린 분기만 모아도 건당 평균이 양수
세 가지를 모두 만족하면 안내 채택.
비용 가정(출처 미확인, 증권사별로 다름): 청약 수수료 건당 2,000~5,000원, 매도 시 거래세·수수료 합 0.2%. 증거금 이자는 수천 원 미만이라 제외.
한계: 균등배정 주수는 공모 규모·경쟁률에 따라 1~10주+로 달라 이 자료에는 없다(주수 비례로 보면 됨). 시초가에 실제로 체결된다고 가정. 이 표본은 공모주 청약 열기 강한 시기(2023~2026)로 편향될 수 있다.
"""
import json, re, sys
import numpy as np
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
rows = json.load(open(".research-cache/ipo/ipo_38.json", encoding="utf-8"))


def num(x):
    x = x.replace(",", "").replace("%", "").strip()
    try:
        return float(x)
    except ValueError:
        return None


recs = []
for c in rows:
    name, d = c[0], c[1].replace("/", "")
    ipo, op, cl = num(c[4]), num(c[6]), num(c[8])
    if not ipo or not op:
        continue
    recs.append(dict(name=name, date=d, ipo=ipo, open=op, close=cl, spac="스팩" in name, kospi="(유가)" in name))
print(f"전체 {len(rows)}건, 가격 있는 {len(recs)}건, 스팩 {sum(r['spac'] for r in recs)}건")

# 코스피 분기 수익률(미국 원지수 파일에 ^KS11 야후 일봉)
ks = json.load(open(".research-cache/allweather/us__KS11.json"))
qpx = {}
for d, a, cl in ks:
    q = d[:4] + str((int(d[4:6]) - 1) // 3 + 1)
    qpx[q] = cl  # 분기 마지막 값
qs = sorted(qpx)
qret = {qs[i]: qpx[qs[i]] / qpx[qs[i - 1]] - 1 for i in range(1, len(qs))}


def quarter(d):
    return d[:4] + str((int(d[4:6]) - 1) // 3 + 1)


def analyze(sel, label, sub_fee=3000):
    if not sel:
        print(label, "표본 없음"); return
    ret = np.array([(r["open"] / r["ipo"] - 1) for r in sel])
    loss = (ret < 0).mean() * 100
    gain1 = np.array([r["open"] - r["ipo"] - r["open"] * 0.002 - sub_fee for r in sel])  # 1주 원 이익
    years = (max(r["date"] for r in sel) > min(r["date"] for r in sel)) and (int(max(r["date"] for r in sel)[:4]) - int(min(r["date"] for r in sel)[:4]) + 1)
    print(f"{label}: {len(sel)}건, 시초가 손실 {loss:.0f}%, 평균 {ret.mean()*100:+.1f}% 중앙 {np.median(ret)*100:+.1f}%, 1주 순이익(수수료 {sub_fee}원) 평균 {gain1.mean():+.0f}원 중앙 {np.median(gain1):+.0f}원, 합계 {gain1.sum()/10000:+.1f}만원")
    return ret, gain1


main_all = [r for r in recs if r["date"] >= "20230626" and not r["spac"]]
print("\n[주 표본] 2023-06-26 이후 일반 기업")
for fee in (2000, 3000, 5000):
    out = analyze(main_all, f"청약수수료 {fee}원", fee)
ret, g = analyze(main_all, "기준(3,000원)", 3000)
print(f"  ① 손실 종목 비율 {(ret<0).mean()*100:.1f}% (기준 <20%) → {'통과' if (ret<0).mean()<0.2 else '미달'}")
yrs = {}
for r in main_all:
    yrs.setdefault(r["date"][:4], []).append(r)
print("  연도별(건수 / 손실 비율 / 1주 순이익 합계 만원):")
for y in sorted(yrs):
    s = yrs[y]; rr = np.array([x["open"] / x["ipo"] - 1 for x in s]); gg = np.array([x["open"] - x["ipo"] - x["open"] * 0.002 - 3000 for x in s])
    print(f"    {y}: {len(s)}건 / {(rr<0).mean()*100:.0f}% / {gg.sum()/10000:+.1f}")
print(f"  ② 연 기대 수익(1주): 최근 완전 연도 평균 {np.mean([np.array([x['open']-x['ipo']-x['open']*0.002-3000 for x in s]).sum() for y,s in yrs.items() if y in ('2024','2025')]):+.0f}원 → {'양수' if g.sum()>0 else '음수'}")
dn = [r for r in main_all if qret.get(quarter(r["date"]), 0) < 0]
print(f"\n  ③ 코스피 하락 분기만: ", end="")
analyze(dn, "하락 분기", 3000)
print("  하락 분기:", sorted({quarter(r['date']) for r in dn}))

print("\n[보조] 가격이 높은/낮은 공모가 구간, 코스피·코스닥, 첫날 종가 매도")
for lo, hi in ((0, 10000), (10000, 30000), (30000, 1e9)):
    analyze([r for r in main_all if lo <= r["ipo"] < hi], f"공모가 {int(lo)}~{int(hi) if hi<1e9 else '+'}")
analyze([r for r in main_all if r["kospi"]], "코스피 상장")
analyze([r for r in main_all if not r["kospi"]], "코스닥 등")
cl = [r for r in main_all if r["close"]]
print(f"  첫날 종가 매도: 손실 {np.mean([r['close']<r['ipo'] for r in cl])*100:.0f}% 평균 {np.mean([r['close']/r['ipo']-1 for r in cl])*100:+.1f}%")
print("\n[보조] 스팩 (2023-06-26 이후)")
analyze([r for r in recs if r["date"] >= "20230626" and r["spac"]], "스팩")
print("\n[보조] 2023-06-26 이전(가격 범위 ±100% 시기) 일반 기업")
analyze([r for r in recs if r["date"] < "20230626" and not r["spac"]], "이전")
