import sys, pickle, numpy as np, collections
sys.stdout.reconfigure(encoding="utf-8")
import os
D = os.environ.get("DART_PANEL_DIR", ".")  # panel.pkl·shares.pkl이 있는 폴더 (scratchpad/dart)
P = pickle.load(open(D + "/panel.pkl", "rb")); SH = pickle.load(open(D + "/shares.pkl", "rb"))

fresh = lambda r: "roe" in r and r.get("stale", 9) <= 2
# 봇 관문: 최근 4분기 적자 또는 최근분기 영업이익이 전년동기 이하면 제외 (fresh 아닌 종목은 판정 불가 → 통과로 둠)
def passes(r):
    if not fresh(r): return True
    if r.get("ni_ttm") is not None and r["ni_ttm"] < 0: return False
    o = r.get("opg_q")
    if o is not None and o <= 0: return False
    return True

def nw_t(x, lag=3):
    x = np.asarray(x); n = len(x); m = x.mean(); e = x - m
    v = e @ e / n
    for l in range(1, lag + 1):
        w = 1 - l / (lag + 1)
        v += 2 * w * (e[l:] @ e[:-l]) / n
    return m / np.sqrt(v / n)

def block_boot(x, block=6, B=5000, seed=0):
    rng = np.random.default_rng(seed); x = np.asarray(x); n = len(x); means = []
    nb = int(np.ceil(n / block))
    for _ in range(B):
        idx = np.concatenate([np.arange(s, s + block) % n for s in rng.integers(0, n, nb)])[:n]
        means.append(x[idx].mean())
    return np.percentile(means, [2.5, 97.5])

def build(universe):
    bym = collections.defaultdict(list)
    for r in P["rows"]:
        if "fnx" not in r or r["d"] < "20180427": continue
        if universe == "tv10억":
            if r["tv"] < 1e9: continue
        else:
            s = SH.get(r["code"])
            if not s: continue
            r["cap"] = r["p"] * s[1]
        bym[r["d"]].append(r)
    if universe == "top300":
        for d in bym: bym[d] = sorted(bym[d], key=lambda r: -r["cap"])[:300]
    return bym

for uni in ("tv10억", "top300"):
    bym = build(uni); ds = sorted(bym)
    ex_pass = []; ex_fail = []
    for d in ds:
        L = bym[d]; allm = np.mean([r["fnx"] for r in L])
        p = [r["fnx"] for r in L if passes(r)]; f = [r["fnx"] for r in L if not passes(r)]
        ex_pass.append((np.mean(p) if p else allm) - allm)
        ex_fail.append((np.mean(f) if f else allm) - allm)
    print(f"== {uni}  월 {len(ds)}개  (관문 통과 종목 평균 초과 / 제외 종목 평균 초과, 월간)")
    for name, ex in (("통과", ex_pass), ("제외", ex_fail)):
        ex = np.array(ex); lo, hi = block_boot(ex)
        half = len(ex) // 2
        print(f"  {name}: 평균 {ex.mean()*100:+.3f}%/월  단순 t={ex.mean()/(ex.std(ddof=1)/np.sqrt(len(ex))):+.2f}  NW(3) t={nw_t(ex):+.2f}  "
              f"블록부트스트랩 95% [{lo*100:+.3f}, {hi*100:+.3f}]  전반 {ex[:half].mean()*100:+.3f} 후반 {ex[half:].mean()*100:+.3f}  이긴 달 {np.mean(ex>0)*100:.0f}%")
    # 연도별
    byy = collections.defaultdict(list)
    for d, v in zip(ds, ex_fail): byy[d[:4]].append(v)
    print("  제외 종목 연도별 월평균 초과(%):", " ".join(f"{y}:{np.mean(v)*100:+.2f}" for y, v in sorted(byy.items())))
    # 제외 종목 비중
    fr = [np.mean([not passes(r) for r in bym[d]]) for d in ds]
    print(f"  제외 비율 평균 {np.mean(fr)*100:.0f}%")
