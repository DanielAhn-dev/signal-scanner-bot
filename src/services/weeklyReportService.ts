import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, PDFPage, PDFFont, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";

// ─── 색상 팔레트 (증권사 리포트 스타일) ─────────────────────────────────
const C = {
  navy:      rgb(0.06, 0.14, 0.35),
  navyLight: rgb(0.10, 0.20, 0.50),
  accent:    rgb(0.96, 0.38, 0.07),
  up:        rgb(0.80, 0.08, 0.08),
  down:      rgb(0.10, 0.45, 0.75),
  neutral:   rgb(0.35, 0.35, 0.35),
  white:     rgb(1.00, 1.00, 1.00),
  bg:        rgb(0.96, 0.96, 0.97),
  border:    rgb(0.78, 0.80, 0.84),
  text:      rgb(0.10, 0.10, 0.12),
  muted:     rgb(0.50, 0.50, 0.55),
} as const;

// ─── 타입 정의 ────────────────────────────────────────────────────────────
type TradeRow = {
  side: "BUY" | "SELL";
  code: string;
  price: number | null;
  quantity: number | null;
  pnl_amount: number | null;
  traded_at: string;
};

type WatchlistRow = {
  code: string;
  buy_price: number | null;
  quantity: number | null;
  invested_amount: number | null;
  status: string | null;
  stock:
    | { code: string; name: string; close: number | null }
    | { code: string; name: string; close: number | null }[]
    | null;
};

type SectorRow = {
  name: string;
  score: number | null;
  change_rate: number | null;
  metrics?: Record<string, unknown> | null;
};

type ReportTopic = "full" | "watchlist" | "economy" | "flow" | "sector";

type WindowSummary = {
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  realizedPnl: number;
  winRate: number;
};

type WatchItem = {
  code: string;
  name: string;
  qty: number;
  buyPrice: number | null;
  currentPrice: number | null;
  invested: number;
  value: number;
  unrealized: number;
  pnlPct: number | null;
};

export type WeeklyPdfReport = {
  bytes: Uint8Array;
  fileName: string;
  caption: string;
  summaryText: string;
  title: string;
  topic: ReportTopic;
};

type ReportTopicMeta = {
  topic: ReportTopic;
  title: string;
  fileSlug: string;
  includeCover: boolean;
  progressText: string;
  captionTitle: string;
};

type ReportTheme = {
  pageBand: RGB;
  sectionBand: RGB;
  accent: RGB;
  softBg: RGB;
  border: RGB;
  subtitle: RGB;
  heroLabel: string;
  heroSummary: string;
};

export type WeeklyReportFailureStep =
  | "trade_query"
  | "watchlist_query"
  | "sector_query"
  | "market_data"
  | "realtime_price"
  | "font_load"
  | "pdf_render"
  | "pdf_save";

const WEEKLY_REPORT_STEP_LABEL: Record<WeeklyReportFailureStep, string> = {
  trade_query: "거래 내역 조회",
  watchlist_query: "보유 종목 조회",
  sector_query: "섹터 데이터 조회",
  market_data: "시장 데이터 조회",
  realtime_price: "실시간 가격 조회",
  font_load: "PDF 폰트 로드",
  pdf_render: "PDF 렌더링",
  pdf_save: "PDF 저장",
};

export class WeeklyReportError extends Error {
  readonly step: WeeklyReportFailureStep;
  readonly detail: string;
  readonly cause?: unknown;

  constructor(step: WeeklyReportFailureStep, detail: string, cause?: unknown) {
    super(`[WeeklyReport:${step}] ${detail}`);
    this.name = "WeeklyReportError";
    this.step = step;
    this.detail = detail;
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function runReportStep<T>(
  step: WeeklyReportFailureStep,
  fn: () => PromiseLike<T> | T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WeeklyReportError) throw error;
    throw new WeeklyReportError(
      step,
      `${WEEKLY_REPORT_STEP_LABEL[step]} 중 오류가 발생했습니다. ${errorMessage(error)}`,
      error
    );
  }
}

export function describeWeeklyReportFailure(error: unknown): string {
  if (error instanceof WeeklyReportError) {
    return `${WEEKLY_REPORT_STEP_LABEL[error.step]} 실패: ${error.detail}`;
  }
  if (error instanceof Error && /^TIMEOUT:/i.test(error.message)) {
    return `처리 시간 초과: ${error.message.replace(/^TIMEOUT:\s*/i, "")}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

// ─── 포맷 유틸 ────────────────────────────────────────────────────────────
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtInt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}
function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function fmtSignedInt(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtInt(v)}원`;
}
function asKstDate(d: Date): Date {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}
function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toKrDate(d: Date): string {
  const kst = asKstDate(d);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}
function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
function lineDate(raw: string): string {
  const d = new Date(raw);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}
function pnlColor(v: number): RGB {
  if (v > 0) return C.up;
  if (v < 0) return C.down;
  return C.neutral;
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function fmtKorMoney(v: number): string {
  const safe = Math.round(v || 0);
  if (!Number.isFinite(safe) || safe === 0) return "0억";
  const eok = Math.round(safe / 100_000_000);
  const jo = Math.floor(Math.abs(eok) / 10_000);
  const restEok = Math.abs(eok) % 10_000;
  const sign = eok < 0 ? "-" : "+";
  if (jo > 0) {
    return restEok > 0 ? `${sign}${jo}조 ${restEok.toLocaleString("ko-KR")}억` : `${sign}${jo}조`;
  }
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR")}억`;
}

function parseReportTopic(raw?: string | null): ReportTopicMeta {
  const token = String(raw ?? "").trim().toLowerCase();

  if (!token || ["기본", "전체", "종합", "시장", "full", "all", "weekly", "week", "관심", "관심종목", "watch", "watchlist"].includes(token)) {
    return {
      topic: "full",
      title: "주간 증시 리포트",
      fileSlug: "weekly_market_report",
      includeCover: true,
      progressText: "주간 증시 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "주간 증시 리포트",
    };
  }

  if (["경제", "거시", "매크로", "macro", "economy", "결제", "지표", "거시지표"].includes(token)) {
    return {
      topic: "economy",
      title: "거시 지표 리포트",
      fileSlug: "economy_report",
      includeCover: false,
      progressText: "거시 지표 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "거시 지표 리포트",
    };
  }

  if (["수급", "자금", "자금흐름", "flow", "flowreport"].includes(token)) {
    return {
      topic: "flow",
      title: "수급 리포트",
      fileSlug: "flow_report",
      includeCover: false,
      progressText: "수급 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "수급 리포트",
    };
  }

  if (["섹터", "업종", "테마", "sector", "rotation", "로테이션"].includes(token)) {
    return {
      topic: "sector",
      title: "섹터 리포트",
      fileSlug: "sector_report",
      includeCover: false,
      progressText: "섹터 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "섹터 리포트",
    };
  }

  return {
    topic: "watchlist",
    title: "관심종목 리포트",
    fileSlug: "watchlist_report",
    includeCover: false,
    progressText: "관심종목 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
    captionTitle: "관심종목 리포트",
  };
}

function buildTopicHeroSummary(input: {
  topic: ReportTopic;
  defaultSummary: string;
  curr: WindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  watchItems: WatchItem[];
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
}): string {
  const { topic, defaultSummary, curr, totalUnrealized, totalUnrealizedPct, watchItems, sectors, market } = input;

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const fearGreed = toNum((market as any).fearGreed?.score);
    const vixLabel = vix >= 30 ? "고변동성" : vix >= 20 ? "경계" : "안정";
    const sentimentLabel = fearGreed <= 25 ? "공포" : fearGreed >= 75 ? "탐욕" : "중립";
    if (vix > 0 || usdkrw > 0 || fearGreed > 0) {
      return `VIX ${vix > 0 ? vix.toFixed(1) : "-"}, 환율 ${usdkrw > 0 ? fmtInt(usdkrw) + "원" : "-"}, 심리 ${sentimentLabel} 구간으로 현재 시장 체온은 ${vixLabel}에 가깝습니다.`;
    }
  }

  if (topic === "flow") {
    const ranked = sectors
      .map((sector) => {
        const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
        const totalFlow = toNum(metrics.flow_foreign_5d) + toNum(metrics.flow_inst_5d);
        return { name: sector.name, totalFlow };
      })
      .filter((row) => row.totalFlow !== 0)
      .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow));
    if (ranked.length > 0) {
      const top = ranked[0];
      return `${top.name} 섹터에 최근 5거래일 기준 ${fmtKorMoney(top.totalFlow)} 규모의 순유입이 관측돼 자금 집중도가 가장 높습니다.`;
    }
  }

  if (topic === "sector") {
    const top = sectors[0];
    if (top) {
      return `${top.name}가 점수 ${toNum(top.score).toFixed(1)}점, 수익률 ${fmtPct(toNum(top.change_rate))}로 현재 강도 1위를 기록하고 있습니다.`;
    }
  }

  if (topic === "watchlist") {
    const worst = watchItems.filter((item) => item.pnlPct != null).sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0))[0];
    const best = watchItems.filter((item) => item.pnlPct != null).sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0))[0];
    if (watchItems.length > 0) {
      const highlight = best && worst && best.code !== worst.code
        ? `상단 점검 ${best.name} ${fmtPct(best.pnlPct ?? 0)}, 하단 점검 ${worst.name} ${fmtPct(worst.pnlPct ?? 0)}`
        : `평가손익 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`;
      return `보유 ${watchItems.length}종목 기준 ${highlight} 흐름입니다. 최근 2주 거래는 ${curr.tradeCount}건입니다.`;
    }
  }

  if (topic === "full") {
    const leadSector = sectors[0]?.name;
    if (leadSector) {
      return `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}), 최근 거래 ${curr.tradeCount}건, 주도 섹터는 ${leadSector} 중심입니다.`;
    }
  }

  return defaultSummary;
}

