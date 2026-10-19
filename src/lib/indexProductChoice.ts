/**
 * 같은 지수(운용사만 다름) 상품 중 새 돈을 보낼 곳 — 리밸런싱 리포트·가이드 ①·계좌별 예수금·받은 분배금이 모두 이 함수를 쓴다.
 * 화면마다 따로 고르면 같은 계좌인데도 살 곳이 갈린다(2026-10-19: 리포트는 보수 비교, 가이드는 가장 큰 TR).
 *
 * 2026-10-19 사용자 정정: 장기 적립은 "예전에 산 상품"이 아니라 최적 상품으로. 단 추천이 자주 바뀌거나 운용사가 늘면 안 된다.
 *   → 최적 상품은 보유와 무관하게 정하고, 가진 상품을 계속 살지는 "남은 기간 동안 앞으로 넣을 돈에서 생길 보수 차이(원)"로 판정한다.
 *     기존 보유는 팔지 않는다(새 돈만 옮긴다). 보수가 같은 묶음이면 가진 상품을 그대로 사서 날마다 바뀌지 않게 한다.
 * DB·API 없이 계산만 한다.
 */
import type { IncomeGuideSettings } from "./incomeGuide";

/** 네이버 ETF 지표 중 쓰는 값 (src/services/etfKeyIndicator.ts) */
export type EtfYield = {
  yieldTtm: number | null;
  fee: number | null;
  marketCap?: number | null;
  return1y?: number | null;
  deviation?: number | null;
};
/** 살 곳과 같은 지수를 따르는 다른 운용사 상품 (src/services/indexAlternatives.ts가 종목 테이블에서 찾는다) */
export type FeeAlternative = { code: string; name: string; price: number } & EtfYield;

/** 같은 보수로 보는 폭(%p) — 1천만원당 연 1천원 미만 차이 */
export const FEE_SWITCH_PP = 0.01;
/** 같은 지수끼리 1년 수익률이 이만큼(%p) 넘게 낮으면 숨은 비용·추적 차이가 큰 것으로 본다 */
export const RETURN_GAP_PP = 0.2;
/** 이보다 작은 상품은 큰 상품이 있으면 고르지 않는다 (호가 차이·상장폐지 위험) */
export const MIN_MARKET_CAP = 100_000_000_000;
/** 괴리율이 이보다 크면 고르지 않는다 */
export const MAX_DEVIATION_PCT = 1;
/** 월 적립액을 모를 때만 쓰는 예전 기준 — 가진 상품 보수가 최저보다 이만큼(%p) 안 비싸면 그대로 (rebalancePlan FEE_TIE_PP와 같은 값) */
export const FALLBACK_TIE_PP = 0.05;
/** 새 돈만 갈아타는 문턱 — 남은 기간 보수 차이가 만들어질 자산의 이 비율 이상이고 */
export const SWITCH_MIN_SHARE = 0.002;
/** 동시에 이 금액(원) 이상일 때 */
export const SWITCH_MIN_WON = 100_000;
/** 기간 계산에 쓰는 연 수익률 가정 (보수 차이 금액만 보는 데 쓰며, 수익 예측이 아니다) */
export const ASSUMED_ANNUAL_RETURN = 0.05;
/** 인컴 시작 월이 없을 때 보는 남은 적립 기간(년) */
export const DEFAULT_HORIZON_YEARS = 10;

export type IndexCandidate = { code: string; name: string; price: number; fee: number; marketCap: number | null; return1y: number | null; deviation: number | null };
/** 앞으로 넣을 새 돈 — 가진 상품을 계속 살지 판정할 때 */
export type NewMoney = { monthly: number; years: number; /** 기간을 어디서 정했는지 (문구용) */ horizonSource: "incomeStart" | "default" };
export type IndexPick = {
  chosen: IndexCandidate;
  /** 상품별 판단 — 표에 그대로 쓴다 */
  notes: Map<string, string>;
  /** 고른 이유 한 문장 */
  why: string;
  /** 가진 상품과 최적 상품이 다를 때 남은 기간 보수 차이 (판정에 쓴 값) */
  gap: { from: IndexCandidate; to: IndexCandidate; won: number; years: number; monthly: number; kept: boolean } | null;
};

