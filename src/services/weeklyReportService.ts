import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, PDFPage, PDFFont, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";

// ─── 색상 팔레트 (모던 B&W + 주제별 포인트) ─────────────────────────────
const C = {
  // ── 뉴트럴 ──
  black:   rgb(0.06, 0.06, 0.07),   // 배너/섹션 배경
  ink:     rgb(0.12, 0.12, 0.14),   // 본문 텍스트
  dim:     rgb(0.40, 0.40, 0.44),   // 보조 텍스트
  subtle:  rgb(0.60, 0.60, 0.64),   // 캡션·플레이스홀더
  rule:    rgb(0.83, 0.83, 0.86),   // 구분선 (가는 선)
  surface: rgb(0.96, 0.96, 0.97),   // 카드 배경
  alt:     rgb(0.91, 0.91, 0.93),   // 테이블 교대 행
  white:   rgb(1.00, 1.00, 1.00),
  // ── 시맨틱 ──
  up:      rgb(0.82, 0.10, 0.10),   // 상승 (적색)
  down:    rgb(0.08, 0.40, 0.72),   // 하락 (청색)
  // ── 레거시 alias (호환) ──
  navy:      rgb(0.06, 0.06, 0.07),
  navyLight: rgb(0.22, 0.22, 0.26),
  accent:    rgb(0.06, 0.06, 0.07),
  neutral:   rgb(0.40, 0.40, 0.44),
  text:      rgb(0.12, 0.12, 0.14),
  muted:     rgb(0.60, 0.60, 0.64),
  bg:        rgb(0.96, 0.96, 0.97),
  border:    rgb(0.83, 0.83, 0.86),
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

type RenderReportInput = {
  topicMeta: ReportTopicMeta;
  chatId: number;
  ymd: string;
  krDate: string;
  curr: WindowSummary;
  prev: WindowSummary;
  windows: ReturnType<typeof splitWindows>;
  watchItems: WatchItem[];
  totalInvested: number;
  totalValue: number;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: SectorRow[];
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
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
  return C.dim;
}

// 수직 중앙 정렬 유틸: 박스 상단 y에서 fontSize가 정중앙이 되는 topY 반환
function vCenterTopY(boxTopY: number, boxH: number, fontSize: number): number {
  return boxTopY - boxH / 2 + fontSize * 0.50;
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

  if (!token || ["기본", "전체", "종합", "주간", "시장", "full", "all", "weekly", "week"].includes(token)) {
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

  if (["관심", "관심종목", "포트폴리오", "watch", "watchlist", "portfolio"].includes(token)) {
    return {
      topic: "watchlist",
      title: "관심종목 리포트",
      fileSlug: "watchlist_report",
      includeCover: false,
      progressText: "관심종목 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "관심종목 리포트",
    };
  }

  return {
    topic: "full",
    title: "주간 증시 리포트",
    fileSlug: "weekly_market_report",
    includeCover: true,
    progressText: "주간 증시 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
    captionTitle: "주간 증시 리포트",
  };
}

function createReportTheme(input: {
  pageBand: RGB;
  accent: RGB;
  heroLabel: string;
  heroSummary: string;
}): ReportTheme {
  return {
    pageBand: input.pageBand,
    sectionBand: C.black,
    accent: input.accent,
    softBg: C.surface,
    border: C.rule,
    subtitle: C.dim,
    heroLabel: input.heroLabel,
    heroSummary: input.heroSummary,
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
    const vix    = toNum((market as any).vix?.price);
    const us10y  = toNum((market as any).us10y?.price);
    const fg     = toNum((market as any).fearGreed?.score ?? 50);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const gold   = toNum((market as any).gold?.price);
    if (vix >= 30) {
      return `VIX ${vix.toFixed(1)} · 미국 10년물 ${us10y.toFixed(2)}% 구간으로 시장 변동성이 위험 수준에 도달했습니다. 신규 매수는 분할 진입 원칙을 철저히 지키고, 포트폴리오 내 현금 비중을 20% 이상으로 유지하며 손절 라인을 사전에 설정하는 대응이 필요합니다.`;
    }
    if (vix >= 20 || us10y >= 5) {
      return `변동성(VIX ${vix.toFixed(1)})과 금리(미국 10년물 ${us10y.toFixed(2)}%) 가운데 하나 이상이 경계 수준입니다. 공격적 비중 확대보다는 주도 섹터 중심 선별 매수를 유지하고, 금리 방향 전환 신호가 나올 때까지 포지션 규모를 제한하는 것이 안전합니다.`;
    }
    if (fg >= 75) {
      return `공포·탐욕 지수 ${fg}로 시장 과열 신호가 나오고 있습니다. 추격 매수보다 수익 실현과 비중 조정 타이밍을 점검하세요. 조정 발생 시 재진입 계획을 미리 세워두는 것이 효과적입니다.`;
    }
    if (usdkrw >= 1400 && gold >= 2500) {
      return `원화 약세(${fmtInt(usdkrw)}원)와 금 강세($${fmtInt(Math.round(gold))})가 동시에 나타나 안전자산 선호도가 높아진 구간입니다. 국내 증시 외국인 수급 변동성을 주시하며 방어적 비중을 유지하세요.`;
    }
    return `현재 거시 지표는 전반적으로 안정 범위에 위치합니다. VIX ${vix.toFixed(1)}, 미국 10년물 ${us10y.toFixed(2)}%, 공포·탐욕 ${fg} 모두 과열·위기 임계치를 벗어나 있습니다. 시장 방향 확인 후 주도 업종·섹터 중심으로 비중을 점진적으로 늘리는 전략이 유효하며, 단기 모멘텀과 거래량 추이를 함께 모니터링하세요.`;
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
    return createReportTheme({
      pageBand: rgb(0.06, 0.06, 0.08),
      accent: rgb(0.26, 0.28, 0.88),           // indigo
      heroLabel: "MACRO SNAPSHOT",
      heroSummary: "금리, 환율, 변동성, 글로벌 위험선호를 한 페이지 감도로 정리합니다.",
    });
  }

  if (topic === "flow") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.04, 0.62, 0.44),            // emerald
      heroLabel: "FLOW MONITOR",
      heroSummary: "외국인·기관 자금 방향을 중심으로 강한 섹터와 약한 섹터를 분리합니다.",
    });
  }

  if (topic === "sector") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.92, 0.56, 0.04),            // amber
      heroLabel: "SECTOR ROTATION",
      heroSummary: "점수와 수익률을 동시에 보며 현재 시장의 중심 테마를 압축합니다.",
    });
  }

  if (topic === "watchlist") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.04, 0.50, 0.72),            // sky blue
      heroLabel: "PORTFOLIO CHECK",
      heroSummary: "보유 종목의 손익, 거래 흐름, 대응 포인트를 빠르게 확인할 수 있게 정리합니다.",
    });
  }

  return createReportTheme({
    pageBand: C.black,
    accent: C.black,
    heroLabel: "WEEKLY OUTLOOK",
    heroSummary: "시장 환경, 포트폴리오 상태, 최근 거래와 주간 대응 전략을 한 번에 묶습니다.",
  });
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
async function loadFontBytes(): Promise<{ light: Uint8Array; regular: Uint8Array; bold: Uint8Array }> {
  const base = path.join(process.cwd(), "assets", "fonts");
  const lightPath   = path.join(base, "Pretendard-Light.ttf");
  const regularPath = path.join(base, "Pretendard-Regular.ttf");
  const boldPath    = path.join(base, "Pretendard-Bold.ttf");
  const fallback    = path.join(base, "NotoSansCJKkr-Regular.otf");
  async function tryLoad(...paths: string[]): Promise<Uint8Array> {
    for (const p of paths) {
      try { return await readFile(p); } catch { /* next */ }
    }
    throw new Error(`[PDF] 폰트 파일을 찾을 수 없습니다. 확인 경로: ${paths.join(", ")}`);
  }
  const regular = await tryLoad(regularPath, fallback);
  const bold    = await tryLoad(boldPath, regularPath, fallback);
  const light   = await tryLoad(lightPath, regularPath, fallback);
  return { light, regular, bold };
}

