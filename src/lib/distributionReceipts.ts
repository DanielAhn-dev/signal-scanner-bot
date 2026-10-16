/**
 * 실계좌 분배금 받은 기록 — 종목·받은 수량·주당 분배금·세후 입금액(선택)을 사용자가 적는다(2026-10-16 사용자 요청).
 *
 * 왜: 분배율 추정(최근 12개월·상품 유형 가정)은 이번 달 실제 수준과 어긋나고(타겟 커버드콜은 주가에 따라 주당 분배금이 바뀐다),
 * 세금도 15.4%를 일괄로 뗀다. 국내 커버드콜처럼 과세표준이 분배금보다 작은 상품은 실제 입금이 더 많다.
 * 받은 기록이 있으면 "가장 최근 주당 분배금 × 지금 수량 × 그 종목의 실제 세후 비율"로 다음 달을 예상한다.
 *
 * 저장: 리밸런싱 가이드 파일(Storage income-guide/{chatId}.json)의 receipts. DB 마이그레이션 없음.
 */

export const RECEIPT_TAX_RATE = 0.154;
/** 이보다 오래된 기록은 다음 달 예상에 쓰지 않는다(분배 수준이 바뀌었을 수 있다) */
export const RECEIPT_STALE_MONTHS = 3;
export const MAX_RECEIPTS = 600;

export type DistributionReceipt = {
  id: string;
  /** 입금된 달 YYYY-MM */
  month: string;
  code: string;
  name: string;
  /** 받은 수량(기준일 기준 보유 수량) */
  quantity: number;
  /** 주당 분배금(원, 세전) */
  perShare: number;
  /** 실제 입금액(세후, 원). 없으면 15.4%를 떼고 계산하고 '추정'으로 표시한다 */
  net: number | null;
  createdAt: string;
};

const isMonth = (v: unknown): v is string => typeof v === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
const posNum = (v: unknown, max: number): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

/** 입력 검증 — 틀리면 이유 문자열 */
export function sanitizeReceipt(input: any, now: string, makeId: () => string): DistributionReceipt | string {
  if (!isMonth(input?.month)) return "입금된 달(YYYY-MM)이 필요합니다.";
  const code = String(input?.code ?? "").trim();
  if (!/^[0-9A-Z]{6}$/.test(code)) return "종목 코드가 올바르지 않습니다.";
  const quantity = posNum(input?.quantity, 1e9);
  if (quantity == null || !Number.isInteger(quantity)) return "받은 수량은 1주 이상 정수로 적어 주세요.";
  const perShare = posNum(input?.perShare, 1e7);
  if (perShare == null) return "주당 분배금(원)을 적어 주세요.";
  const rawNet = input?.net;
  let net: number | null = null;
  if (rawNet !== undefined && rawNet !== null && String(rawNet).trim() !== "") {
    const n = posNum(rawNet, 1e11);
    if (n == null) return "세후 입금액이 올바르지 않습니다.";
    // 세후가 세전보다 클 수는 없다(오타 방지). 반올림 여유 1원
    if (n > quantity * perShare + 1) return "세후 입금액이 세전(수량 × 주당)보다 큽니다. 숫자를 확인해 주세요.";
    net = Math.round(n);
  }
  return {
    id: typeof input?.id === "string" && input.id ? input.id.slice(0, 40) : makeId(),
    month: input.month,
    code,
    name: String(input?.name ?? code).slice(0, 60),
    quantity,
    perShare,
    net,
    createdAt: now,
  };
}

export function sanitizeReceipts(list: unknown): DistributionReceipt[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r: any) => r && isMonth(r.month) && typeof r.code === "string" && r.quantity > 0 && r.perShare > 0)
    .map((r: any) => ({
      id: String(r.id ?? `${r.month}-${r.code}`),
      month: r.month,
      code: r.code,
      name: String(r.name ?? r.code),
      quantity: Number(r.quantity),
      perShare: Number(r.perShare),
      net: r.net == null ? null : Number(r.net),
      createdAt: String(r.createdAt ?? ""),
    }))
    .slice(-MAX_RECEIPTS);
}

/** 세전 = 수량 × 주당 */
export const receiptGross = (r: DistributionReceipt) => Math.round(r.quantity * r.perShare);
/** 세후 = 적은 입금액, 없으면 15.4%를 뗀 값 */
export const receiptNet = (r: DistributionReceipt) => (r.net != null ? r.net : Math.round(receiptGross(r) * (1 - RECEIPT_TAX_RATE)));