const eok = (v: number) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}조` : `${Math.round(v / 1e8).toLocaleString("ko-KR")}억`);
const manWon = (v: number) => (Math.abs(v) < 100_000 ? `${Math.round(v).toLocaleString("ko-KR")}원` : `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`);

/** 운용사 이름(첫 단어)을 뗀 상품 이름 — "KODEX 200TR"과 "TIGER 200TR"을 같은 지수로 본다 */
export function sameIndexKey(name: string): string | null {
  const m = String(name ?? "").trim().match(/^\S+\s+(.+)$/);
  const rest = m ? m[1].replace(/\s+/g, "") : "";
  return rest.length >= 2 ? rest : null;
}

/** 매달 monthly원을 years년 넣을 때 총보수 feeHigh%와 feeLow%로 끝에 생기는 차이(원)와 만들어질 자산(싼 쪽) */
export function newMoneyFeeGap(monthly: number, years: number, feeHighPct: number, feeLowPct: number, annualReturn = ASSUMED_ANNUAL_RETURN) {
  const months = Math.max(0, Math.round(years * 12));
  const r = annualReturn / 12;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < months; i++) {
    hi = (hi + monthly) * (1 + r) * (1 - feeHighPct / 100 / 12);
    lo = (lo + monthly) * (1 + r) * (1 - feeLowPct / 100 / 12);
  }
  return { won: Math.max(0, lo - hi), final: lo };
}

/** 가이드 설정에서 앞으로 넣을 새 돈 — 월 적립액이 없으면 null(예전 0.05%p 기준으로 판정) */
export function newMoneyFromSettings(settings: Pick<IncomeGuideSettings, "monthlyContribution" | "incomeStart">, today: string): NewMoney | null {
  const monthly = Number(settings.monthlyContribution ?? 0);
  if (!(monthly > 0)) return null;
  const start = settings.incomeStart && /^\d{4}-\d{2}$/.test(settings.incomeStart) ? settings.incomeStart : null;
  if (!start) return { monthly, years: DEFAULT_HORIZON_YEARS, horizonSource: "default" };
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  const [sy, sm] = start.split("-").map(Number);
  const months = (sy - ty) * 12 + (sm - tm);
  return { monthly, years: Math.max(0, months / 12), horizonSource: "incomeStart" };
}

/**
 * 같은 지수 상품 중 새 돈을 보낼 곳 — 점수 가중치 대신 단계별로 거른다(표에서 이유가 보이게).
 *   ① 제외: 시가총액 1천억 미만(1천억 이상이 하나라도 있을 때), 괴리율 ±1% 초과
 *   ② 총보수: 가장 싼 보수에서 0.01%p 안
 *   ③ 1년 수익률: 같은 지수라 차이 = 숨은 비용(기타·매매비용)과 추적 차이. 최고치에서 0.2%p 안 (1년 안 된 상품은 통과)
 *   ④ 시가총액이 가장 큰 것 = 최적 상품 (보유와 무관)
 * 가진 상품(keepCodes, 큰 것부터)은 ①을 통과하고
 *   - 최적과 보수가 같은 묶음(0.01%p 안)이면 그대로 산다 — 1년 수익률은 매일 바뀌므로 그걸로 바꾸면 추천이 흔들린다.
 *   - 아니면 newMoney가 있을 때 남은 기간 보수 차이가 만들어질 자산의 0.2% 미만이거나 10만원 미만이면 그대로, 넘으면 새 돈만 최적으로.
 *   - newMoney가 없으면(월 적립액 모름) 예전 기준: 최저 보수보다 0.05%p 미만 비싸면 그대로.
 */
export function pickIndexProduct(pool: IndexCandidate[], keepCodes?: string | string[] | null, newMoney?: NewMoney | null): IndexPick | null {
  if (pool.length === 0) return null;
  const notes = new Map<string, string>();
  const anyBig = pool.some((c) => (c.marketCap ?? 0) >= MIN_MARKET_CAP);
  const eligible = pool.filter((c) => {
    if (anyBig && c.marketCap != null && c.marketCap < MIN_MARKET_CAP) {
      notes.set(c.code, `시가총액 ${eok(c.marketCap)}으로 작음`);
      return false;
    }
    if (c.deviation != null && Math.abs(c.deviation) > MAX_DEVIATION_PCT) {
      notes.set(c.code, `괴리율 ${c.deviation.toFixed(2)}%로 큼`);
      return false;
    }
    return true;
  });
  const base = eligible.length ? eligible : pool;
  const minFee = Math.min(...base.map((c) => c.fee));
  const feeBand = base.filter((c) => {
    const ok = c.fee - minFee < FEE_SWITCH_PP - 1e-9;
    if (!ok) notes.set(c.code, `총보수가 최저(${minFee}%)보다 높음`);
    return ok;
  });
  const rets = feeBand.map((c) => c.return1y).filter((r): r is number => r != null);
  const maxRet = rets.length ? Math.max(...rets) : null;
  const retBand = feeBand.filter((c) => {
    const ok = maxRet == null || c.return1y == null || maxRet - c.return1y <= RETURN_GAP_PP + 1e-9;
    if (!ok) notes.set(c.code, `보수는 같지만 1년 수익률이 ${(maxRet! - c.return1y!).toFixed(2)}%p 낮음(숨은 비용·추적 차이)`);
    return ok;
  });
  const best = [...retBand].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))[0];
  const bestWhy = `같은 지수 상품 중 총보수 최저 묶음(${minFee}%)${maxRet != null ? `에서 1년 수익률 차이가 ${RETURN_GAP_PP}%p 안이고` : "에서"} 시가총액이 가장 큰(${best.marketCap != null ? eok(best.marketCap) : "규모 자료 없음"}) ${best.name}`;

  const keepList = keepCodes == null ? [] : Array.isArray(keepCodes) ? keepCodes : [keepCodes];
  const heldCands = keepList.map((code) => base.find((c) => c.code === code)).filter((c): c is IndexCandidate => c != null);
  let gap: IndexPick["gap"] = null;
  for (const h of heldCands) {
    if (h === best) break;
    // 보수가 같은 묶음 — 수익률·규모 차이로 바꾸면 날마다 흔들리고 종류만 는다
    if (h.fee - best.fee < FEE_SWITCH_PP - 1e-9) {
      for (const c of pool) if (c !== h && !notes.has(c.code)) notes.set(c.code, "보수가 같은 묶음이라 가진 상품을 그대로 삼");
      notes.set(h.code, "이미 보유 중 — 최적 상품과 보수가 같은 묶음이라 그대로");
      return { chosen: h, notes, why: `이미 가진 ${h.name}를 그대로 삽니다. 최적 상품(${best.name})과 총보수가 같은 묶음이라 바꿀 이유가 없습니다.`, gap: null };
    }
    if (newMoney) {
      const g = newMoneyFeeGap(newMoney.monthly, newMoney.years, h.fee, best.fee);
      const small = g.won < SWITCH_MIN_WON || g.won < g.final * SWITCH_MIN_SHARE;
      const horizon = `${newMoney.horizonSource === "default" ? "인컴 시작 월이 없어 " : ""}앞으로 ${newMoney.years.toFixed(newMoney.years < 1 ? 1 : 0)}년 동안 매달 ${manWon(newMoney.monthly)}`;
      gap = { from: h, to: best, won: g.won, years: newMoney.years, monthly: newMoney.monthly, kept: small };
      if (small) {
        notes.set(h.code, `이미 보유 중 — 남은 기간 보수 차이 약 ${manWon(g.won)}로 작아 그대로`);
        notes.set(best.code, `최적 상품 — 다만 가진 ${h.name}와 차이가 작아 바꾸지 않음`);
        for (const c of pool) if (!notes.has(c.code)) notes.set(c.code, "조건은 같고 시가총액이 더 작음");
        return {
          chosen: h,
          notes,
          why: `이미 가진 ${h.name}를 그대로 삽니다. ${horizon}을 넣어도 최적 상품(${best.name}, 총보수 ${best.fee}%)과의 보수 차이가 약 ${manWon(g.won)}(만들어질 자산의 ${((g.won / Math.max(1, g.final)) * 100).toFixed(2)}%)라 종류를 늘릴 만큼 크지 않습니다.`,
          gap,
        };
      }
      notes.set(h.code, `이미 보유 — 팔지 않고 두되, 남은 기간 보수 차이 약 ${manWon(g.won)}라 새 돈은 ${best.name}로`);
      continue;
    }
    if (h.fee - minFee < FALLBACK_TIE_PP - 1e-9) {
      for (const c of pool) if (c !== h && !notes.has(c.code)) notes.set(c.code, `보수 차이 ${Math.max(0, h.fee - c.fee).toFixed(3)}%p로 작아 가진 상품을 그대로 삼`);
      notes.set(h.code, `이미 보유 중 — 보수 차이가 ${FALLBACK_TIE_PP}%p 미만이라 그대로`);
      return {
        chosen: h,
        notes,
        why: `이미 가진 ${h.name}를 그대로 삽니다. 같은 지수 상품 중 가장 싼 보수(${minFee}%)와 차이가 ${FALLBACK_TIE_PP}%p 미만입니다. 매달 넣는 돈을 정해 두면 남은 기간 동안의 차이 금액으로 다시 판단합니다.`,
        gap: null,
      };
    }
  }
  for (const c of retBand) if (c !== best && !notes.has(c.code)) notes.set(c.code, "조건은 같고 시가총액이 더 작음");
  const keptBest = heldCands.includes(best);
  notes.set(best.code, keptBest ? "이미 보유 중이고 최적 상품" : "선정");
  const why = keptBest
    ? `이미 가진 ${best.name}가 총보수·1년 수익률·규모 모두 최선 묶음에 있어 그대로 모읍니다.`
    : gap
      ? `${bestWhy}를 골랐습니다. 앞으로 ${gap.years.toFixed(0)}년 동안 매달 ${manWon(gap.monthly)}을 넣으면 가진 ${gap.from.name}(총보수 ${gap.from.fee}%)보다 약 ${manWon(gap.won)} 덜 냅니다.`
      : `${bestWhy}를 골랐습니다.`;
  return { chosen: best, notes, why, gap };
}

/**
 * 계좌 하나의 살 곳 — 그 계좌 성장 ETF 중 기준 상품(일반 계좌면 TR형 먼저, 아니면 가장 큰 것)을 고르고, 같은 지수 상품과 비교해 최종 결정.
 * 리포트(rebalanceReport)와 가이드(rebalancePlan)가 같은 입력이면 같은 결과를 낸다.
 */
export function chooseIndexBuy(input: {
  /** 그 계좌의 성장 ETF (평가액 큰 순) */
  growthHeld: Array<{ code: string; name: string; price: number; value: number }>;
  taxAdvantaged: boolean;
  alternatives?: FeeAlternative[];
  feeOf: (code: string) => number | null;
  infoOf: (code: string) => EtfYield | undefined;
  newMoney?: NewMoney | null;
}): { base: { code: string; name: string; price: number } | null; target: { code: string; name: string; price: number } | null; pick: IndexPick | null; pool: IndexCandidate[] } {
  const { growthHeld, taxAdvantaged } = input;
  const baseRow = (!taxAdvantaged ? growthHeld.find((h) => /TR/i.test(h.name)) : undefined) ?? growthHeld[0] ?? null;
  if (!baseRow) return { base: null, target: null, pick: null, pool: [] };
  const base = { code: baseRow.code, name: baseRow.name, price: baseRow.price };
  const key = sameIndexKey(baseRow.name);
  const alts = (input.alternatives ?? []).filter((a) => a.price > 0);
  const pool: IndexCandidate[] = [
    base,
    ...alts.filter((a) => a.code !== baseRow.code && key != null && sameIndexKey(a.name) === key),
  ]
    .map((c) => {
      const k = input.infoOf(c.code);
      return { code: c.code, name: c.name, price: c.price, fee: input.feeOf(c.code) ?? -1, marketCap: k?.marketCap ?? null, return1y: k?.return1y ?? null, deviation: k?.deviation ?? null };
    })
    .filter((c) => c.fee >= 0);
  // 같은 지수 상품을 이 계좌에 여럿 가졌으면 모두 '가진 상품'으로 본다(큰 것부터) — 한 번 옮겨 산 상품이 다음 달 또 바뀌지 않게
  const heldSame = growthHeld.filter((h) => key != null && sameIndexKey(h.name) === key).map((h) => h.code);
  const keepCodes = [baseRow.code, ...heldSame.filter((c) => c !== baseRow.code)];
  const pick = pool.length >= 2 ? pickIndexProduct(pool, keepCodes, input.newMoney) : null;
  const target = pick ? { code: pick.chosen.code, name: pick.chosen.name, price: pick.chosen.price } : base;
  return { base, target, pick, pool };
}