/** @deprecated use loadFontBytes */
async function loadKoreanFontBytes(): Promise<Uint8Array> {
  return (await loadFontBytes()).regular;
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
  fontLight: PDFFont; // Pretendard Light
  font: PDFFont;      // Pretendard Regular
  fontBold: PDFFont;  // Pretendard Bold
  theme: ReportTheme;
  readonly W = 595;
  readonly H = 842;
  readonly ML = 40;
  readonly MR = 40;
  readonly MT = 32;
  readonly MB = 48;
  readonly BODY_W: number;
  y = 0;
  pageNum = 0;
  footerLabel: string | null = null;
  pageTitle: string | null = null;
  private pageFinalized = false;

  constructor(pdf: PDFDocument, fontLight: PDFFont, font: PDFFont, fontBold: PDFFont, theme: ReportTheme) {
    this.pdf       = pdf;
    this.fontLight = fontLight;
    this.font      = font;
    this.fontBold  = fontBold;
    this.theme     = theme;
    this.BODY_W    = this.W - this.ML - this.MR;
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

  ensureSpace(h: number, buffer = 8) {
    if (this.y < this.MB + h + buffer) this.addPage();
  }

  finalizePage() {
    if (!this.page || this.pageFinalized || !this.footerLabel) return;
    drawFooter(this, this.footerLabel);
    this.pageFinalized = true;
  }

  // lineH 비례 계산 (고정 +4 대신 size * 1.45)
  private lh(size: number): number { return Math.round(size * 1.45); }

  // y 는 요소 상단 기준. pdf-lib drawText y 는 baseline 기준이므로 size*0.80 보정
  text(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.font, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.80 - i * lh, size, font: this.font, color });
    }
    return lines.length;
  }

  textBold(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.fontBold, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.80 - i * lh, size, font: this.fontBold, color });
    }
    return lines.length;
  }

  textLight(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.fontLight, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.80 - i * lh, size, font: this.fontLight, color });
    }
    return lines.length;
  }

  textRight(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const w = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - w, y: y - size * 0.80, size, font: this.font, color });
  }

  textRightBold(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const w = this.fontBold.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - w, y: y - size * 0.80, size, font: this.fontBold, color });
  }

  textRightLight(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const w = this.fontLight.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - w, y: y - size * 0.80, size, font: this.fontLight, color });
  }

  textCenter(s: string, cx: number, y: number, size: number, color: RGB = C.ink) {
    const w = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: cx - w / 2, y: y - size * 0.80, size, font: this.font, color });
  }

  textCenterBold(s: string, cx: number, y: number, size: number, color: RGB = C.ink) {
    const w = this.fontBold.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: cx - w / 2, y: y - size * 0.80, size, font: this.fontBold, color });
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  // thickness: hairline=0.25  thin=0.5  medium=1  thick=1.5
  line(x1: number, y1: number, x2: number, y2: number, color: RGB = C.rule, thickness = 0.5) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }
}

