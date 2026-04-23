import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";
import { fetchLatestScoresByCodes } from "./scoreSourceService";
import { parsePositionStrategyState } from "./virtualAutoTradePositionStrategy";

type SupabaseClientAny = any;

type LongHoldingRow = {
  code: string;
  buy_price?: number | null;
  quantity?: number | null;
  memo?: string | null;
  bucket?: string | null;
};

type ScoreSignal = {
  totalScore: number;
};

export type LongTermCoachResult = {
  hasLongHoldings: boolean;
  shouldNotify: boolean;
  alertCount: number;
  holdCount: number;
  text?: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function kstDateKey(base = new Date()): string {
  const d = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveLongBucket(row: LongHoldingRow): boolean {
  const bucket = String(row.bucket ?? "").trim().toUpperCase();
  if (bucket === "LONG") return true;
  const profile = parsePositionStrategyState(row.memo).profile;
  return profile === "POSITION_CORE";
}

function resolveSignalByCode(snapshot: {
  byCode: Map<string, { total_score?: number | null }>;
}, code: string): ScoreSignal {
  const row = snapshot.byCode.get(code);
  return {
    totalScore: toNumber(row?.total_score, 0),
  };
}

function shouldSendWeeklyHoldPulse(now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  return day === 1 || day === 4;
}

function extractLastCoachDateKey(raw?: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return kstDateKey(d);
}

export async function runLongTermCoachForChat(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  lastCoachAt?: string | null;
  forceNotify?: boolean;
}): Promise<LongTermCoachResult> {
  const { supabase, chatId, forceNotify = false } = input;

  const [withBucketResp, fallbackResp] = await Promise.all([
    supabase
      .from("virtual_positions")
      .select("code, buy_price, quantity, memo, bucket")
      .eq("chat_id", chatId)
      .eq("status", "holding"),
    supabase
      .from("virtual_positions")
      .select("code, buy_price, quantity, memo")
      .eq("chat_id", chatId)
      .eq("status", "holding"),
  ]);

  const rows = (!withBucketResp.error ? withBucketResp.data : fallbackResp.data) as LongHoldingRow[] | null;
  const holdings = (rows ?? []).filter(resolveLongBucket);

  if (!holdings.length) {
    return {
      hasLongHoldings: false,
      shouldNotify: false,
      alertCount: 0,
      holdCount: 0,
    };
  }

  const codes = holdings.map((row) => String(row.code));
  const [snapshot, realtimeMap] = await Promise.all([
    fetchLatestScoresByCodes(supabase, codes).catch(() => null),
    fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, { price?: number }>)),
  ]);

  if (!snapshot) {
    return {
      hasLongHoldings: true,
      shouldNotify: false,
      alertCount: 0,
      holdCount: 0,
    };
  }

  const reviewLines: string[] = [];
  const holdLines: string[] = [];

  for (const row of holdings) {
    const code = String(row.code);
    const score = resolveSignalByCode(snapshot, code);
    const buyPrice = toNumber(row.buy_price, 0);
    const nowPrice = toNumber((realtimeMap as Record<string, { price?: number }>)[code]?.price, buyPrice);
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    const pnlPct = buyPrice > 0 && nowPrice > 0 ? ((nowPrice - buyPrice) / buyPrice) * 100 : 0;

    if (score.totalScore < 45 || (score.totalScore < 52 && pnlPct <= 0)) {
      reviewLines.push(
        `${code} · 점수 ${score.totalScore.toFixed(1)} · 수익률 ${pnlPct.toFixed(1)}%`
      );
      continue;
    }

    if (score.totalScore >= 60) {
      holdLines.push(
        `${code} · 점수 ${score.totalScore.toFixed(1)} · 수익률 ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%${qty > 0 ? ` · 보유 ${qty}주` : ""}`
      );
    }
  }

  const todayKey = kstDateKey();
  const lastCoachKey = extractLastCoachDateKey(input.lastCoachAt);
  const hasReviewAlert = reviewLines.length > 0;
  const weeklyPulse = shouldSendWeeklyHoldPulse();
  const shouldNotify = forceNotify || hasReviewAlert || (weeklyPulse && lastCoachKey !== todayKey && holdLines.length > 0);

  if (!shouldNotify) {
    return {
      hasLongHoldings: true,
      shouldNotify: false,
      alertCount: reviewLines.length,
      holdCount: holdLines.length,
    };
  }

  const lines: string[] = ["[장기 코어 코칭]"];

  if (hasReviewAlert) {
    lines.push("매도 검토 필요 포지션이 감지되었습니다.");
    lines.push(...reviewLines.slice(0, 5).map((line) => `- ${line}`));
  } else {
    lines.push("현재 장기 코어 포지션은 보유 유지 우위입니다.");
    lines.push(...holdLines.slice(0, 4).map((line) => `- ${line}`));
  }

  const totalLongValue = holdings.reduce((sum, row) => {
    const price = toNumber((realtimeMap as Record<string, { price?: number }>)[String(row.code)]?.price, toNumber(row.buy_price, 0));
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    return sum + price * qty;
  }, 0);

  if (totalLongValue > 0) {
    lines.push(`장기 버킷 평가금액: ${fmtKrw(totalLongValue)}`);
  }

  lines.push("상세 점검: /보유 · /보유대응");

  return {
    hasLongHoldings: true,
    shouldNotify: true,
    alertCount: reviewLines.length,
    holdCount: holdLines.length,
    text: lines.join("\n"),
  };
}
