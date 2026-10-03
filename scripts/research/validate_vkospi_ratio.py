"""VKOSPI(내재변동성) ÷ 실현변동성 비율 측정 — 한국 커버드콜 옵션 가격 가정(k) 직접 확인. 입력: .research-cache/vkospi.json, kospi.json"""
import json, numpy as np
v = dict(json.load(open(".research-cache/vkospi.json")))
k = json.load(open(".research-cache/kospi.json"))
dates = [d for d, _ in k if d in v]
px = {d: p for d, p in k}
ds = [d for d, _ in k if d >= "20030102"]
r = np.diff(np.log([px[d] for d in ds]))
rd = ds[1:]
ann = np.sqrt(252)
out = []
for i in range(20, len(rd) - 21):
    d = rd[i]
    if d not in v: continue
    past = r[i - 19:i + 1].std() * ann * 100
    fut = r[i + 1:i + 22].std() * ann * 100
    out.append((d, v[d], past, fut))
a = np.array([[x[1], x[2], x[3]] for x in out])
print("표본", len(a), out[0][0], "~", out[-1][0])
for nm, den in (("직전20일", a[:, 1]), ("향후21일", a[:, 2])):
    q = a[:, 0] / den
    print(f"VKOSPI/{nm} 실현: 중앙값 {np.median(q):.2f} 평균 {q.mean():.2f} p25 {np.percentile(q,25):.2f} p75 {np.percentile(q,75):.2f}")
print("VKOSPI 평균 %.1f 중앙 %.1f / 실현(20일) 평균 %.1f" % (a[:, 0].mean(), np.median(a[:, 0]), a[:, 1].mean()))
for lo, hi in (("2003", "2009"), ("2010", "2019"), ("2020", "2022"), ("2023", "2026")):
    s = [x for x in out if lo <= x[0][:4] <= hi]
    b = np.array([[x[1], x[2], x[3]] for x in s])
    print(lo, hi, "VKOSPI 평균 %.1f / 향후실현 평균 %.1f / 비율(중앙) %.2f" % (b[:, 0].mean(), b[:, 2].mean(), np.median(b[:, 0] / b[:, 2])))
# 최근 1년
s = [x for x in out if x[0] >= "20250101"]; b = np.array([[x[1], x[2], x[3]] for x in s])
print("2025~ VKOSPI 평균 %.1f / 직전실현 %.1f / 비율(직전) 중앙 %.2f" % (b[:, 0].mean(), b[:, 1].mean(), np.median(b[:, 0] / b[:, 1])))