function buildTopicClosingSummary(input: {
  topic: ReportTopic;
  curr: WindowSummary;
  prev: WindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  watchItems: WatchItem[];
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
}): string {
  const { topic, curr, prev, totalUnrealized, totalUnrealizedPct, watchItems, sectors, market } = input;

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const us10y = toNum((market as any).us10y?.price);
    return vix >= 20 || us10y >= 5
      ? "거시 환경은 아직 공격적으로 보기 어렵습니다. 금리와 변동성이 진정될 때까지 분할 진입과 현금 비중 관리가 우선입니다."
      : "거시 리스크는 과열 구간이 아닙니다. 시장 방향 확인 후 주도 업종 중심 접근이 유효합니다.";
  }

  if (topic === "flow") {
    const top = sectors
      .map((sector) => {
        const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
        return {
          name: sector.name,
          totalFlow: toNum(metrics.flow_foreign_5d) + toNum(metrics.flow_inst_5d),
        };
      })
      .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow))[0];
    return top?.name
      ? `${top.name} 중심 자금 유입이 이어지는 동안은 역행 섹터보다 선도 섹터 눌림목 대응이 유리합니다.`
      : "뚜렷한 자금 집중 섹터가 약해 시장 순환매 속도가 빠를 수 있습니다. 추격 매수보다 확인 매수가 적절합니다.";
  }

  if (topic === "sector") {
    const leader = sectors[0]?.name;
    return leader
      ? `현재 1등 섹터인 ${leader}의 강도가 꺾이기 전까지는 하위 테마보다 선도 테마 대표 종목이 상대적으로 유리합니다.`
      : "섹터 강도 데이터가 약해 주도 테마 확신이 낮습니다. 시장 방향 확인 후 종목별 접근이 낫습니다.";
  }

  if (topic === "watchlist") {
    const losers = watchItems.filter((item) => (item.pnlPct ?? 0) < -5).length;
    return losers > 0
      ? `평가손실 -5% 초과 종목이 ${losers}개 있어 방어 우선 구간입니다. 비중과 손절 기준을 먼저 정리하는 편이 좋습니다.`
      : `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}) 기준으로 급한 방어 이슈는 크지 않습니다. 강한 종목 위주 압축이 유효합니다.`;
  }

  return curr.realizedPnl >= prev.realizedPnl
    ? "최근 실현손익 흐름이 이전 구간보다 개선됐습니다. 주도 섹터와 현재 보유 포지션을 함께 관리하는 현재 전략을 유지할 만합니다."
    : "최근 실현손익 흐름이 둔화됐습니다. 보유 종목 점검과 함께 진입 빈도를 한 단계 낮춰 리듬을 조절하는 편이 낫습니다.";
}