// ─── 페이지 풋터 ─────────────────────────────────────────────────────────
function drawFooter(ctx: ReportContext, today: string) {
  const { ML, MR, W, MB } = ctx;
  const lineY = MB - 1;
  const textY = MB - 13;
  ctx.line(ML, lineY, W - MR, lineY, C.rule, 0.75);
  ctx.text(
    "가상 포트폴리오 기준 · 실제 투자 결과와 다를 수 있습니다.",
    ML, textY, 6.5, C.subtle, W - ML - MR - 100
  );
  ctx.textRight(`${today}  /  ${ctx.pageNum}`, W - MR, textY, 6.5, C.subtle);
}

// ─── 섹션 헤더 ──────────────────────────────────────────────────────
const SECTION_H = 22;

function drawSectionHeader(ctx: ReportContext, label: string, sub?: string) {
  ctx.ensureSpace(SECTION_H + 18);
  const { ML, MR, W } = ctx;
  // 0.75pt gray 상단 룰 (섹션 구분선)
  ctx.line(ML, ctx.y, W - MR, ctx.y, C.rule, 0.75);
  const textY = ctx.y - 9;
  ctx.textBold(label, ML, textY, 10.5, C.ink);
  if (sub) ctx.textRightLight(sub, W - MR - 24, textY, 6.5, C.dim);
  ctx.y -= SECTION_H + 3;
}

// ─── KPI 그리드 ─────────────────────────────────────────────────────────
type KpiCard = { label: string; value: string; sub?: string; valueColor?: RGB };

function drawKpiGrid(ctx: ReportContext, cards: KpiCard[], cols = 4) {
  const { ML, W } = ctx;
  const totalW = W - ML - ctx.MR;
  const cardW  = totalW / cols;
  const cardH  = 56;  // label(6.5)+gap+value(14)+gap+sub(6.5) 상하 10pt 일치
  const padX   = 10;
  const maxW   = cardW - padX * 2;
  const rows   = Math.ceil(cards.length / cols);

  ctx.ensureSpace(cardH * rows + 8);

  const startX = ML;
  const startY = ctx.y;

  // 행 구분선 (0.75pt 상/하단, 0.25pt 중간)
  for (let r = 0; r <= rows; r++) {
    const ry = startY - r * cardH;
    const thickness = r === 0 ? 0.75 : r === rows ? 1.5 : 0.25;
    ctx.line(ML, ry, ML + totalW, ry, C.rule, thickness);
  }
  // 열 담백 — 새로 비교 (0.25pt)
  for (let c = 1; c < cols; c++) {
    ctx.line(ML + c * cardW, startY, ML + c * cardW, startY - rows * cardH, C.rule, 0.25);
  }

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x   = startX + col * cardW;
    const y   = startY - row * cardH;

    if (!card.label && !card.value) return;

    ctx.textLight(card.label,     x + padX, y - 10, 6.5, C.dim,                    maxW);
    ctx.textBold(card.value,      x + padX, y - 21, 14,  card.valueColor ?? C.ink, maxW);
    if (card.sub) ctx.textLight(card.sub, x + padX, y - 40, 6.5, C.subtle,         maxW);
  });

  ctx.y -= rows * cardH + 6;
}

