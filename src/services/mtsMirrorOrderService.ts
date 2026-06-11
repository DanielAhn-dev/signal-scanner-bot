/**
 * MTS 미러링 주문 시트 (Phase 3)
 *
 * 가상매매 체결(매수/매도)을 사용자가 토스증권 등 MTS에서 그대로 따라 걸 수 있는
 * "따라하기 주문서"로 변환한다.
 * - 수량: 실투자금(capital_krw) / 가상시드(virtual_seed_capital) 비율로 환산
 * - 가격: KRX 호가단위에 맞춰 보정 (매수/익절은 내림, 손절은 올림 = 보수적)
 */

export type MirrorOrderSide = "BUY" | "SELL";

export type MirrorBuyKind = "new-buy" | "add-on-buy";

export type MirrorSellKind =
  | "stop-loss"
  | "take-profit-partial"
  | "take-profit-final"
  | "overweight-trim"
  | "sector-rotation";

export type MirrorOrderEntry = {
  side: MirrorOrderSide;
  kind: MirrorBuyKind | MirrorSellKind;
  code: string;
  name?: string | null;
  /** 가상 계좌 기준 체결 수량 */
  virtualQuantity: number;
  /** MTS 지정가 (호가단위 보정 완료) */
  limitPrice: number;
  /** 매수 전용: 손절 감시매도 가격 (호가단위 보정 완료) */
  stopLossPrice?: number | null;
  stopLossPct?: number | null;
  /** 매수 전용: 익절 감시매도 가격 (호가단위 보정 완료) */
  takeProfitPrice?: number | null;
  takeProfitPct?: number | null;
  /** 매도 전용: 가상 계좌 기준 잔여 수량 (전량 매도면 0) */
  virtualRemainQuantity?: number | null;
  /** 매도 전용: 손익률 (%) */
  pnlPct?: number | null;
};