function buildCoverHeadline(input: {
  curr: WindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>>;
}): { kicker: string; detail: string } {
  const { curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;
  const leadSector = sectors[0]?.name ?? "주도 섹터 확인 중";
  const kospiMove = market.kospi ? fmtPct(toNum(market.kospi.changeRate)) : "-";
  const riskTone = market.vix
    ? toNum(market.vix.price) >= 30
      ? "고변동성"
      : toNum(market.vix.price) >= 20
      ? "경계"
      : "안정"
    : "중립";

  return {
    kicker: `${leadSector} 주도 · KOSPI ${kospiMove} · 시장 온도 ${riskTone}`,
    detail: `최근 거래 ${curr.tradeCount}건, 보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}) 흐름입니다.`,
  };
}

function buildReportCaption(input: {
  title: string;
  topic: ReportTopic;
  krDate: string;
  curr: WindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
}): string {
  const { title, topic, krDate, curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;

  if (topic === "economy") {
    return [
      `${title} — ${krDate}`,
      `VIX ${market.vix ? toNum(market.vix.price).toFixed(1) : "-"} · 환율 ${market.usdkrw ? `${fmtInt(toNum(market.usdkrw.price))}원` : "-"}`,
      "핵심 거시 변수만 빠르게 점검할 수 있게 정리했습니다.",
    ].join("\n");
  }

  if (topic === "flow") {
    const topSector = sectors[0]?.name ?? "상위 섹터";
    return [
      `${title} — ${krDate}`,
      `${topSector} 중심 수급 흐름과 상위 자금 유입 섹터를 정리했습니다.`,
      "자금 방향 위주로 빠르게 확인하세요.",
    ].join("\n");
  }

  if (topic === "sector") {
    const topSector = sectors[0]?.name ?? "주도 섹터";
    return [
      `${title} — ${krDate}`,
      `${topSector} 포함 상위 강도 섹터를 압축했습니다.`,
      "테마 로테이션 체크용으로 바로 볼 수 있습니다.",
    ].join("\n");
  }

  if (topic === "watchlist") {
    return [
      `${title} — ${krDate}`,
      `최근 거래 ${curr.tradeCount}건 · 보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
      "보유 종목 점검용으로 바로 활용할 수 있습니다.",
    ].join("\n");
  }

  return [
    `${title} — ${krDate}`,
    `거래 ${curr.tradeCount}건 · 실현손익 ${fmtSignedInt(curr.realizedPnl)} · 보유평가 ${fmtSignedInt(totalUnrealized)}`,
    "다운로드 후 인쇄해서 사용하세요.",
  ].join("\n");
}

function buildReportSummaryText(input: {
  title: string;
  topic: ReportTopic;
  ymd: string;
  curr: WindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
}): string {
  const { title, topic, ymd, curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;

  if (topic === "economy") {
    return [
      `${title} (${ymd})`,
      `VIX ${market.vix ? toNum(market.vix.price).toFixed(1) : "-"} / 환율 ${market.usdkrw ? `${fmtInt(toNum(market.usdkrw.price))}원` : "-"}`,
      `공포탐욕 ${market.fearGreed ? toNum(market.fearGreed.score) : "-"} / 미국 10년물 ${market.us10y ? `${toNum(market.us10y.price).toFixed(2)}%` : "-"}`,
    ].join("\n");
  }

  if (topic === "flow") {
    return [
      `${title} (${ymd})`,
      `상위 수급 섹터: ${sectors.slice(0, 3).map((sector) => sector.name).join(", ") || "데이터 없음"}`,
      `최근 5거래일 기준 자금 유입 방향을 압축했습니다.`,
    ].join("\n");
  }

  if (topic === "sector") {
    return [
      `${title} (${ymd})`,
      `상위 섹터: ${sectors.slice(0, 3).map((sector) => `${sector.name} ${toNum(sector.score).toFixed(1)}점`).join(" / ") || "데이터 없음"}`,
      `강도와 수익률 중심으로 정리했습니다.`,
    ].join("\n");
  }

  if (topic === "watchlist") {
    return [
      `${title} (${ymd})`,
      `거래 ${curr.tradeCount}건 / 실현손익 ${fmtSignedInt(curr.realizedPnl)} / 승률 ${curr.winRate.toFixed(1)}%`,
      `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
    ].join("\n");
  }

  return [
    `${title} (${ymd})`,
    `거래 ${curr.tradeCount}건 / 실현손익 ${fmtSignedInt(curr.realizedPnl)} / 승률 ${curr.winRate.toFixed(1)}%`,
    `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
  ].join("\n");
}

function getReportTheme(topic: ReportTopic): ReportTheme {
  if (topic === "economy") {
    return {
      pageBand: rgb(0.22, 0.17, 0.11),
      sectionBand: rgb(0.34, 0.25, 0.15),
      accent: rgb(0.80, 0.58, 0.18),
      softBg: rgb(0.98, 0.96, 0.91),
      border: rgb(0.85, 0.79, 0.68),
      subtitle: rgb(0.56, 0.46, 0.30),
      heroLabel: "MACRO SNAPSHOT",
      heroSummary: "금리, 환율, 변동성, 글로벌 위험선호를 한 페이지 감도로 정리합니다.",
    };
  }

  if (topic === "flow") {
    return {
      pageBand: rgb(0.06, 0.27, 0.40),
      sectionBand: rgb(0.08, 0.40, 0.54),
      accent: rgb(0.00, 0.70, 0.76),
      softBg: rgb(0.92, 0.98, 0.99),
      border: rgb(0.68, 0.84, 0.87),
      subtitle: rgb(0.28, 0.49, 0.55),
      heroLabel: "FLOW MONITOR",
      heroSummary: "외국인·기관 자금 방향을 중심으로 강한 섹터와 약한 섹터를 분리합니다.",
    };
  }

  if (topic === "sector") {
    return {
      pageBand: rgb(0.40, 0.17, 0.09),
      sectionBand: rgb(0.58, 0.25, 0.12),
      accent: rgb(0.95, 0.46, 0.18),
      softBg: rgb(0.99, 0.95, 0.92),
      border: rgb(0.90, 0.76, 0.68),
      subtitle: rgb(0.60, 0.34, 0.22),
      heroLabel: "SECTOR ROTATION",
      heroSummary: "점수와 수익률을 동시에 보며 현재 시장의 중심 테마를 압축합니다.",
    };
  }

  if (topic === "watchlist") {
    return {
      pageBand: rgb(0.06, 0.32, 0.24),
      sectionBand: rgb(0.10, 0.46, 0.35),
      accent: rgb(0.24, 0.73, 0.49),
      softBg: rgb(0.93, 0.98, 0.95),
      border: rgb(0.70, 0.86, 0.77),
      subtitle: rgb(0.26, 0.50, 0.40),
      heroLabel: "PORTFOLIO CHECK",
      heroSummary: "보유 종목의 손익, 거래 흐름, 대응 포인트를 빠르게 확인할 수 있게 정리합니다.",
    };
  }

  return {
    pageBand: C.navy,
    sectionBand: C.navyLight,
    accent: C.accent,
    softBg: rgb(0.95, 0.96, 0.98),
    border: C.border,
    subtitle: rgb(0.38, 0.46, 0.62),
    heroLabel: "WEEKLY OUTLOOK",
    heroSummary: "시장 환경, 포트폴리오 상태, 최근 거래와 주간 대응 전략을 한 번에 묶습니다.",
  };
}

// ─── 데이터 집계 유틸 ─────────────────────────────────────────────────────
function summarizeWindow(rows: TradeRow[]): WindowSummary {
  const buys = rows.filter((r) => r.side === "BUY");
  const sells = rows.filter((r) => r.side === "SELL");
  const realized = sells.reduce((acc, r) => acc + toNum(r.pnl_amount), 0);
  const winCount = sells.filter((r) => toNum(r.pnl_amount) > 0).length;
  const winRate = sells.length ? (winCount / sells.length) * 100 : 0;
  return { buyCount: buys.length, sellCount: sells.length, tradeCount: rows.length, realizedPnl: realized, winRate };
}

function unwrapStock(
  stock: WatchlistRow["stock"]
): { code: string; name: string; close: number | null } | null {
  if (!stock) return null;
  if (Array.isArray(stock)) return stock[0] ?? null;
  return stock;
}

function splitWindows(rows: TradeRow[], now: Date) {
  const currStart = shiftDays(now, -14).getTime();
  const prevStart = shiftDays(now, -28).getTime();
  return {
    current14: rows.filter((r) => new Date(r.traded_at).getTime() >= currStart),
    prev14:    rows.filter((r) => { const t = new Date(r.traded_at).getTime(); return t >= prevStart && t < currStart; }),
    recent:    rows.slice(0, 10),
  };
}

// ─── 폰트 로드 ────────────────────────────────────────────────────────────
async function loadKoreanFontBytes(): Promise<Uint8Array> {
  const fontPath = path.join(process.cwd(), "assets", "fonts", "NotoSansCJKkr-Regular.otf");
  try {
    return await readFile(fontPath);
  } catch (err: any) {
    const reason = err?.code === "ENOENT"
      ? `폰트 파일을 찾을 수 없습니다: ${fontPath}`
      : `폰트 로드 실패: ${err?.message ?? String(err)}`;
    throw new Error(`[PDF] ${reason}. 배포 산출물에 assets/fonts 포함 여부를 확인하세요.`);
  }
}

// ─── 텍스트 래핑 ─────────────────────────────────────────────────────────
// [FIX] NFC 정규화 후 Unicode 코드포인트 단위로 분리해 한글 자모 분리 방지
function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  if (!text) return [""];
  const normalized = text.normalize("NFC");
  // 코드포인트 단위 분리 (서로게이트 페어 포함 안전 처리)
  const chars = [...normalized];
  const lines: string[] = [];
  let current = "";

  for (const ch of chars) {
    const candidate = current + ch;
    try {
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = ch;
      }
    } catch {
      // 폰트에 없는 글리프는 그냥 추가
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ─── PDF 렌더 컨텍스트 ────────────────────────────────────────────────────
class ReportContext {
  pdf: PDFDocument;
  page!: PDFPage;
  font: PDFFont;
  theme: ReportTheme;
  readonly W = 595;
  readonly H = 842;
  readonly ML = 44;
  readonly MR = 44;
  readonly MT = 36;
  // [FIX] 하단 여백을 늘려 풋터가 잘리지 않도록
  readonly MB = 52;
  readonly BODY_W: number;
  y = 0;
  pageNum = 0;
  footerLabel: string | null = null;
  pageTitle: string | null = null;
  private pageFinalized = false;

  constructor(pdf: PDFDocument, font: PDFFont, theme: ReportTheme) {
    this.pdf = pdf;
    this.font = font;
    this.theme = theme;
    this.BODY_W = this.W - this.ML - this.MR;
  }

  addPage(pageTitle?: string | null) {
    this.finalizePage();
    this.page = this.pdf.addPage([this.W, this.H]);
    this.y = this.H - this.MT;
    this.pageNum++;
    this.pageFinalized = false;
    if (pageTitle !== undefined) this.pageTitle = pageTitle;
    if (this.pageTitle) drawPageTitle(this, this.pageTitle);
  }

  // [FIX] ensureSpace: 여유 버퍼를 추가해 경계 직전 요소가 잘리지 않도록
  ensureSpace(h: number, buffer = 8) {
    if (this.y < this.MB + h + buffer) this.addPage();
  }

  finalizePage() {
    if (!this.page || this.pageFinalized || !this.footerLabel) return;
    drawFooter(this, this.footerLabel);
    this.pageFinalized = true;
  }

  // [FIX] text: y는 "이 요소의 상단 기준"으로 통일. 내부에서 ascender 보정
  // size 기준 ascender ≈ size * 0.72 (NotoSansCJK 실측 근사값)
  text(
    s: string,
    x: number,
    y: number,
    size: number,
    color: RGB = C.text,
    maxW?: number
  ): number {
    const lineH = size + 4;
    const effectiveMax = maxW ?? this.BODY_W;
    const lines = wrapText(s, effectiveMax, this.font, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], {
        x,
        // pdf-lib의 y는 텍스트 baseline 기준이므로 상단 기준에서 변환
        y: y - size * 0.82 - i * lineH,
        size,
        font: this.font,
        color,
      });
    }
    return lines.length;
  }

  textRight(s: string, rightEdge: number, y: number, size: number, color: RGB = C.text) {
    const w = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, {
      x: rightEdge - w,
      y: y - size * 0.82,
      size,
      font: this.font,
      color,
    });
  }

  textCenter(s: string, cx: number, y: number, size: number, color: RGB = C.text) {
    const w = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, {
      x: cx - w / 2,
      y: y - size * 0.82,
      size,
      font: this.font,
      color,
    });
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = C.border, thickness = 0.5) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }
}

// ─── 페이지 풋터 ─────────────────────────────────────────────────────────
function drawFooter(ctx: ReportContext, today: string) {
  const { ML, MR, W, MB } = ctx;
  const lineY = MB - 2;
  const textY = MB - 16;
  ctx.line(ML, lineY, W - MR, lineY, ctx.theme.border);
  ctx.text(
    "가상 포트폴리오 기준 · 실제 투자 결과와 다를 수 있습니다.",
    ML, textY, 7, C.muted, W - ML - MR - 110
  );
  ctx.textRight(`발행: ${today}  |  ${ctx.pageNum}페이지`, W - MR, textY, 7, C.muted);
}

// ─── 섹션 헤더 밴드 ──────────────────────────────────────────────────────
// [FIX] 섹션 헤더 높이와 텍스트 수직 중앙 정렬 통일
const SECTION_H = 24;

function drawSectionHeader(ctx: ReportContext, label: string, sub?: string) {
  ctx.ensureSpace(SECTION_H + 20);
  const { ML, MR, W } = ctx;
  ctx.rect(ML, ctx.y - SECTION_H, W - ML - MR, SECTION_H, ctx.theme.sectionBand);
  // 텍스트를 배경 수직 중앙에 배치: y_top = ctx.y, 중앙 = ctx.y - SECTION_H/2
  const midY = ctx.y - SECTION_H / 2;
  ctx.text(label, ML + 8, midY + 5, 10, C.white);
  if (sub) ctx.textRight(sub, W - MR - 6, midY + 5, 8.5, rgb(0.75, 0.82, 0.95));
  ctx.y -= SECTION_H + 4;
}

// ─── KPI 카드 그리드 ─────────────────────────────────────────────────────
type KpiCard = { label: string; value: string; sub?: string; valueColor?: RGB };

// [FIX] 카드 내 텍스트 수직 배치를 고정 오프셋으로 통일
function drawKpiGrid(ctx: ReportContext, cards: KpiCard[], cols = 4) {
  const { ML, MR, W } = ctx;
  const gap = 6;
  const totalW = W - ML - MR;
  const cardW = (totalW - gap * (cols - 1)) / cols;
  const cardH = 52;
  const contentPadX = 12;
  const contentMaxW = cardW - contentPadX * 2;
  const rows = Math.ceil(cards.length / cols);

  ctx.ensureSpace(cardH * rows + gap * (rows - 1) + 10);

  const startX = ML;
  const startY = ctx.y;

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gap);
    // y = 카드 상단 y 좌표
    const y = startY - row * (cardH + gap);

    // 배경 및 테두리
    ctx.rect(x, y - cardH, cardW, cardH, ctx.theme.softBg);
    ctx.rect(x, y - cardH, 3, cardH, ctx.theme.accent);
    ctx.line(x,          y - cardH, x + cardW, y - cardH, ctx.theme.border);
    ctx.line(x + cardW,  y - cardH, x + cardW, y,          ctx.theme.border);
    ctx.line(x,          y,         x + cardW, y,           ctx.theme.border);

    if (!card.label && !card.value) return; // 빈 패딩 카드

    // [FIX] 라벨: 카드 상단에서 14px
    ctx.text(card.label, x + contentPadX, y - 10, 7.5, ctx.theme.subtitle, contentMaxW);
    // [FIX] 값: 카드 상단에서 30px (라벨 아래 적절한 간격)
    ctx.text(card.value, x + contentPadX, y - 26, 12, card.valueColor ?? C.text, contentMaxW);
    // [FIX] 서브: 카드 하단에서 8px
    if (card.sub) ctx.text(card.sub, x + contentPadX, y - 42, 7.5, ctx.theme.subtitle, contentMaxW);
  });

  ctx.y -= rows * (cardH + gap) - gap + 8;
}

function drawPortfolioSummaryRow(
  ctx: ReportContext,
  label: string,
  leftText: string,
  rightText: string,
  rightColor: RGB
) {
  const padX = 12;
  const labelW = 44;
  const safeGap = 20;
  const fontSize = 9;
  const baseH = 22;
  const leftX = ctx.ML + padX + labelW;
  const rightEdge = ctx.ML + ctx.BODY_W - padX;
  const leftW = ctx.font.widthOfTextAtSize(leftText, fontSize);
  const rightW = ctx.font.widthOfTextAtSize(rightText, fontSize);
  const needsWrap = leftX + leftW + safeGap > rightEdge - rightW;
  const rowH = needsWrap ? 34 : baseH;

  ctx.ensureSpace(rowH + 4);
  ctx.rect(ctx.ML, ctx.y - rowH, ctx.BODY_W, rowH, ctx.theme.softBg);
  ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, ctx.theme.border);
  ctx.line(ctx.ML, ctx.y - rowH, ctx.ML + ctx.BODY_W, ctx.y - rowH, ctx.theme.border);

  const labelY = needsWrap ? ctx.y - 11 : ctx.y - rowH / 2 + 5;
  ctx.text(label, ctx.ML + padX, labelY, fontSize, ctx.theme.sectionBand);

  if (needsWrap) {
    ctx.text(leftText, leftX, ctx.y - 11, fontSize, C.text);
    ctx.textRight(rightText, rightEdge, ctx.y - 23, fontSize, rightColor);
  } else {
    const lineY = ctx.y - rowH / 2 + 5;
    ctx.text(leftText, leftX, lineY, fontSize, C.text);
    ctx.textRight(rightText, rightEdge, lineY, fontSize, rightColor);
  }

  ctx.y -= rowH + 6;
}

// ─── 테이블 렌더러 ────────────────────────────────────────────────────────
type ColDef = { header: string; width: number; align?: "left" | "right" | "center" };

// [FIX] 행 높이와 텍스트 baseline 오프셋을 일관되게 재계산
const ROW_H   = 20;
const HEADER_H = 22;
const CELL_PAD = 4;
// 텍스트 상단 기준 y에서 셀 수직 중앙까지의 오프셋 (행 높이의 절반 + 폰트 절반)
// 실제 drawText는 ctx.text() 내부에서 baseline 변환하므로 여기선 "상단에서 몇 px"만 계산
function cellTextTopOffset(rowH: number, fontSize: number): number {
  // 텍스트를 행 수직 중앙에 배치: (rowH - fontSize) / 2
  return (rowH - fontSize) / 2;
}

function drawTable(
  ctx: ReportContext,
  cols: ColDef[],
  rows: string[][],
  rowColors?: (RGB | null)[]
) {
  const { ML } = ctx;
  const fontSize = 8.5;
  const totalW = cols.reduce((s, c) => s + c.width, 0);
  const topOffset = cellTextTopOffset(ROW_H, fontSize);
  const headerTopOffset = cellTextTopOffset(HEADER_H, fontSize);

  // 헤더
  ctx.ensureSpace(HEADER_H + ROW_H * 2);
  ctx.rect(ML, ctx.y - HEADER_H, totalW, HEADER_H, ctx.theme.sectionBand);
  let hx = ML;
  for (const col of cols) {
    ctx.text(col.header, hx + CELL_PAD, ctx.y - headerTopOffset, fontSize, C.white, col.width - CELL_PAD * 2);
    hx += col.width;
  }
  ctx.y -= HEADER_H;

  // 테이블 상단 구분선
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, ctx.theme.border);

  // 데이터 행
  rows.forEach((row, ri) => {
    ctx.ensureSpace(ROW_H + 4);

    const bg = ri % 2 === 0 ? C.white : ctx.theme.softBg;
    ctx.rect(ML, ctx.y - ROW_H, totalW, ROW_H, bg);

    let rx = ML;
    row.forEach((cell, ci) => {
      const col = cols[ci];
      if (!col) return;
      const cellColor = rowColors?.[ri] ?? C.text;
      const truncated = truncate(cell, 20);
      const maxCellW = col.width - CELL_PAD * 2;

      if (col.align === "right") {
        ctx.textRight(truncated, rx + col.width - CELL_PAD, ctx.y - topOffset, fontSize, cellColor);
      } else if (col.align === "center") {
        ctx.textCenter(truncated, rx + col.width / 2, ctx.y - topOffset, fontSize, cellColor);
      } else {
        ctx.text(truncated, rx + CELL_PAD, ctx.y - topOffset, fontSize, cellColor, maxCellW);
      }
      rx += col.width;
    });

    // 행 하단 구분선
    ctx.line(ML, ctx.y - ROW_H, ML + totalW, ctx.y - ROW_H, ctx.theme.border);
    ctx.y -= ROW_H;
  });

  // 테이블 좌/우 외곽선
  const tableTop = ctx.y + ROW_H * rows.length + HEADER_H;
  ctx.line(ML,           tableTop, ML,           ctx.y, ctx.theme.border);
  ctx.line(ML + totalW,  tableTop, ML + totalW,  ctx.y, ctx.theme.border);
  // 하단 마감선
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, ctx.theme.border);

  ctx.y -= 6; // 테이블 하단 여백
}

// ─── 커버 페이지 ─────────────────────────────────────────────────────────
function drawCoverPage(
  ctx: ReportContext,
  ymd: string,
  chatId: number,
  headline?: { kicker: string; detail: string }
) {
  const { W, H, ML, MR } = ctx;

  // 상단 네이비 밴드
  ctx.rect(0, H - 160, W, 160, C.navy);

  // 서비스명
  ctx.textCenter("WEEKLY  MARKET  REPORT", W / 2, H - 48, 11, rgb(0.65, 0.75, 0.92));

  // 리포트 제목
  ctx.textCenter("주  간  증  시  리  포  트", W / 2, H - 88, 18, C.white);

  // 오렌지 강조선
  ctx.rect(ML, H - 163, W - ML - MR, 3, C.accent);

  // 발행 정보
  ctx.text(`기준일: ${ymd}`, ML, H - 188, 10, C.text);
  ctx.text(`계좌 ID: ${String(chatId).slice(-4).padStart(4, "*")}`, ML, H - 204, 10, C.muted);

  if (headline) {
    const boxTop = H - 238;
    const boxH = 44;
    ctx.rect(ML, boxTop - boxH, W - ML - MR - 116, boxH, rgb(0.95, 0.96, 0.98));
    ctx.rect(ML, boxTop - boxH, 4, boxH, C.accent);
    ctx.text(headline.kicker, ML + 12, boxTop - 10, 9, C.navyLight, W - ML - MR - 150);
    ctx.text(headline.detail, ML + 12, boxTop - 26, 8.5, C.muted, W - ML - MR - 150);
  }

  // 바코드 스타일 장식선
  for (let i = 0; i < 28; i++) {
    const bx = W - MR - 90 + i * (i % 3 === 0 ? 5 : 3);
    const bh = 8 + (i % 4) * 4;
    ctx.rect(bx, H - 215, 2, bh, rgb(0.15, 0.25, 0.55));
  }

  // 목차
  const toc = [
    "I.   시장 개요 및 주요 지표",
    "II.  포트폴리오 요약",
    "III. 매매 기록 및 성과 분석",
    "IV.  보유 종목 상세",
    "V.   주간 코멘트 및 대응 전략",
  ];
  const tocBoxH = toc.length * 22 + 28;
  const tocY = H - 290;
  ctx.rect(ML, tocY - tocBoxH, (W - ML - MR) * 0.58, tocBoxH, C.bg);
  ctx.text("목차", ML + 10, tocY - 8, 10, C.navyLight);
  toc.forEach((t, i) => {
    ctx.text(t, ML + 10, tocY - 26 - i * 21, 9, C.text);
  });

  // 하단 면책 문구
  ctx.rect(0, 0, W, 64, C.bg);
  ctx.line(0, 64, W, 64, C.border);
  ctx.textCenter(
    "본 리포트는 가상 포트폴리오 및 시장 데이터 기준 요약 자료이며, 실제 투자 결과를 보증하지 않습니다.",
    W / 2, 48, 7.5, C.muted
  );
  ctx.textCenter(
    "투자 판단의 최종 책임은 투자자 본인에게 있으며, 본 자료는 투자 권유 목적이 아닙니다.",
    W / 2, 32, 7.5, C.muted
  );
}

// ─── 페이지 타이틀 바 ────────────────────────────────────────────────────
const PAGE_TITLE_H = 26;

function drawPageTitle(ctx: ReportContext, title: string) {
  ctx.rect(ctx.ML, ctx.y - PAGE_TITLE_H, ctx.BODY_W, PAGE_TITLE_H, ctx.theme.pageBand);
  ctx.textCenter(title, ctx.W / 2, ctx.y - PAGE_TITLE_H / 2 + 5, 12, C.white);
  ctx.y -= PAGE_TITLE_H + 8;
}

function drawTopicHero(ctx: ReportContext, title: string, subtitle: string) {
  const heroH = 92;
  ctx.ensureSpace(heroH + 10);
  const x = ctx.ML;
  const y = ctx.y;

  ctx.rect(x, y - heroH, ctx.BODY_W, heroH, ctx.theme.softBg);
  ctx.rect(x, y - heroH, 6, heroH, ctx.theme.accent);
  ctx.line(x, y, x + ctx.BODY_W, y, ctx.theme.border);
  ctx.line(x, y - heroH, x + ctx.BODY_W, y - heroH, ctx.theme.border);

  ctx.text(ctx.theme.heroLabel, x + 18, y - 14, 8.5, ctx.theme.accent, ctx.BODY_W - 36);
  ctx.text(title, x + 18, y - 34, 16, ctx.theme.pageBand, ctx.BODY_W - 160);
  ctx.text(subtitle, x + 18, y - 58, 9, ctx.theme.subtitle, ctx.BODY_W - 160);

  const pillW = 112;
  const pillH = 24;
  const pillX = x + ctx.BODY_W - pillW - 18;
  const pillY = y - 18;
  ctx.rect(pillX, pillY - pillH, pillW, pillH, ctx.theme.pageBand);
  ctx.textCenter("PDF REPORT", pillX + pillW / 2, pillY - 5, 8.5, C.white);

  ctx.y -= heroH + 10;
}

function drawClosingHighlight(ctx: ReportContext, title: string, body: string) {
  const fontSize = 9;
  const titleSize = 10;
  const maxW = ctx.BODY_W - 28;
  const lines = wrapText(body, maxW, ctx.font, fontSize);
  const blockH = 14 + titleSize + 8 + lines.length * (fontSize + 4) + 12;

  ctx.ensureSpace(blockH + 8);

  const x = ctx.ML;
  const y = ctx.y;
  ctx.rect(x, y - blockH, ctx.BODY_W, blockH, ctx.theme.softBg);
  ctx.rect(x, y - blockH, ctx.BODY_W, 5, ctx.theme.accent);
  ctx.line(x, y, x + ctx.BODY_W, y, ctx.theme.border);
  ctx.line(x, y - blockH, x + ctx.BODY_W, y - blockH, ctx.theme.border);

  ctx.text(title, x + 14, y - 12, titleSize, ctx.theme.pageBand, maxW);
  lines.forEach((line, index) => {
    ctx.text(line, x + 14, y - 12 - titleSize - 8 - index * (fontSize + 4), fontSize, C.text, maxW);
  });

  ctx.y -= blockH + 8;
}

// ─── 코멘트 블록 ─────────────────────────────────────────────────────────
// [FIX] 코멘트 블록 높이를 내용 길이에 따라 동적으로 계산
function drawCommentBlock(
  ctx: ReportContext,
  title: string,
  body: string,
  color: RGB,
  font: PDFFont
) {
  const fontSize = 9;
  const titleFontSize = 10;
  const maxW = ctx.BODY_W - 24;
  const bodyLines = wrapText(body, maxW, font, fontSize);
  // 블록 높이: 상단 패딩 + 타이틀 + 간격 + 바디 라인들 + 하단 패딩
  const blockH = 12 + titleFontSize + 6 + bodyLines.length * (fontSize + 4) + 10;

  ctx.ensureSpace(blockH + 6);

  const bx = ctx.ML;
  const by = ctx.y;

  ctx.rect(bx,     by - blockH, ctx.BODY_W, blockH, ctx.theme.softBg);
  ctx.rect(bx,     by - blockH, 4,          blockH, color);
  ctx.line(bx,     by - blockH, bx + ctx.BODY_W, by - blockH, ctx.theme.border);
  ctx.line(bx,     by,          bx + ctx.BODY_W, by,          ctx.theme.border);

  // 타이틀
  ctx.text(title, bx + 12, by - 10, titleFontSize, color, maxW);
  // 바디 라인
  bodyLines.forEach((line, li) => {
    ctx.text(line, bx + 12, by - 10 - titleFontSize - 6 - li * (fontSize + 4), fontSize, C.text, maxW);
  });

  ctx.y -= blockH + 6;
}

function drawMarketOverviewSection(
  ctx: ReportContext,
  ymd: string,
  market: Awaited<ReturnType<typeof fetchReportMarketData>>,
  sectors: SectorRow[]
) {
  drawSectionHeader(ctx, "시장 개요", `기준: ${ymd}`);

  const mktCards: KpiCard[] = [];
  if (market.kospi) {
    mktCards.push({
      label: "KOSPI",
      value: fmtInt(toNum(market.kospi.price)),
      sub: fmtPct(toNum(market.kospi.changeRate)),
      valueColor: pnlColor(toNum(market.kospi.changeRate)),
    });
  }
  if (market.kosdaq) {
    mktCards.push({
      label: "KOSDAQ",
      value: fmtInt(toNum(market.kosdaq.price)),
      sub: fmtPct(toNum(market.kosdaq.changeRate)),
      valueColor: pnlColor(toNum(market.kosdaq.changeRate)),
    });
  }
  if (market.usdkrw) {
    mktCards.push({
      label: "USD/KRW",
      value: `${fmtInt(toNum(market.usdkrw.price))}원`,
      sub: fmtPct(toNum(market.usdkrw.changeRate)),
      valueColor: C.text,
    });
  }
  if (market.vix) {
    const vixVal = toNum(market.vix.price);
    mktCards.push({
      label: "VIX (공포지수)",
      value: vixVal.toFixed(1),
      sub: vixVal >= 30 ? "고공포" : vixVal >= 20 ? "주의" : "안정",
      valueColor: vixVal >= 30 ? C.up : C.text,
    });
  }
  if (market.fearGreed) {
    mktCards.push({
      label: "공포·탐욕",
      value: String(toNum(market.fearGreed.score)),
      sub: market.fearGreed.rating ?? "",
      valueColor: C.text,
    });
  }

  while (mktCards.length % 4 !== 0) mktCards.push({ label: "", value: "" });
  if (mktCards.length > 0) drawKpiGrid(ctx, mktCards, 4);

  if (sectors.length > 0) {
    ctx.y -= 4;
    drawSectionHeader(ctx, "주도 섹터 Top 3", `기준: ${ymd}`);
    drawTable(
      ctx,
      [
        { header: "순위", width: 40, align: "center" },
        { header: "섹터명", width: 200 },
        { header: "점수", width: 70, align: "right" },
        { header: "수익률", width: 80, align: "right" },
        { header: "상태", width: 117, align: "center" },
      ],
      sectors.map((s, idx) => {
        const cr = toNum(s.change_rate);
        return [
          String(idx + 1),
          s.name,
          toNum(s.score).toFixed(1),
          fmtPct(cr),
          cr >= 1 ? "강세" : cr >= 0 ? "보합" : "약세",
        ];
      }),
      sectors.map((s) => pnlColor(toNum(s.change_rate)))
    );
  }
}

function drawPortfolioSection(
  ctx: ReportContext,
  totalInvested: number,
  totalValue: number,
  totalUnrealized: number,
  totalUnrealizedPct: number,
  watchItems: WatchItem[],
  curr: WindowSummary,
  prev: WindowSummary
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "포트폴리오 요약");
  const pfCards: KpiCard[] = [
    { label: "총 원금", value: `${fmtInt(totalInvested)}원`, valueColor: C.text },
    { label: "평가금액", value: `${fmtInt(totalValue)}원`, valueColor: C.text },
    { label: "평가손익", value: fmtSignedInt(totalUnrealized), sub: fmtPct(totalUnrealizedPct), valueColor: pnlColor(totalUnrealized) },
    { label: "보유 종목수", value: `${watchItems.length}개`, valueColor: C.text },
    { label: "거래 (최근 2주)", value: `${curr.tradeCount}건`, sub: `매수 ${curr.buyCount} / 매도 ${curr.sellCount}`, valueColor: C.text },
    { label: "실현손익 (2주)", value: fmtSignedInt(curr.realizedPnl), valueColor: pnlColor(curr.realizedPnl) },
    { label: "승률 (2주)", value: `${curr.winRate.toFixed(1)}%`, sub: curr.sellCount > 0 ? `${curr.sellCount}건 매도 기준` : "매도 없음", valueColor: curr.winRate >= 50 ? C.up : C.down },
    { label: "이전 2주 대비", value: fmtSignedInt(curr.realizedPnl - prev.realizedPnl), sub: "실현손익 증감", valueColor: pnlColor(curr.realizedPnl - prev.realizedPnl) },
  ];
  drawKpiGrid(ctx, pfCards, 4);
}

function drawTradesSection(ctx: ReportContext, windows: ReturnType<typeof splitWindows>) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "매매 기록 및 성과 분석");

  if (windows.recent.length > 0) {
    drawTable(
      ctx,
      [
        { header: "일자", width: 58, align: "center" },
        { header: "구분", width: 42, align: "center" },
        { header: "종목코드", width: 64, align: "center" },
        { header: "수량", width: 50, align: "right" },
        { header: "단가 (원)", width: 88, align: "right" },
        { header: "금액 (원)", width: 88, align: "right" },
        { header: "실현손익", width: 117, align: "right" },
      ],
      windows.recent.map((r) => {
        const qty = Math.max(0, Math.floor(toNum(r.quantity)));
        const price = toNum(r.price);
        const pnl = r.side === "SELL" ? fmtSignedInt(toNum(r.pnl_amount)) : "-";
        return [
          lineDate(r.traded_at),
          r.side === "BUY" ? "매수" : "매도",
          r.code,
          `${qty}주`,
          fmtInt(price),
          fmtInt(price * qty),
          pnl,
        ];
      }),
      windows.recent.map((r) => (r.side === "SELL" ? pnlColor(toNum(r.pnl_amount)) : C.down))
    );
  } else {
    ctx.y -= 4;
    ctx.text("최근 2주 거래 기록이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
  }
}

function drawWatchlistSection(
  ctx: ReportContext,
  watchItems: WatchItem[],
  totalInvested: number,
  totalUnrealized: number,
  totalUnrealizedPct: number
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "보유 종목 상세", `총 ${watchItems.length}개 종목`);

  if (watchItems.length > 0) {
    drawTable(
      ctx,
      [
        { header: "종목명", width: 112, align: "left" },
        { header: "코드", width: 54, align: "center" },
        { header: "수량", width: 46, align: "right" },
        { header: "평균단가", width: 78, align: "right" },
        { header: "현재가", width: 78, align: "right" },
        { header: "평가손익", width: 80, align: "right" },
        { header: "수익률", width: 59, align: "right" },
      ],
      watchItems.slice(0, 20).map((item) => [
        truncate(item.name, 10),
        item.code,
        `${item.qty}주`,
        item.buyPrice ? fmtInt(item.buyPrice) : "-",
        item.currentPrice ? fmtInt(item.currentPrice) : "-",
        item.invested > 0 ? fmtSignedInt(item.unrealized) : "-",
        item.pnlPct != null ? fmtPct(item.pnlPct) : "-",
      ]),
      watchItems.slice(0, 20).map((item) => pnlColor(item.unrealized))
    );

    drawPortfolioSummaryRow(
      ctx,
      "합계",
      `원금 ${fmtInt(totalInvested)}원`,
      `평가손익 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
      pnlColor(totalUnrealized)
    );
  } else {
    ctx.y -= 8;
    ctx.text("등록된 관심종목이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
  }
}

function drawCommentarySection(
  ctx: ReportContext,
  font: PDFFont,
  curr: WindowSummary,
  prev: WindowSummary,
  totalUnrealized: number,
  totalUnrealizedPct: number,
  watchItems: WatchItem[],
  sectors: SectorRow[]
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "주간 코멘트 및 대응 전략");

  const tradeMom =
    curr.tradeCount > prev.tradeCount
      ? `이번 주 거래 횟수(${curr.tradeCount}건)가 이전 주(${prev.tradeCount}건) 대비 증가했습니다. 포지션 진입이 늘어난 구간으로, 개별 리스크 관리가 중요합니다.`
      : curr.tradeCount < prev.tradeCount
      ? `이번 주 거래 횟수(${curr.tradeCount}건)가 이전 주(${prev.tradeCount}건)보다 감소했습니다. 신중한 관망 기조를 유지 중입니다.`
      : "이번 주 거래 횟수는 이전 주와 동일합니다.";

  drawCommentBlock(ctx, "매매 활동", tradeMom, C.navyLight, font);

  const winNote =
    curr.winRate >= prev.winRate
      ? `승률이 ${prev.winRate.toFixed(1)}%→${curr.winRate.toFixed(1)}%로 개선되었습니다. 매도 타이밍이 양호했습니다.`
      : `승률이 ${prev.winRate.toFixed(1)}%→${curr.winRate.toFixed(1)}%로 하락했습니다. 손절 기준 재점검을 권고합니다.`;
  drawCommentBlock(ctx, "승률 분석", winNote, curr.winRate >= prev.winRate ? C.up : C.down, font);

  const pfNote =
    totalUnrealized >= 0
      ? `현재 포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)}(${fmtPct(totalUnrealizedPct)})로 양호합니다.`
      : `현재 포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)}(${fmtPct(totalUnrealizedPct)})로 미실현 손실 구간입니다. 개별 종목 비중 점검이 필요합니다.`;
  drawCommentBlock(ctx, "포트폴리오 평가", pfNote, pnlColor(totalUnrealized), font);

  const topLoss = watchItems.filter((i) => (i.pnlPct ?? 0) < -5);
  if (topLoss.length > 0) {
    const names = topLoss.slice(0, 3).map((i) => `${i.name}(${fmtPct(i.pnlPct ?? 0)})`).join(", ");
    drawCommentBlock(
      ctx,
      "손절 재점검 대상",
      `평가손실 -5% 초과 종목: ${names}. 손절 기준일 재확인 후 비중 축소를 고려하세요.`,
      C.up,
      font
    );
  }

  const sectorNames = sectors.slice(0, 2).map((s) => s.name).join(", ");
  if (sectorNames) {
    drawCommentBlock(
      ctx,
      "주도 섹터 대응",
      `이번 주 주도 섹터는 ${sectorNames}입니다. 해당 섹터 편입 종목의 비중 확대를 모니터링하세요.`,
      C.navyLight,
      font
    );
  }

  drawCommentBlock(
    ctx,
    "유의 사항",
    "본 리포트는 가상 포트폴리오 기준입니다. 실제 거래에 적용 시 세금·수수료·시장 유동성을 반드시 고려하십시오.",
    C.muted,
    font
  );
}

function drawFlowSection(ctx: ReportContext, sectors: SectorRow[]) {
  const rows = sectors
    .map((sector) => {
      const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
      const foreignFlow = toNum(metrics.flow_foreign_5d);
      const instFlow = toNum(metrics.flow_inst_5d);
      return {
        name: sector.name,
        score: toNum(sector.score),
        foreignFlow,
        instFlow,
        totalFlow: foreignFlow + instFlow,
      };
    })
    .filter((row) => row.totalFlow !== 0)
    .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow))
    .slice(0, 12);

  drawSectionHeader(ctx, "수급 상위 섹터", `최근 5거래일`);

  if (rows.length === 0) {
    ctx.text("수급 집계 데이터가 없습니다.", ctx.ML + 8, ctx.y - 2, 9, C.muted);
    ctx.y -= 22;
    return;
  }

  drawTable(
    ctx,
    [
      { header: "섹터명", width: 177 },
      { header: "점수", width: 60, align: "right" },
      { header: "외국인", width: 90, align: "right" },
      { header: "기관", width: 90, align: "right" },
      { header: "합계", width: 90, align: "right" },
    ],
    rows.map((row) => [
      row.name,
      row.score.toFixed(1),
      fmtKorMoney(row.foreignFlow),
      fmtKorMoney(row.instFlow),
      fmtKorMoney(row.totalFlow),
    ]),
    rows.map((row) => pnlColor(row.totalFlow))
  );
}