function drawPortfolioSummaryRow(
  ctx: ReportContext,
  label: string,
  leftText: string,
  rightText: string,
  rightColor: RGB
) {
  const padX     = 10;
  const fontSize = 8.5;
  const baseH    = 20;
  const leftX    = ctx.ML + padX + 36;
  const rightEdge = ctx.ML + ctx.BODY_W - padX;
  const leftW    = ctx.font.widthOfTextAtSize(leftText, fontSize);
  const rightW   = ctx.font.widthOfTextAtSize(rightText, fontSize);
  const needsWrap = leftX + leftW + 16 > rightEdge - rightW;
  const rowH     = needsWrap ? 32 : baseH;

  ctx.ensureSpace(rowH + 4);
  ctx.line(ctx.ML, ctx.y,        ctx.ML + ctx.BODY_W, ctx.y,        C.rule, 0.5);
  ctx.line(ctx.ML, ctx.y - rowH, ctx.ML + ctx.BODY_W, ctx.y - rowH, C.rule, 0.25);

  const lY = vCenterTopY(ctx.y, rowH, fontSize);
  ctx.textBold(label, ctx.ML + padX, needsWrap ? ctx.y - 10 : lY, fontSize, C.ink);

  if (needsWrap) {
    ctx.text(leftText,  leftX,      ctx.y - 10, fontSize, C.ink);
    ctx.textRight(rightText, rightEdge, ctx.y - 22, fontSize, rightColor);
  } else {
    ctx.text(leftText,  leftX,  lY, fontSize, C.ink);
    ctx.textRight(rightText, rightEdge, lY, fontSize, rightColor);
  }

  ctx.y -= rowH + 4;
}

// ─── 테이블 렌더러 ────────────────────────────────────────────────────────
type ColDef = { header: string; width: number; align?: "left" | "right" | "center" };

const ROW_H    = 18;
const HEADER_H = 20;
const CELL_PAD = 5;

function drawTable(
  ctx: ReportContext,
  cols: ColDef[],
  rows: string[][],
  rowColors?: (RGB | null)[]
) {
  const { ML } = ctx;
  const fontSize = 8;
  const totalW   = cols.reduce((s, c) => s + c.width, 0);
  const hTextY   = vCenterTopY(ctx.y, HEADER_H, fontSize);

  // 헤더 (타이포만, 배경 없음)
  ctx.ensureSpace(HEADER_H + ROW_H * 2);
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.rule, 0.75);
  let hx = ML;
  for (const col of cols) {
    const tH = truncate(col.header, 18);
    if (col.align === "right") {
      ctx.textRightBold(tH, hx + col.width - CELL_PAD, hTextY, fontSize, C.ink);
    } else if (col.align === "center") {
      ctx.textCenterBold(tH, hx + col.width / 2, hTextY, fontSize, C.ink);
    } else {
      ctx.textBold(tH, hx + CELL_PAD, hTextY, fontSize, C.ink);
    }
    hx += col.width;
  }
  ctx.line(ML, ctx.y - HEADER_H, ML + totalW, ctx.y - HEADER_H, C.rule, 0.5);
  ctx.y -= HEADER_H;

  // 데이터 행 (배경 없음, 수평 hairline만)
  rows.forEach((row, ri) => {
    ctx.ensureSpace(ROW_H + 4);
    const rowTextY = vCenterTopY(ctx.y, ROW_H, fontSize);
    let rx = ML;
    row.forEach((cell, ci) => {
      const col = cols[ci];
      if (!col) return;
      const cellColor = rowColors?.[ri] ?? C.ink;
      const t = truncate(cell, 20);
      const maxCellW = col.width - CELL_PAD * 2;
      if (col.align === "right") {
        ctx.textRight(t, rx + col.width - CELL_PAD, rowTextY, fontSize, cellColor);
      } else if (col.align === "center") {
        ctx.textCenter(t, rx + col.width / 2, rowTextY, fontSize, cellColor);
      } else {
        ctx.text(t, rx + CELL_PAD, rowTextY, fontSize, cellColor, maxCellW);
      }
      rx += col.width;
    });

    ctx.line(ML, ctx.y - ROW_H, ML + totalW, ctx.y - ROW_H, C.rule, 0.25);
    ctx.y -= ROW_H;
  });

  // 하단 룰
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.rule, 0.75);

  ctx.y -= 5;
}

