/**
 * 가상매매 원장 정합성 자가검증 서비스
 *
 * 매일 한 번 다음 불변식을 검산해 ✅/❌ 한 줄 보고를 만든다.
 * 1. 현금 원장: virtual_cash = 시드 − Σ매수 net + Σ매도 net
 * 2. 수량 원장: 종목별 Σ매수수량 − Σ매도수량 = virtual_positions 보유수량
 * 3. 시세 가용성: 보유 종목마다 최근 시세(stock_daily)가 존재하는지
 *
 * ADJUST(수동조정) 이력이 있는 계정/종목은 원장이 의도적으로 끊긴 것이므로
 * 오류 대신 "추정치" 상태로 보고해 오탐을 막는다.
 */

export type AuditTradeRow = {
  code: string;
  side: string;
  quantity: number | null;
  net_amount: number | string | null;
};

export type AuditPositionRow = {
  code: string;
  quantity: number | null;
  status?: string | null;
};

export type LedgerIssue = {
  type: "cash-mismatch" | "quantity-mismatch" | "oversell";
  code?: string;
  detail: string;
};

export type ChatLedgerResult = {
  chatId: number;
  seedCapital: number;
  actualCash: number;
  expectedCash: number;
  cashDiff: number;
  cashTolerance: number;
  /** ok=일치, mismatch=불일치, estimated=ADJUST 이력으로 검산 불가(참고용) */
  cashStatus: "ok" | "mismatch" | "estimated";
  adjustCount: number;
  tradeCount: number;
  holdingCount: number;
  issues: LedgerIssue[];
};

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function reconcileChatLedger(input: {
  chatId: number;
  seedCapital: number;
  virtualCash: number;
  trades: AuditTradeRow[];
  positions: AuditPositionRow[];
}): ChatLedgerResult {
  const issues: LedgerIssue[] = [];
  const seedCapital = Math.max(0, toNum(input.seedCapital));
  const actualCash = Math.max(0, toNum(input.virtualCash));

  let buyTotal = 0;
  let sellTotal = 0;
  let adjustCount = 0;
  const qtyByCode = new Map<string, number>();
  const adjustedCodes = new Set<string>();

  for (const trade of input.trades) {
    const side = String(trade.side ?? "").trim().toUpperCase();
    const qty = Math.max(0, Math.floor(toNum(trade.quantity)));
    const net = toNum(trade.net_amount);
    const code = String(trade.code ?? "").trim();

    if (side === "BUY") {
      buyTotal += net;
      qtyByCode.set(code, (qtyByCode.get(code) ?? 0) + qty);
    } else if (side === "SELL") {
      sellTotal += net;
      qtyByCode.set(code, (qtyByCode.get(code) ?? 0) - qty);
    } else if (side === "ADJUST") {
      adjustCount += 1;
      adjustedCodes.add(code);
    }
  }

  const expectedCash = Math.round(seedCapital - buyTotal + sellTotal);
  const cashDiff = Math.round(actualCash - expectedCash);
  const cashTolerance = Math.max(1_000, Math.round(seedCapital * 0.001));

  let cashStatus: ChatLedgerResult["cashStatus"];
  if (adjustCount > 0) {
    cashStatus = "estimated";
  } else if (Math.abs(cashDiff) <= cashTolerance) {
    cashStatus = "ok";
  } else {
    cashStatus = "mismatch";
    issues.push({
      type: "cash-mismatch",
      detail: `현금 차이 ${cashDiff.toLocaleString()}원 (기대 ${expectedCash.toLocaleString()} / 실제 ${actualCash.toLocaleString()})`,
    });
  }

  // 수량 검산: 거래 누적 수량 vs 보유 수량
  const heldByCode = new Map<string, number>();
  let holdingCount = 0;
  for (const position of input.positions) {
    const status = String(position.status ?? "holding").trim().toLowerCase();
    const qty = Math.max(0, Math.floor(toNum(position.quantity)));
    if (status !== "holding" || qty <= 0) continue;
    holdingCount += 1;
    const code = String(position.code ?? "").trim();
    heldByCode.set(code, (heldByCode.get(code) ?? 0) + qty);
  }

  const allCodes = new Set<string>([...qtyByCode.keys(), ...heldByCode.keys()]);
  for (const code of allCodes) {
    if (adjustedCodes.has(code)) continue; // 수동조정 이력 종목은 검산 제외
    const fromTrades = qtyByCode.get(code) ?? 0;
    const held = heldByCode.get(code) ?? 0;
    if (fromTrades < 0) {
      issues.push({
        type: "oversell",
        code,
        detail: `매도 수량이 매수 누적을 초과 (${fromTrades}주)`,
      });
      continue;
    }
    if (fromTrades !== held) {
      issues.push({
        type: "quantity-mismatch",
        code,
        detail: `거래누적 ${fromTrades}주 vs 보유 ${held}주`,
      });
    }
  }

  return {
    chatId: input.chatId,
    seedCapital,
    actualCash,
    expectedCash,
    cashDiff,
    cashTolerance,
    cashStatus,
    adjustCount,
    tradeCount: input.trades.length,
    holdingCount,
    issues,
  };
}