function drawSectorSection(ctx: ReportContext, sectors: SectorRow[], ymd: string) {
  drawSectionHeader(ctx, "섹터 강도 랭킹", `기준: ${ymd}`);

  if (sectors.length === 0) {
    ctx.text("섹터 데이터가 없습니다.", ctx.ML + 8, ctx.y - 2, 9, C.muted);
    ctx.y -= 22;
    return;
  }

  drawTable(
    ctx,
    [
      { header: "순위", width: 40, align: "center" },
      { header: "섹터명", width: 227 },
      { header: "점수", width: 70, align: "right" },
      { header: "수익률", width: 80, align: "right" },
      { header: "상태", width: 90, align: "center" },
    ],
    sectors.slice(0, 12).map((sector, idx) => {
      const rate = toNum(sector.change_rate);
      return [
        String(idx + 1),
        sector.name,
        toNum(sector.score).toFixed(1),
        fmtPct(rate),
        rate >= 1 ? "강세" : rate >= 0 ? "보합" : "약세",
      ];
    }),
    sectors.slice(0, 12).map((sector) => pnlColor(toNum(sector.change_rate)))
  );
}

function drawEconomySection(
  ctx: ReportContext,
  font: PDFFont,
  market: Awaited<ReturnType<typeof fetchAllMarketData>>,
  ymd: string
) {
  drawSectionHeader(ctx, "거시 환경 요약", `기준: ${ymd}`);

  const cards: KpiCard[] = [];
  if (market.kospi) cards.push({ label: "KOSPI", value: fmtInt(toNum(market.kospi.price)), sub: fmtPct(toNum(market.kospi.changeRate)), valueColor: pnlColor(toNum(market.kospi.changeRate)) });
  if (market.kosdaq) cards.push({ label: "KOSDAQ", value: fmtInt(toNum(market.kosdaq.price)), sub: fmtPct(toNum(market.kosdaq.changeRate)), valueColor: pnlColor(toNum(market.kosdaq.changeRate)) });
  if (market.sp500) cards.push({ label: "S&P 500", value: fmtInt(toNum(market.sp500.price)), sub: fmtPct(toNum(market.sp500.changeRate)), valueColor: pnlColor(toNum(market.sp500.changeRate)) });
  if (market.nasdaq) cards.push({ label: "NASDAQ", value: fmtInt(toNum(market.nasdaq.price)), sub: fmtPct(toNum(market.nasdaq.changeRate)), valueColor: pnlColor(toNum(market.nasdaq.changeRate)) });
  if (market.usdkrw) cards.push({ label: "USD/KRW", value: `${fmtInt(toNum(market.usdkrw.price))}원`, sub: fmtPct(toNum(market.usdkrw.changeRate)), valueColor: C.text });
  if (market.us10y) cards.push({ label: "미국 10년물", value: `${toNum(market.us10y.price).toFixed(2)}%`, sub: fmtPct(toNum(market.us10y.changeRate)), valueColor: pnlColor(toNum(market.us10y.changeRate)) });
  if (market.vix) cards.push({ label: "VIX", value: toNum(market.vix.price).toFixed(2), sub: toNum(market.vix.price) >= 30 ? "고위험" : toNum(market.vix.price) >= 20 ? "주의" : "안정", valueColor: toNum(market.vix.price) >= 30 ? C.up : C.text });
  if (market.fearGreed) cards.push({ label: "공포·탐욕", value: String(toNum(market.fearGreed.score)), sub: market.fearGreed.rating ?? "", valueColor: C.text });
  while (cards.length % 4 !== 0) cards.push({ label: "", value: "" });
  if (cards.length > 0) drawKpiGrid(ctx, cards, 4);

  const comments: string[] = [];
  if (market.vix && toNum(market.vix.price) >= 30) comments.push("VIX 30 이상으로 변동성 확대 구간입니다. 보수적 비중 조절이 유효합니다.");
  if (market.fearGreed && toNum(market.fearGreed.score) <= 25) comments.push("공포 심리가 극단 구간입니다. 급락 시 분할 접근 여부를 점검할 시점입니다.");
  if (market.us10y && toNum(market.us10y.price) >= 5) comments.push("미국 10년물 금리가 높아 성장주 할인율 부담이 지속될 수 있습니다.");
  if (market.usdkrw && toNum(market.usdkrw.price) >= 1400) comments.push("원화 약세가 이어지면 외국인 수급 변동성이 커질 수 있습니다.");
  if (market.wtiOil && toNum(market.wtiOil.price) >= 100) comments.push("유가 부담이 높아져 비용 민감 업종에 불리할 수 있습니다.");

  drawCommentBlock(
    ctx,
    "거시 해석",
    comments.join(" ") || "현재 핵심 거시 지표는 중립 범위입니다. 추세 변화 여부만 점검하면 됩니다.",
    C.navyLight,
    font
  );
}