// ─── 커버 페이지 ─────────────────────────────────────────────────────────
function drawCoverPage(
  ctx: ReportContext,
  ymd: string,
  chatId: number,
  headline?: { kicker: string; detail: string }
) {
  const { W, H, ML, MR } = ctx;
  const bodyW = W - ML - MR;

  // 상단 블랙 밴드 (전체 너비)
  ctx.rect(0, H - 180, W, 180, C.black);

  // accent 컬러 수평 룰 (밴드 하단)
  ctx.rect(0, H - 181, W, 2.5, ctx.theme.accent);

  // 서비스 레이블: 7pt accent 대문자
  ctx.textCenter("WEEKLY MARKET REPORT", W / 2, H - 44, 8, ctx.theme.accent);

  // 리포트 메인 타이틀
  ctx.textCenterBold("주간 증시 리포트", W / 2, H - 80, 24, C.white);

  // 발행 정보: dim 색
  ctx.textCenter(`${ymd}  ·  ID ${String(chatId).slice(-4).padStart(4, "*")}`, W / 2, H - 118, 8.5, C.subtle);

  // headline 박스
  if (headline) {
    const boxY = H - 148;
    const boxH = 28;
    ctx.rect(ML, boxY - boxH, bodyW * 0.76, boxH, rgb(0.10, 0.10, 0.12));
    ctx.rect(ML, boxY - boxH, 3, boxH, ctx.theme.accent);
    const hY = vCenterTopY(boxY, boxH, 8.5);
    ctx.text(headline.kicker,  ML + 10, hY, 8,   C.subtle, bodyW * 0.72);
  }

  // 목차 섹션 (흰 배경 위)
  const tocY = H - 248;
  const toc = [
    "I.    시장 개요 및 주요 지표",
    "II.   포트폴리오 요약",
    "III.  매매 기록 및 성과 분석",
    "IV.  보유 종목 상세",
    "V.   주간 코멘트",
  ];
  ctx.text("CONTENTS", ML, tocY, 7, C.dim);
  ctx.line(ML, tocY - 10, ML + bodyW * 0.55, tocY - 10, C.rule, 0.5);
  toc.forEach((t, i) => {
    ctx.text(t, ML, tocY - 16 - i * 17, 8.5, C.ink);
  });

  // 오른쪽 장식 — 가는 수직선들 (모던 타이포 장식)
  const barX = ML + bodyW * 0.65;
  for (let i = 0; i < 5; i++) {
    const bh = 20 + i * 10;
    ctx.rect(barX + i * 10, tocY - toc.length * 17 - 6, 1.5, bh, i === 2 ? ctx.theme.accent : C.rule);
  }

  // 하단 면책 (흰 영역)
  const dY = 76;
  ctx.line(ML, dY + 1, W - MR, dY + 1, C.rule, 0.5);
  ctx.text(
    "본 리포트는 가상 포트폴리오 기준이며 실제 투자 결과를 보증하지 않습니다. 투자 판단의 최종 책임은 투자자 본인에게 있습니다.",
    ML, dY - 6, 6.5, C.subtle, bodyW
  );
}

// ─── 페이지 타이틀 바 ────────────────────────────────────────────────────
const PAGE_TITLE_H = 20;

function drawPageTitle(ctx: ReportContext, title: string) {
  ctx.rect(ctx.ML, ctx.y - PAGE_TITLE_H, ctx.BODY_W, PAGE_TITLE_H, ctx.theme.pageBand);
  ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, ctx.theme.accent, 1);
  const tY = vCenterTopY(ctx.y, PAGE_TITLE_H, 9);
  ctx.textCenterBold(title, ctx.W / 2, tY, 9, C.white);
  ctx.y -= PAGE_TITLE_H + 6;
}

function drawTopicHero(ctx: ReportContext, title: string, subtitle: string) {
  const bodyW = ctx.BODY_W;
  const x     = ctx.ML;
  ctx.ensureSpace(80);

  // heroLabel: 6.5pt Light, accent
  ctx.textLight(ctx.theme.heroLabel, x, ctx.y, 6.5, ctx.theme.accent);
  ctx.y -= Math.round(6.5 * 1.45) + 5;

  // title: 20pt Bold
  ctx.textBold(title, x, ctx.y, 20, C.ink, bodyW);
  ctx.y -= Math.round(20 * 1.45) + 4;

  // subtitle: 8.5pt Light dim
  const subLines = ctx.textLight(subtitle, x, ctx.y, 8.5, C.dim, bodyW);
  ctx.y -= subLines * Math.round(8.5 * 1.45) + 10;

  // 1pt black 하단 룰 (히어로 블럭 경계)
  ctx.line(x, ctx.y, x + bodyW, ctx.y, C.black, 1);
  ctx.y -= 24;
}

function drawClosingHighlight(ctx: ReportContext, title: string, body: string) {
  const fontSize  = 8.5;
  const titleSize = 9.5;
  const maxW      = ctx.BODY_W;
  const lh        = Math.round(fontSize * 1.45);
  const lines     = wrapText(body, maxW, ctx.font, fontSize);
  const blockH    = 10 + titleSize + 6 + lines.length * lh + 10;

  ctx.ensureSpace(blockH + 8);

  const x = ctx.ML;
  const y = ctx.y;

  // 1pt accent 상단 룰
  ctx.line(x, y, x + ctx.BODY_W, y, ctx.theme.accent, 1);

  ctx.textBold(title, x, y - 10, titleSize, ctx.theme.accent, maxW);
  lines.forEach((line, idx) => {
    ctx.text(line, x, y - 10 - titleSize - 6 - idx * lh, fontSize, C.ink, maxW);
  });

  // hairline 하단
  ctx.line(x, y - blockH, x + ctx.BODY_W, y - blockH, C.rule, 0.25);

  ctx.y = y - blockH - 8;
}