export type MirrorScale = {
  /** 실계좌 환산 배율 (real / virtual) */
  ratio: number;
  /** real-capital: 실투자금 기준 환산, virtual-only: 환산 불가(가상 수량 그대로) */
  basis: "real-capital" | "virtual-only";
  realCapital: number;
  virtualSeedCapital: number;
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * KRX 호가단위 (2023-01 통합 기준, KOSPI/KOSDAQ 동일)
 */
export function resolveKrxTickSize(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function roundToKrxTick(price: number, mode: "floor" | "ceil" = "floor"): number {
  const value = Math.max(0, toFiniteNumber(price, 0));
  if (value <= 0) return 0;
  const tick = resolveKrxTickSize(value);
  const units = mode === "ceil" ? Math.ceil(value / tick) : Math.floor(value / tick);
  return Math.max(tick, units * tick);
}

/**
 * 실투자금/가상시드 비율로 환산 배율을 계산한다.
 * 실투자금 또는 가상시드가 없으면(또는 사실상 동일하면) 가상 수량 그대로 사용.
 */
export function resolveMirrorScale(input: {
  realCapitalKrw?: number | null;
  virtualSeedCapital?: number | null;
}): MirrorScale {
  const realCapital = Math.max(0, toFiniteNumber(input.realCapitalKrw, 0));
  const virtualSeedCapital = Math.max(0, toFiniteNumber(input.virtualSeedCapital, 0));

  if (realCapital <= 0 || virtualSeedCapital <= 0) {
    return { ratio: 1, basis: "virtual-only", realCapital, virtualSeedCapital };
  }

  const ratio = realCapital / virtualSeedCapital;
  if (Math.abs(ratio - 1) < 0.005) {
    return { ratio: 1, basis: "real-capital", realCapital, virtualSeedCapital };
  }

  return { ratio, basis: "real-capital", realCapital, virtualSeedCapital };
}

/**
 * 가상 수량 → 실계좌 수량 환산 (버림, 가상 수량이 1주 이상이면 최소 1주 보장)
 */
export function scaleMirrorQuantity(virtualQuantity: number, scale: MirrorScale): number {
  const qty = Math.max(0, Math.floor(toFiniteNumber(virtualQuantity, 0)));
  if (qty <= 0) return 0;
  if (scale.basis === "virtual-only" || scale.ratio === 1) return qty;
  return Math.max(1, Math.floor(qty * scale.ratio));
}

export function buildBuyMirrorOrder(input: {
  kind: MirrorBuyKind;
  code: string;
  name?: string | null;
  /** 이번에 매수한 수량 (추가매수면 증가분만) */
  quantity: number;
  /** 체결가 = MTS 지정가 기준 */
  limitPrice: number;
  /** 손절/익절 계산 기준가 (추가매수면 새 평균단가, 기본은 체결가) */
  exitBasePrice?: number;
  stopLossPct: number;
  takeProfitPct: number;
}): MirrorOrderEntry {
  const limitPrice = roundToKrxTick(input.limitPrice, "floor");
  const exitBase = Math.max(0, toFiniteNumber(input.exitBasePrice, input.limitPrice));
  const stopLossPct = Math.abs(toFiniteNumber(input.stopLossPct, 0));
  const takeProfitPct = Math.abs(toFiniteNumber(input.takeProfitPct, 0));

  return {
    side: "BUY",
    kind: input.kind,
    code: input.code,
    name: input.name ?? null,
    virtualQuantity: Math.max(0, Math.floor(toFiniteNumber(input.quantity, 0))),
    limitPrice,
    stopLossPrice: stopLossPct > 0 ? roundToKrxTick(exitBase * (1 - stopLossPct / 100), "ceil") : null,
    stopLossPct: stopLossPct > 0 ? stopLossPct : null,
    takeProfitPrice: takeProfitPct > 0 ? roundToKrxTick(exitBase * (1 + takeProfitPct / 100), "floor") : null,
    takeProfitPct: takeProfitPct > 0 ? takeProfitPct : null,
  };
}

export function buildSellMirrorOrder(input: {
  kind: MirrorSellKind;
  code: string;
  name?: string | null;
  quantity: number;
  /** 매도 시세 = MTS 지정가 기준 */
  limitPrice: number;
  remainQuantity?: number;
  pnlPct?: number | null;
}): MirrorOrderEntry {
  return {
    side: "SELL",
    kind: input.kind,
    code: input.code,
    name: input.name ?? null,
    virtualQuantity: Math.max(0, Math.floor(toFiniteNumber(input.quantity, 0))),
    limitPrice: roundToKrxTick(input.limitPrice, "floor"),
    virtualRemainQuantity: Math.max(0, Math.floor(toFiniteNumber(input.remainQuantity, 0))),
    pnlPct: input.pnlPct == null ? null : toFiniteNumber(input.pnlPct, 0),
  };
}

const SELL_KIND_LABEL: Record<MirrorSellKind, string> = {
  "stop-loss": "손절",
  "take-profit-partial": "부분익절",
  "take-profit-final": "익절",
  "overweight-trim": "비중조정",
  "sector-rotation": "섹터리밸런싱",
};

const BUY_KIND_LABEL: Record<MirrorBuyKind, string> = {
  "new-buy": "신규",
  "add-on-buy": "추가매수",
};

function fmtKrw(value: number): string {
  return `${Math.round(toFiniteNumber(value, 0)).toLocaleString("ko-KR")}원`;
}

function fmtSignedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function compactKrw(value: number): string {
  const amount = Math.max(0, Math.round(toFiniteNumber(value, 0)));
  if (amount >= 100_000_000 && amount % 10_000_000 === 0) {
    return `${(amount / 100_000_000).toLocaleString("ko-KR")}억원`;
  }
  if (amount >= 10_000 && amount % 10_000 === 0) {
    return `${(amount / 10_000).toLocaleString("ko-KR")}만원`;
  }
  return fmtKrw(amount);
}

function entryTitle(entry: MirrorOrderEntry): string {
  const label = entry.name ? `${entry.name}(${entry.code})` : entry.code;
  const kindLabel =
    entry.side === "SELL"
      ? SELL_KIND_LABEL[entry.kind as MirrorSellKind] ?? "매도"
      : BUY_KIND_LABEL[entry.kind as MirrorBuyKind] ?? "매수";
  return `${label} · ${kindLabel}`;
}

function describeScaleLine(scale: MirrorScale): string {
  if (scale.basis === "virtual-only") {
    return "실투자금 미설정 → 가상 수량 그대로 표기 (/투자금 으로 실투자금을 설정하면 자동 환산)";
  }
  if (scale.ratio === 1) {
    return `실투자금 ${compactKrw(scale.realCapital)} = 가상시드와 동일 → 수량 그대로 사용`;
  }
  return `실투자금 ${compactKrw(scale.realCapital)} / 가상시드 ${compactKrw(scale.virtualSeedCapital)} = ${scale.ratio.toFixed(2)}배 환산`;
}

/**
 * MTS 따라하기 주문서 메시지를 생성한다. 주문 항목이 없으면 null.
 * 매도(리스크 대응)가 먼저, 매수가 뒤에 온다.
 */
export function buildMirrorOrderSheet(input: {
  entries: MirrorOrderEntry[];
  scale: MirrorScale;
  isShadow?: boolean;
}): string | null {
  const entries = (input.entries ?? []).filter((entry) => entry.virtualQuantity > 0 && entry.limitPrice > 0);
  if (!entries.length) return null;

  const scale = input.scale;
  const sells = entries.filter((entry) => entry.side === "SELL");
  const buys = entries.filter((entry) => entry.side === "BUY");

  const lines: string[] = [
    `${input.isShadow ? "[섀도우] " : ""}[MTS 따라하기 주문서]`,
    describeScaleLine(scale),
  ];

  sells.forEach((entry, index) => {
    const qty = scaleMirrorQuantity(entry.virtualQuantity, scale);
    const remainVirtual = Math.max(0, Math.floor(toFiniteNumber(entry.virtualRemainQuantity, 0)));
    const qtySuffix = scale.basis === "real-capital" && scale.ratio !== 1 ? ` (가상 ${entry.virtualQuantity}주)` : "";
    lines.push("");
    lines.push(`[매도 ${index + 1}] ${entryTitle(entry)}`);
    lines.push(
      `- 지정가 매도 ${fmtKrw(entry.limitPrice)} × ${qty}주${qtySuffix}${remainVirtual > 0 ? ` · 잔여 ${remainVirtual}주 보유 유지` : " (전량)"}`
    );
    if (entry.pnlPct != null) {
      lines.push(`- 가상계좌 손익률 ${fmtSignedPct(entry.pnlPct)}`);
    }
  });

  buys.forEach((entry, index) => {
    const qty = scaleMirrorQuantity(entry.virtualQuantity, scale);
    const qtySuffix = scale.basis === "real-capital" && scale.ratio !== 1 ? ` (가상 ${entry.virtualQuantity}주)` : "";
    lines.push("");
    lines.push(`[매수 ${index + 1}] ${entryTitle(entry)}`);
    lines.push(`- 지정가 매수 ${fmtKrw(entry.limitPrice)} × ${qty}주${qtySuffix} = ${fmtKrw(entry.limitPrice * qty)}`);
    if (entry.stopLossPrice) {
      lines.push(`- 손절 감시매도 ${fmtKrw(entry.stopLossPrice)} (${fmtSignedPct(-(entry.stopLossPct ?? 0))})`);
    }
    if (entry.takeProfitPrice) {
      lines.push(`- 익절 감시매도 ${fmtKrw(entry.takeProfitPrice)} (${fmtSignedPct(entry.takeProfitPct ?? 0)})`);
    }
  });

  lines.push("");
  lines.push("토스증권 입력: 종목 검색 → 지정가·수량 입력 → 주문 → (매수 시) 주문설정·자동주문에서 손절/익절가 등록");
  lines.push("※ 가격은 KRX 호가단위로 보정됨 · 수량 환산은 버림(최소 1주) · 시세가 지정가를 벗어나면 호가를 조정하세요.");
  if (input.isShadow) {
    lines.push("※ 섀도우 모드: 가상 계좌에는 반영되지 않은 시뮬레이션 체결입니다.");
  }

  return lines.join("\n");
}