export type IntegrityReportInput = {
  ymd: string;
  results: ChatLedgerResult[];
  /** 최근 시세가 없는 보유 종목 코드 목록 */
  staleHoldingCodes: string[];
  /** dataFreshnessMonitorService의 다이제스트 한 줄 (없으면 생략) */
  freshnessDigest?: string | null;
};

export function countIntegrityIssues(input: Pick<IntegrityReportInput, "results" | "staleHoldingCodes">): number {
  const ledgerIssues = input.results.reduce((acc, cur) => acc + cur.issues.length, 0);
  return ledgerIssues + (input.staleHoldingCodes.length > 0 ? 1 : 0);
}

export function buildIntegrityReportMessage(input: IntegrityReportInput): string {
  const issueCount = countIntegrityIssues(input);
  const totalHoldings = input.results.reduce((acc, cur) => acc + cur.holdingCount, 0);
  const totalTrades = input.results.reduce((acc, cur) => acc + cur.tradeCount, 0);
  const estimatedCount = input.results.filter((row) => row.cashStatus === "estimated").length;

  const lines: string[] = [`[정합성 검산] ${input.ymd}`];

  if (issueCount === 0) {
    lines.push(
      `✅ 원장 정상 · 계정 ${input.results.length} · 보유 ${totalHoldings}종목 · 거래 ${totalTrades}건`
    );
  } else {
    lines.push(`❌ 이상 ${issueCount}건 발견 · 계정 ${input.results.length}`);
    for (const result of input.results) {
      for (const issue of result.issues.slice(0, 5)) {
        const codeText = issue.code ? ` ${issue.code}` : "";
        lines.push(`- chat ${result.chatId}${codeText}: ${issue.detail}`);
      }
      if (result.issues.length > 5) {
        lines.push(`- chat ${result.chatId}: 그 외 ${result.issues.length - 5}건 생략`);
      }
    }
  }

  if (estimatedCount > 0) {
    lines.push(`ℹ️ 수동조정(ADJUST) 이력 계정 ${estimatedCount}건은 현금 검산을 참고치로만 표시`);
  }

  if (input.staleHoldingCodes.length > 0) {
    const head = input.staleHoldingCodes.slice(0, 5).join(", ");
    const rest = input.staleHoldingCodes.length - Math.min(5, input.staleHoldingCodes.length);
    lines.push(`⚠️ 시세 누락 보유종목: ${head}${rest > 0 ? ` 외 ${rest}건` : ""} (최근 영업일 시세 없음)`);
  }

  if (input.freshnessDigest) {
    lines.push(input.freshnessDigest);
  }

  return lines.join("\n");
}