// ─── 코멘트 블록 ─────────────────────────────────────────────────────────
function drawCommentBlock(
  ctx: ReportContext,
  title: string,
  body: string,
  color: RGB,
  font: PDFFont,
  showTopRule = true
) {
  const fontSize      = 8.5;
  const titleFontSize = 9;
  const lh            = Math.round(fontSize * 1.45);
  const maxW          = ctx.BODY_W;
  const bodyLines     = wrapText(body, maxW, font, fontSize);
  // 0.25pt 상단 룰 (옵션), 타이틀 Bold 액센트 색, 본문 Regular
  const blockH = 9 + titleFontSize + 5 + bodyLines.length * lh + 9;

  ctx.ensureSpace(blockH + 5);

  const bx = ctx.ML;
  const by = ctx.y;

  if (showTopRule) ctx.line(bx, by, bx + ctx.BODY_W, by, C.rule, 0.25);

  ctx.textBold(title, bx, by - 9, titleFontSize, color, maxW);
  bodyLines.forEach((line, li) => {
    ctx.text(line, bx, by - 9 - titleFontSize - 5 - li * lh, fontSize, C.ink, maxW);
  });

  ctx.y -= blockH + 5;
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
  ctx.y -= 6;   // 히어로 → 섹션 헤더 추가 여백 (소폭)
  drawSectionHeader(ctx, "거시 환경 요약", `기준: ${ymd}`);
  ctx.y -= 6;   // 섹션 헤더 → KPI 그리드 여백

  const cards: KpiCard[] = [];
  // ── Row 1: 주요 증시 ──
  if (market.kospi)    cards.push({ label: "KOSPI",    value: fmtInt(toNum(market.kospi.price)),    sub: fmtPct(toNum(market.kospi.changeRate)),    valueColor: pnlColor(toNum(market.kospi.changeRate)) });
  if (market.kosdaq)   cards.push({ label: "KOSDAQ",   value: fmtInt(toNum(market.kosdaq.price)),   sub: fmtPct(toNum(market.kosdaq.changeRate)),   valueColor: pnlColor(toNum(market.kosdaq.changeRate)) });
  if (market.sp500)    cards.push({ label: "S&P 500",  value: fmtInt(toNum(market.sp500.price)),    sub: fmtPct(toNum(market.sp500.changeRate)),    valueColor: pnlColor(toNum(market.sp500.changeRate)) });
  if (market.nasdaq)   cards.push({ label: "NASDAQ",   value: fmtInt(toNum(market.nasdaq.price)),   sub: fmtPct(toNum(market.nasdaq.changeRate)),   valueColor: pnlColor(toNum(market.nasdaq.changeRate)) });
  // ── Row 2: 금리·환율·심리 ──
  if (market.usdkrw)   cards.push({ label: "USD/KRW",   value: `${fmtInt(toNum(market.usdkrw.price))}원`, sub: fmtPct(toNum(market.usdkrw.changeRate)),   valueColor: C.text });
  if (market.us10y)    cards.push({ label: "미국 10년물", value: `${toNum(market.us10y.price).toFixed(2)}%`, sub: fmtPct(toNum(market.us10y.changeRate)),    valueColor: pnlColor(toNum(market.us10y.changeRate)) });
  if (market.vix)      cards.push({ label: "VIX",        value: toNum(market.vix.price).toFixed(2),   sub: toNum(market.vix.price) >= 30 ? "고위험" : toNum(market.vix.price) >= 20 ? "주의" : "안정", valueColor: toNum(market.vix.price) >= 30 ? C.up : C.text });
  if (market.fearGreed) cards.push({ label: "공포·탐욕",  value: String(toNum(market.fearGreed.score)), sub: market.fearGreed.rating ?? "",               valueColor: C.text });
  // ── Row 3: 원자재 ──
  if (market.gold)     cards.push({ label: "금 Gold",    value: `$${fmtInt(Math.round(toNum(market.gold.price)))}`,       sub: fmtPct(toNum(market.gold.changeRate)),    valueColor: pnlColor(toNum(market.gold.changeRate)) });
  if (market.wtiOil)   cards.push({ label: "WTI 원유",   value: `$${toNum(market.wtiOil.price).toFixed(1)}`,               sub: fmtPct(toNum(market.wtiOil.changeRate)),  valueColor: pnlColor(toNum(market.wtiOil.changeRate)) });
  if (market.copper)   cards.push({ label: "구리 Copper", value: `$${toNum(market.copper.price).toFixed(2)}`,              sub: fmtPct(toNum(market.copper.changeRate)),  valueColor: pnlColor(toNum(market.copper.changeRate)) });
  if (market.silver)   cards.push({ label: "은 Silver",  value: `$${toNum(market.silver.price).toFixed(2)}`,               sub: fmtPct(toNum(market.silver.changeRate)),  valueColor: pnlColor(toNum(market.silver.changeRate)) });

  while (cards.length % 4 !== 0) cards.push({ label: "", value: "" });
  if (cards.length > 0) drawKpiGrid(ctx, cards, 4);
  ctx.y -= 10;  // KPI 그리드 → 거시 해석 여백

  const vixVal  = market.vix      ? toNum(market.vix.price)      : 0;
  const fgVal   = market.fearGreed ? toNum(market.fearGreed.score) : 50;
  const us10yVal = market.us10y   ? toNum(market.us10y.price)    : 0;
  const usdkrwVal = market.usdkrw ? toNum(market.usdkrw.price)   : 0;
  const wtiVal  = market.wtiOil   ? toNum(market.wtiOil.price)   : 0;
  const goldVal = market.gold     ? toNum(market.gold.price)      : 0;
  const copperVal = market.copper ? toNum(market.copper.price)    : 0;

  const comments: string[] = [];
  if (vixVal >= 30)     comments.push(`VIX ${vixVal.toFixed(1)}로 변동성 위험 수준입니다. 옵션 헤지 비용이 높아진 구간으로 신규 진입 시 포지션 규모를 평소의 50~70% 이하로 제한하는 것이 좋습니다.`);
  else if (vixVal >= 20) comments.push(`VIX ${vixVal.toFixed(1)}로 경계 구간에 진입했습니다. 단기 급등락 가능성을 열어두고 손절·목표가 기준을 사전에 정해 두는 대응이 필요합니다.`);
  if (fgVal <= 20)      comments.push(`공포·탐욕 지수 ${fgVal}로 극단적 공포 구간입니다. 과거 사례상 이 구간은 중기 저점 형성 가능성이 높아 분할 매수를 고려할 만합니다.`);
  else if (fgVal <= 30) comments.push(`공포·탐욕 지수 ${fgVal}로 공포 심리가 우세합니다. 낙폭 과대 우량주의 기술적 반등 대응이 유효할 수 있습니다.`);
  else if (fgVal >= 75) comments.push(`공포·탐욕 지수 ${fgVal}로 탐욕 구간이 과열 중입니다. 추격 매수보다 보유 종목 수익 실현과 포지션 비중 조절을 우선 검토하세요.`);
  if (us10yVal >= 5)    comments.push(`미국 10년물 금리가 ${us10yVal.toFixed(2)}%로 부담 수준입니다. 높은 할인율은 성장주·기술주 밸류에이션 압박 요인으로 작용하며, 금융·에너지 등 가치주 상대 강세가 지속될 가능성이 있습니다.`);
  else if (us10yVal >= 4.5) comments.push(`미국 10년물 금리 ${us10yVal.toFixed(2)}%는 중립~경계 구간입니다. 금리 방향성과 연준 발언을 주시하며 성장주 비중을 조율하는 전략이 적절합니다.`);
  if (usdkrwVal >= 1400) comments.push(`원·달러가 ${fmtInt(usdkrwVal)}원으로 약세입니다. 외국인 환차익 메리트 감소로 코스피 수급 이탈 압력이 높아질 수 있으며, 수출주보다 내수·방어주 비중 확대가 유리할 수 있습니다.`);
  if (wtiVal >= 90)     comments.push(`WTI 유가 $${wtiVal.toFixed(1)}로 공급 비용 부담이 높습니다. 항공·운송·화학 등 원가 민감 업종에 불리하며 정유·에너지 섹터의 영업이익 확대 수혜를 참고하세요.`);
  if (goldVal >= 2500)  comments.push(`금 $${fmtInt(Math.round(goldVal))}로 안전자산 선호가 강합니다. 인플레이션 헤지 수요와 지정학적 불확실성이 복합적으로 작용 중이며, 포트폴리오 내 금·달러 방어 자산 비중을 점검할 필요가 있습니다.`);
  if (copperVal <= 3.5) comments.push(`구리 $${copperVal.toFixed(2)}로 경기 선행 신호가 약화됐습니다. 건설·인프라 수요 감소 우려가 내포된 신호로, 산업재 및 소재 섹터 비중 축소를 검토할 만합니다.`);

  const defaultComment = [
    `현재 핵심 거시 변수는 전반적으로 중립 범위에 위치합니다.`,
    `VIX ${vixVal.toFixed(1)}, 공포·탐욕 ${fgVal}, 미국 10년물 ${us10yVal.toFixed(2)}% 모두 과열·위기 임계치를 벗어나 있어 단기 시스템 리스크는 제한적입니다.`,
    `다만 금리·환율 방향성이 바뀌는 시점에서 노출 포지션을 신속하게 재조정할 수 있도록 손절·비중 기준을 사전 설정해 두는 것을 권장합니다.`,
  ].join(" ");

  drawCommentBlock(
    ctx,
    "거시 해석",
    comments.join(" ") || defaultComment,
    C.navyLight,
    font,
    false  // 거시 환경 요약과 바로 이어지므로 상단 룰 제거
  );
  ctx.y -= 10;  // 거시 해석 → 최종 결론 여백
}