export function monthSummary(receipts: DistributionReceipt[], month: string) {
  const items = receipts.filter((r) => r.month === month);
  return {
    month,
    items,
    gross: items.reduce((s, r) => s + receiptGross(r), 0),
    net: items.reduce((s, r) => s + receiptNet(r), 0),
    /** 세후를 적지 않아 15.4%로 계산한 건수 */
    estimatedCount: items.filter((r) => r.net == null).length,
  };
}

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export type ProjectionRow = {
  code: string;
  name: string;
  quantity: number;
  /** 다음 달 세후 예상 */
  net: number;
  source: "receipt" | "estimate";
  /** receipt: 최근 주당 분배금 */
  perShare: number | null;
  /** receipt: 실제 세후 비율(세후 ÷ 세전), 세후를 안 적었으면 1 − 15.4% */
  netRatio: number | null;
  /** receipt: 지급 간격(달). 기록 간격으로 짐작하고 기록이 하나면 1 */
  intervalMonths: number | null;
  /** receipt: 받은 수량보다 지금 몇 주 늘었나 */
  addedShares: number;
};

/**
 * 다음 달 세후 분배금 예상 — 종목별로 가장 최근 받은 기록이 있으면 (주당 × 지금 수량 × 실제 세후 비율 ÷ 지급 간격),
 * 없으면 최근 12개월 분배율 추정(estimateMonthlyNet)을 쓴다.
 */
export function projectNextMonth(input: {
  receipts: DistributionReceipt[];
  holdings: Array<{ code: string; name: string; quantity: number }>;
  /** 기록이 없는 종목의 월 세후 추정 */
  estimateMonthlyNet: (code: string) => number;
  today: string;
}): { total: number; fromReceipts: number; fromEstimate: number; receiptCodes: number; rows: ProjectionRow[] } {
  const nowIdx = monthIndex(input.today.slice(0, 7));
  const byCode = new Map<string, DistributionReceipt[]>();
  for (const r of input.receipts) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const qtyByCode = new Map<string, { name: string; quantity: number }>();
  for (const h of input.holdings) {
    const cur = qtyByCode.get(h.code);
    qtyByCode.set(h.code, { name: h.name, quantity: (cur?.quantity ?? 0) + h.quantity });
  }
  const rows: ProjectionRow[] = [];
  for (const [code, { name, quantity }] of qtyByCode) {
    if (!(quantity > 0)) continue;
    const list = (byCode.get(code) ?? []).filter((r) => nowIdx - monthIndex(r.month) < RECEIPT_STALE_MONTHS);
    if (list.length) {
      const latest = [...list].sort((a, b) => a.month.localeCompare(b.month) || a.createdAt.localeCompare(b.createdAt)).at(-1)!;
      const months = [...new Set((byCode.get(code) ?? []).map((r) => monthIndex(r.month)))].sort((a, b) => a - b);
      const gaps = months.slice(1).map((m, i) => m - months[i]).filter((g) => g >= 1 && g <= 12);
      const interval = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 1;
      const netRatio = latest.net != null ? latest.net / Math.max(1, receiptGross(latest)) : 1 - RECEIPT_TAX_RATE;
      rows.push({
        code,
        name,
        quantity,
        net: Math.round((latest.perShare * quantity * netRatio) / interval),
        source: "receipt",
        perShare: latest.perShare,
        netRatio,
        intervalMonths: interval,
        addedShares: quantity - latest.quantity,
      });
    } else {
      const net = Math.round(Math.max(0, input.estimateMonthlyNet(code)));
      if (net > 0) rows.push({ code, name, quantity, net, source: "estimate", perShare: null, netRatio: null, intervalMonths: null, addedShares: 0 });
    }
  }
  rows.sort((a, b) => b.net - a.net);
  const fromReceipts = rows.filter((r) => r.source === "receipt").reduce((s, r) => s + r.net, 0);
  const fromEstimate = rows.filter((r) => r.source === "estimate").reduce((s, r) => s + r.net, 0);
  return { total: fromReceipts + fromEstimate, fromReceipts, fromEstimate, receiptCodes: rows.filter((r) => r.source === "receipt").length, rows };
}
