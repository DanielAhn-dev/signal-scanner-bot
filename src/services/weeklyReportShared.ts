import { rgb, type RGB } from "pdf-lib";

export const C = {
  black: rgb(0.06, 0.06, 0.07),
  ink: rgb(0.12, 0.12, 0.14),
  dim: rgb(0.40, 0.40, 0.44),
  subtle: rgb(0.60, 0.60, 0.64),
  rule: rgb(0.83, 0.83, 0.86),
  surface: rgb(0.96, 0.96, 0.97),
  alt: rgb(0.91, 0.91, 0.93),
  white: rgb(1.00, 1.00, 1.00),
  up: rgb(0.82, 0.10, 0.10),
  down: rgb(0.08, 0.40, 0.72),
  navy: rgb(0.06, 0.06, 0.07),
  navyLight: rgb(0.22, 0.22, 0.26),
  accent: rgb(0.06, 0.06, 0.07),
  neutral: rgb(0.40, 0.40, 0.44),
  text: rgb(0.12, 0.12, 0.14),
  muted: rgb(0.60, 0.60, 0.64),
  bg: rgb(0.96, 0.96, 0.97),
  border: rgb(0.83, 0.83, 0.86),
} as const;

export type ReportTopic = "full" | "watchlist" | "watchonly" | "economy" | "flow" | "sector" | "pullback";

export type ReportTopicMeta = {
  topic: ReportTopic;
  title: string;
  fileSlug: string;
  includeCover: boolean;
  progressText: string;
  captionTitle: string;
};

export type ReportTheme = {
  pageBand: RGB;
  sectionBand: RGB;
  accent: RGB;
  softBg: RGB;
  border: RGB;
  subtitle: RGB;
  heroLabel: string;
  heroSummary: string;
};

export const FIFO_REALIZED_LABEL = "실현손익(FIFO)";
export const FIFO_WIN_RATE_LABEL = "승률(FIFO)";
export const FIFO_TRADE_NOTE = "매도 손익은 FIFO 기준";

export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

export function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function fmtSignedInt(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtInt(v)}원`;
}

export function asKstDate(d: Date): Date {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

export function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toKrDate(d: Date): string {
  const kst = asKstDate(d);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

export function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function lineDate(raw: string): string {
  const d = new Date(raw);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

export function pnlColor(v: number): RGB {
  if (v > 0) return C.up;
  if (v < 0) return C.down;
  return C.dim;
}

export function vCenterTopY(boxTopY: number, boxH: number, fontSize: number): number {
  return boxTopY - boxH / 2 + fontSize * 0.50;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function fmtKorMoney(v: number): string {
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

export function parseReportTopic(raw?: string | null): ReportTopicMeta {
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

  if (["눌림목", "다음주", "선진입", "pullback", "nextweek", "weeklysetup"].includes(token)) {
    return {
      topic: "pullback",
      title: "다음 주 눌림목 리포트",
      fileSlug: "weekly_pullback_report",
      includeCover: false,
      progressText: "다음 주 눌림목 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "다음 주 눌림목 리포트",
    };
  }

  if (["보유", "포트폴리오", "holdings", "portfolio"].includes(token)) {
    return {
      topic: "watchlist",
      title: "보유 포트폴리오 리포트",
      fileSlug: "watchlist_report",
      includeCover: false,
      progressText: "보유 포트폴리오 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
      captionTitle: "보유 포트폴리오 리포트",
    };
  }

  if (["관심", "관심종목", "watchonly", "watch"].includes(token)) {
    return {
      topic: "watchonly",
      title: "관심종목 리포트",
      fileSlug: "watchonly_report",
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

export function getReportTheme(topic: ReportTopic): ReportTheme {
  if (topic === "economy") {
    return createReportTheme({
      pageBand: rgb(0.06, 0.06, 0.08),
      accent: rgb(0.26, 0.28, 0.88),
      heroLabel: "MACRO SNAPSHOT",
      heroSummary: "금리, 환율, 변동성, 글로벌 위험선호를 한 페이지 감도로 정리합니다.",
    });
  }

  if (topic === "flow") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.04, 0.62, 0.44),
      heroLabel: "FLOW MONITOR",
      heroSummary: "외국인·기관 자금 방향을 중심으로 강한 섹터와 약한 섹터를 분리합니다.",
    });
  }

  if (topic === "sector") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.92, 0.56, 0.04),
      heroLabel: "SECTOR ROTATION",
      heroSummary: "점수와 수익률을 동시에 보며 현재 시장의 중심 테마를 압축합니다.",
    });
  }

  if (topic === "watchlist") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.04, 0.50, 0.72),
      heroLabel: "PORTFOLIO CHECK",
      heroSummary: "보유 종목의 손익, 거래 흐름, 대응 포인트를 빠르게 확인할 수 있게 정리합니다.",
    });
  }

  if (topic === "watchonly") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.26, 0.60, 0.26),
      heroLabel: "WATCHLIST",
      heroSummary: "매수 전 관심 목록에 담아 둔 종목들의 현황을 한눈에 파악합니다.",
    });
  }

  if (topic === "pullback") {
    return createReportTheme({
      pageBand: C.black,
      accent: rgb(0.92, 0.74, 0.12),
      heroLabel: "NEXT WEEK SETUP",
      heroSummary: "다음 주 선진입 후보를 눌림목 신호와 개인 자금 기준으로 압축합니다.",
    });
  }

  return createReportTheme({
    pageBand: C.black,
    accent: C.black,
    heroLabel: "WEEKLY OUTLOOK",
    heroSummary: "시장 환경, 포트폴리오 상태, 최근 거래와 주간 대응 전략을 한 번에 묶습니다.",
  });
}