export async function renderReportPdf(input: RenderReportInput): Promise<WeeklyPdfReport> {
  const {
    topicMeta,
    chatId,
    ymd,
    krDate,
    curr,
    prev,
    windows,
    watchItems,
    totalInvested,
    totalValue,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
  } = input;

  const theme = getReportTheme(topicMeta.topic);
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

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const fontLight = await pdf.embedFont(fontBytes.light);
  const font      = await pdf.embedFont(fontBytes.regular);
  const fontBold  = await pdf.embedFont(fontBytes.bold);
  const ctx = new ReportContext(pdf, fontLight, font, fontBold, theme);
  ctx.footerLabel = ymd;

  if (topicMeta.includeCover) {
    ctx.addPage(null);
    drawCoverPage(ctx, krDate, chatId, coverHeadline);
  }

  // 히어로 페이지는 타이틀 밴드 없이 히어로만 제목 표시, 이후 페이지는 밴드 유지
  ctx.addPage(null);
  ctx.pageTitle = topicMeta.title;
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

  const bytes = await pdf.save();
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

// ─── 메인 export ──────────────────────────────────────────────────────────
export async function createWeeklyReportPdf(
  supabase: SupabaseClient,
  options: { chatId: number; topic?: string | null }
): Promise<WeeklyPdfReport> {
  const chatId = options.chatId;
  const topicMeta = parseReportTopic(options.topic);
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

  return runReportStep("pdf_render", () =>
    renderReportPdf({
      topicMeta,
      chatId,
      ymd,
      krDate,
      curr,
      prev,
      windows,
      watchItems,
      totalInvested,
      totalValue,
      totalUnrealized,
      totalUnrealizedPct,
      sectors: sectorRes.data ?? [],
      market,
    })
  );
}

// ─── 로컬 프리뷰용 렌더 함수 (Supabase 없이 mock 데이터로 생성) ────────────
export async function createPreviewReportPdf(topicStr = "economy"): Promise<Uint8Array> {
  const topicMeta = parseReportTopic(topicStr);
  const ymd       = "2025-01-24";
  const krDate    = "2025년 1월 24일";
  const chatId    = 0;

  const curr: WindowSummary = { buyCount: 3, sellCount: 2, tradeCount: 5, realizedPnl: 120000, winRate: 66.7 };
  const prev: WindowSummary = { buyCount: 2, sellCount: 1, tradeCount: 3, realizedPnl: -50000, winRate: 50 };
  const windows = { current14: [] as TradeRow[], prev14: [] as TradeRow[], recent: [] as TradeRow[] };

  const watchItems: WatchItem[] = [
    { code: "005930", name: "삼성전자",  qty: 10, buyPrice: 68000,  currentPrice: 71000,  invested: 680000,  value: 710000,  unrealized: 30000,  pnlPct: 4.41  },
    { code: "000660", name: "SK하이닉스", qty:  5, buyPrice: 182000, currentPrice: 175000, invested: 910000,  value: 875000,  unrealized: -35000, pnlPct: -3.85 },
    { code: "373220", name: "LG에너지솔루션", qty: 2, buyPrice: 412000, currentPrice: 430000, invested: 824000, value: 860000, unrealized: 36000, pnlPct: 4.37 },
  ];
  const totalInvested      = watchItems.reduce((s, i) => s + i.invested, 0);
  const totalValue         = watchItems.reduce((s, i) => s + i.value, 0);
  const totalUnrealized    = totalValue - totalInvested;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;

  const sectors: SectorRow[] = [
    { name: "반도체",    score: 85, change_rate:  2.1, metrics: { flow_foreign_5d: 300,  flow_inst_5d: 150 } },
    { name: "2차전지",   score: 72, change_rate: -1.3, metrics: { flow_foreign_5d: -200, flow_inst_5d:  50 } },
    { name: "바이오",    score: 68, change_rate:  0.8, metrics: { flow_foreign_5d: 100,  flow_inst_5d: -30 } },
    { name: "자동차",    score: 61, change_rate:  1.5, metrics: { flow_foreign_5d:  50,  flow_inst_5d:  80 } },
    { name: "금융",      score: 55, change_rate: -0.5, metrics: { flow_foreign_5d: -100, flow_inst_5d: -60 } },
    { name: "철강/소재", score: 49, change_rate: -0.2, metrics: { flow_foreign_5d:  20,  flow_inst_5d:  10 } },
  ];

  // mock 시장 데이터 (fetchAllMarketData 호환 구조)
  const market = {
    kospi:     { price: 2520.31, changeRate:  0.82 },
    kosdaq:    { price:  742.18, changeRate:  1.24 },
    sp500:     { price: 5875.42, changeRate:  0.35 },
    nasdaq:    { price: 19280.16,changeRate:  0.61 },
    vix:       { price:   18.32, changeRate: -5.20 },
    usdkrw:    { price: 1388,    changeRate: -0.24 },
    us10y:     { price:    4.58, changeRate:  0.03 },
    us2y:      { price:    4.32, changeRate:  0.01 },
    fearGreed: { score: 52, rating: "Neutral" },
    wtiOil:    { price:   78.4,  changeRate:  1.10 },
    gold:      { price: 2642,    changeRate:  0.40 },
    silver:    { price:  29.85,  changeRate:  0.30 },
    copper:    { price:   4.12,  changeRate: -0.50 },
    btc:       { price: 105280,  changeRate:  3.20 },
    dxy:       { price:  107.2,  changeRate: -0.20 },
    hyg:       { price:   79.1,  changeRate:  0.10 },
    tnx:       { price:    4.58, changeRate:  0.03 },
    em:        { price: 1090,    changeRate:  0.50 },
  } as unknown as Awaited<ReturnType<typeof fetchAllMarketData>>;

  const rendered = await renderReportPdf({
    topicMeta,
    chatId,
    ymd,
    krDate,
    curr,
    prev,
    windows,
    watchItems,
    totalInvested,
    totalValue,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
  });

  return rendered.bytes;
}