// ─── 메인 export ──────────────────────────────────────────────────────────
export async function createWeeklyReportPdf(
  supabase: SupabaseClient,
  options: { chatId: number; topic?: string | null }
): Promise<WeeklyPdfReport> {
  const chatId = options.chatId;
  const topicMeta = parseReportTopic(options.topic);
  const theme = getReportTheme(topicMeta.topic);
  const now = new Date();
  const kstNow = asKstDate(now);
  const ymd = toYmd(kstNow);
  const krDate = toKrDate(now);

  // ── 데이터 조회 ─────────────────────────────────────────────────────────
  const tradeSince = shiftDays(now, -28).toISOString();

  const [tradeRes, watchRes, sectorRes] = await Promise.all([
    runReportStep("trade_query", () =>
      supabase
        .from("virtual_trades")
        .select("side, code, price, quantity, pnl_amount, traded_at")
        .eq("chat_id", chatId)
        .gte("traded_at", tradeSince)
        .order("traded_at", { ascending: false })
        .limit(300)
        .returns<TradeRow[]>()
    ),
    runReportStep("watchlist_query", () =>
      supabase
        .from("watchlist")
        .select("code, buy_price, quantity, invested_amount, status, stock:stocks(code,name,close)")
        .eq("chat_id", chatId)
        .returns<WatchlistRow[]>()
    ),
    runReportStep("sector_query", () =>
      supabase
        .from("sectors")
        .select("name, score, change_rate, metrics")
        .order("score", { ascending: false })
        .limit(12)
        .returns<SectorRow[]>()
    ),
  ]);

  if (tradeRes.error) {
    throw new WeeklyReportError("trade_query", `virtual_trades 조회 실패: ${tradeRes.error.message}`, tradeRes.error);
  }
  if (watchRes.error) {
    throw new WeeklyReportError("watchlist_query", `watchlist 조회 실패: ${watchRes.error.message}`, watchRes.error);
  }
  if (sectorRes.error) {
    throw new WeeklyReportError("sector_query", `sectors 조회 실패: ${sectorRes.error.message}`, sectorRes.error);
  }

  const market = await runReportStep("market_data", async () => {
    try {
      return topicMeta.topic === "economy" ? await fetchAllMarketData() : await fetchReportMarketData();
    } catch {
      return {} as any;
    }
  });

  const rows = tradeRes.data ?? [];
  const windows = splitWindows(rows, now);
  const curr = summarizeWindow(windows.current14);
  const prev = summarizeWindow(windows.prev14);

  const codes = (watchRes.data ?? []).map((r) => r.code);
  const realtimeMap = codes.length
    ? await runReportStep("realtime_price", async () => {
        try {
          return await fetchRealtimePriceBatch(codes);
        } catch {
          return {} as Record<string, any>;
        }
      })
    : {};

  const watchItems: WatchItem[] = (watchRes.data ?? []).map((row) => {
    const stock = unwrapStock(row.stock);
    const buyPrice = row.buy_price != null ? toNum(row.buy_price) : null;
    const qtyRaw = row.quantity != null ? Math.floor(toNum(row.quantity)) : 0;
    const invested = toNum(row.invested_amount);
    const qty = qtyRaw > 0 ? qtyRaw : buyPrice && invested > 0 ? Math.floor(invested / buyPrice) : 0;
    const rtPrice = toNum(realtimeMap[row.code]?.price);
    const dbPrice = stock?.close != null ? toNum(stock.close) : 0;
    const currentPrice = rtPrice > 0 ? rtPrice : dbPrice > 0 ? dbPrice : null;
    const cost = invested > 0 ? invested : buyPrice && qty > 0 ? buyPrice * qty : 0;
    const value = currentPrice && qty > 0 ? currentPrice * qty : 0;
    const unrealized = cost > 0 ? value - cost : 0;
    const pnlPct = buyPrice && currentPrice ? ((currentPrice - buyPrice) / buyPrice) * 100 : null;
    return {
      code: row.code,
      name: stock?.name ?? row.code,
      qty,
      buyPrice,
      currentPrice,
      invested: cost,
      value,
      unrealized,
      pnlPct,
    };
  }).sort((a, b) => Math.abs(b.unrealized) - Math.abs(a.unrealized));

  const totalInvested = watchItems.reduce((s, i) => s + i.invested, 0);
  const totalValue = watchItems.reduce((s, i) => s + i.value, 0);
  const totalUnrealized = totalValue - totalInvested;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;

  // ── PDF 문서 초기화 ──────────────────────────────────────────────────────
  const pdf = await runReportStep("pdf_render", () => PDFDocument.create());
  pdf.registerFontkit(fontkit);
  const fontBytes = await runReportStep("font_load", () => loadKoreanFontBytes());
  const font = await runReportStep("pdf_render", () => pdf.embedFont(fontBytes));
  const ctx = new ReportContext(pdf, font, theme);
  ctx.footerLabel = ymd;

  const sectors = sectorRes.data ?? [];
  const coverHeadline = buildCoverHeadline({
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market: market as Awaited<ReturnType<typeof fetchReportMarketData>>,
  });
  const heroSummary = buildTopicHeroSummary({
    topic: topicMeta.topic,
    defaultSummary: theme.heroSummary,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    watchItems,
    sectors,
    market,
  });
  const closingSummary = buildTopicClosingSummary({
    topic: topicMeta.topic,
    curr,
    prev,
    totalUnrealized,
    totalUnrealizedPct,
    watchItems,
    sectors,
    market,
  });

  if (topicMeta.includeCover) {
    ctx.addPage(null);
    drawCoverPage(ctx, krDate, chatId, coverHeadline);
  }

  ctx.addPage(topicMeta.title);
  drawTopicHero(ctx, topicMeta.title, heroSummary);

  if (topicMeta.topic === "economy") {
    drawEconomySection(ctx, font, market as Awaited<ReturnType<typeof fetchAllMarketData>>, ymd);
  } else if (topicMeta.topic === "flow") {
    drawFlowSection(ctx, sectors);
  } else if (topicMeta.topic === "sector") {
    drawSectorSection(ctx, sectors, ymd);
  } else if (topicMeta.topic === "watchlist") {
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, watchItems, curr, prev);
    drawWatchlistSection(ctx, watchItems, totalInvested, totalUnrealized, totalUnrealizedPct);
    drawTradesSection(ctx, windows);
  } else {
    drawMarketOverviewSection(ctx, ymd, market as Awaited<ReturnType<typeof fetchReportMarketData>>, sectors.slice(0, 3));
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, watchItems, curr, prev);
    drawTradesSection(ctx, windows);
    drawWatchlistSection(ctx, watchItems, totalInvested, totalUnrealized, totalUnrealizedPct);
    drawCommentarySection(ctx, font, curr, prev, totalUnrealized, totalUnrealizedPct, watchItems, sectors);
  }

  drawClosingHighlight(ctx, "최종 결론", closingSummary);

  ctx.finalizePage();

  // ── 반환 ────────────────────────────────────────────────────────────────
  const bytes = await runReportStep("pdf_save", () => pdf.save());

  const caption = buildReportCaption({
    title: topicMeta.captionTitle,
    topic: topicMeta.topic,
    krDate,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
  });

  const summaryText = buildReportSummaryText({
    title: topicMeta.title,
    topic: topicMeta.topic,
    ymd,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
  });

  return {
    bytes,
    fileName: `${topicMeta.fileSlug}_${chatId}_${ymd}.pdf`,
    caption,
    summaryText,
    title: topicMeta.title,
    topic: topicMeta.topic,
  };
}