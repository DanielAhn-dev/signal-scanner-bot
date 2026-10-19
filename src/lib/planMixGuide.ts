/**
 * 내 계획 구성(지수·비중·상품·계좌)으로 새 돈을 나누는 줄 — 홈 '이번 달 할 일'·리밸런싱 가이드 ①·리포트가 같은 줄을 쓴다
 * (화면 지도: 같은 질문을 화면마다 다르게 답하지 않게). 구성이 없거나 코스피200 하나뿐이면 null — 예전처럼 "성장 ETF 한 곳".
 * 상품은 구성에 고른 상품 → 그 지수를 이미 가진 상품(구성 계좌 안 먼저) → 없음(모아가기 1번 추천을 보라고 안내).
 */

export type PlanMixEntryLike = {
  index: string;
  weight: number;
  product: { code: string; name: string } | null;
  account: { broker: string; account: string } | null;
};

export type PlanMixLine = {
  index: string;
  label: string;
  weightPct: number;
  /** 매달 이 지수에 넣을 돈 (계획 × 비중, 만원 단위 — 나머지는 마지막 줄) */
  monthly: number;
  product: { code: string; name: string } | null;
  /** 구성에 기억한 계좌 — 가이드 계좌 키("증권사|계좌")와 표시 이름 */
  accountKey: string | null;
  accountLabel: string | null;
};

const LABEL: Record<string, string> = { kospi200: "코스피200", sp500: "S&P500", nasdaq100: "나스닥100" };

/** 계획 금액을 비중대로 — 만원 아래는 버리고 나머지는 마지막 줄이 받아 합이 계획과 같다 (웹 홈 할 일도 이 함수) */
export function splitAmount(total: number, weights: number[]): number[] {
  if (!(total > 0) || weights.length === 0) return weights.map(() => 0);
  const sum = weights.reduce((a, w) => a + w, 0) || 1;
  const parts = weights.map((w) => Math.floor((total * w) / sum / 10_000) * 10_000);
  parts[parts.length - 1] = Math.round(total - parts.slice(0, -1).reduce((a, v) => a + v, 0));
  return parts;
}

/** 상품 이름으로 지수를 판정 — 해외는 이름이 지수 이름으로 끝나야 그 지수 전체(업종 상품 제외, 웹 overseasHistoryFor와 같은 규칙) */
export function indexOfProductName(name: string): string | null {
  const n = name.replace(/\s+/g, "");
  if (/레버리지|인버스|커버드콜|프리미엄|\(H\)/i.test(n)) return null;
  if (/나스닥100(TR)?$/i.test(n)) return "nasdaq100";
  if (/S&P500(TR)?$/i.test(n)) return "sp500";
  if (/(^|[A-Z가-힣])200(TR)?$/.test(n) && !/미국|S&P|나스닥/i.test(n)) return "kospi200";
  return null;
}

export function planMixLines(input: {
  mix: PlanMixEntryLike[] | null | undefined;
  monthly: number;
  /** 가진 성장 ETF — 구성에 상품을 안 골랐으면 그 지수를 가진 상품으로 */
  held?: Array<{ code: string; name: string; accountKey: string }>;
}): PlanMixLine[] | null {
  const mix = input.mix;
  if (!mix || mix.length === 0 || (mix.length === 1 && mix[0].index === "kospi200")) return null;
  const amounts = splitAmount(input.monthly, mix.map((e) => e.weight));
  return mix.map((e, i) => {
    const accountKey = e.account ? `${e.account.broker}|${e.account.account}` : null;
    const sameIndex = (input.held ?? []).filter((h) => indexOfProductName(h.name) === e.index);
    const heldPick = sameIndex.find((h) => h.accountKey === accountKey) ?? sameIndex[0] ?? null;
    return {
      index: e.index,
      label: LABEL[e.index] ?? e.index,
      weightPct: Math.round(e.weight * 100),
      monthly: amounts[i],
      product: e.product ?? (heldPick ? { code: heldPick.code, name: heldPick.name } : null),
      accountKey,
      accountLabel: e.account ? [e.account.broker, e.account.account].filter(Boolean).join(" · ") : null,
    };
  });
}

/** 리포트 한 줄 — 이 계좌가 구성에서 맡은 몫 */
export function planMixLineForAccount(lines: PlanMixLine[], accountKey: string): string {
  const mine = lines.filter((l) => l.accountKey === accountKey);
  const all = lines.map((l) => `${l.label} ${l.weightPct}%`).join(" · ");
  const won = (v: number) => `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`;
  if (mine.length) {
    return `내 계획 구성(${all}) 중 이 계좌는 ${mine.map((l) => `${l.label} 몫(매달 ${won(l.monthly)}${l.product ? ` → ${l.product.name}` : ""})`).join(", ")}을 삽니다.`;
  }
  if (lines.some((l) => l.accountKey)) {
    return `내 계획 구성(${all})에서 이 계좌에 정한 지수는 없습니다. ${lines.filter((l) => l.accountLabel).map((l) => `${l.label}은 ${l.accountLabel}`).join(", ")}에서 삽니다.`;
  }
  return `새 돈은 내 계획 구성(${all})대로 나눠 넣습니다. 지수마다 어느 계좌에서 살지는 홈 '이번 달 할 일'에서 처음 살 때 정해집니다.`;
}
