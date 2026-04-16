import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, PDFPage, PDFFont, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchReportMarketData } from "../utils/fetchMarketData";
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
};

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
};

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

  constructor(pdf: PDFDocument, font: PDFFont) {
    this.pdf = pdf;
    this.font = font;
    this.BODY_W = this.W - this.ML - this.MR;
  }

  addPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.y = this.H - this.MT;
    this.pageNum++;
  }

  // [FIX] ensureSpace: 여유 버퍼를 추가해 경계 직전 요소가 잘리지 않도록
  ensureSpace(h: number, buffer = 8) {
    if (this.y < this.MB + h + buffer) this.addPage();
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
  // [FIX] 풋터를 MB 기준에서 그림 — 항상 고정 위치
  const lineY = MB - 2;
  const textY = MB - 16;
  ctx.line(ML, lineY, W - MR, lineY, C.border);
  ctx.text(
    "Signal Scanner Bot  |  가상 포트폴리오 기준 · 실제 투자 결과와 다를 수 있습니다.",
    ML, textY, 7, C.muted
  );
  ctx.textRight(`발행: ${today}  |  ${ctx.pageNum}페이지`, W - MR, textY, 7, C.muted);
}

// ─── 섹션 헤더 밴드 ──────────────────────────────────────────────────────
// [FIX] 섹션 헤더 높이와 텍스트 수직 중앙 정렬 통일
const SECTION_H = 24;

function drawSectionHeader(ctx: ReportContext, label: string, sub?: string) {
  ctx.ensureSpace(SECTION_H + 20);
  const { ML, MR, W } = ctx;
  ctx.rect(ML, ctx.y - SECTION_H, W - ML - MR, SECTION_H, C.navy);
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
    ctx.rect(x, y - cardH, cardW, cardH, C.bg);
    ctx.rect(x, y - cardH, 3, cardH, C.navyLight);
    ctx.line(x,          y - cardH, x + cardW, y - cardH, C.border);
    ctx.line(x + cardW,  y - cardH, x + cardW, y,          C.border);
    ctx.line(x,          y,         x + cardW, y,           C.border);

    if (!card.label && !card.value) return; // 빈 패딩 카드

    // [FIX] 라벨: 카드 상단에서 14px
    ctx.text(card.label, x + contentPadX, y - 10, 7.5, C.muted, contentMaxW);
    // [FIX] 값: 카드 상단에서 30px (라벨 아래 적절한 간격)
    ctx.text(card.value, x + contentPadX, y - 26, 12, card.valueColor ?? C.text, contentMaxW);
    // [FIX] 서브: 카드 하단에서 8px
    if (card.sub) ctx.text(card.sub, x + contentPadX, y - 42, 7.5, C.muted, contentMaxW);
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
  ctx.rect(ctx.ML, ctx.y - rowH, ctx.BODY_W, rowH, rgb(0.90, 0.92, 0.97));
  ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, C.border);
  ctx.line(ctx.ML, ctx.y - rowH, ctx.ML + ctx.BODY_W, ctx.y - rowH, C.border);

  const labelY = needsWrap ? ctx.y - 11 : ctx.y - rowH / 2 + 5;
  ctx.text(label, ctx.ML + padX, labelY, fontSize, C.navyLight);

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
  ctx.rect(ML, ctx.y - HEADER_H, totalW, HEADER_H, C.navyLight);
  let hx = ML;
  for (const col of cols) {
    ctx.text(col.header, hx + CELL_PAD, ctx.y - headerTopOffset, fontSize, C.white, col.width - CELL_PAD * 2);
    hx += col.width;
  }
  ctx.y -= HEADER_H;

  // 테이블 상단 구분선
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.border);

  // 데이터 행
  rows.forEach((row, ri) => {
    ctx.ensureSpace(ROW_H + 4);

    const bg = ri % 2 === 0 ? C.white : C.bg;
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
    ctx.line(ML, ctx.y - ROW_H, ML + totalW, ctx.y - ROW_H, C.border);
    ctx.y -= ROW_H;
  });

  // 테이블 좌/우 외곽선
  const tableTop = ctx.y + ROW_H * rows.length + HEADER_H;
  ctx.line(ML,           tableTop, ML,           ctx.y, C.border);
  ctx.line(ML + totalW,  tableTop, ML + totalW,  ctx.y, C.border);
  // 하단 마감선
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.border);

  ctx.y -= 6; // 테이블 하단 여백
}

// ─── 커버 페이지 ─────────────────────────────────────────────────────────
function drawCoverPage(ctx: ReportContext, ymd: string, chatId: number) {
  const { W, H, ML, MR } = ctx;

  // 상단 네이비 밴드
  ctx.rect(0, H - 160, W, 160, C.navy);

  // 서비스명
  ctx.textCenter("SIGNAL  SCANNER  BOT", W / 2, H - 48, 11, rgb(0.65, 0.75, 0.92));

  // 리포트 제목
  ctx.textCenter("주  간  포  트  폴  리  오  리  포  트", W / 2, H - 88, 18, C.white);

  // 오렌지 강조선
  ctx.rect(ML, H - 163, W - ML - MR, 3, C.accent);

  // 발행 정보
  ctx.text(`기준일: ${ymd}`, ML, H - 188, 10, C.text);
  ctx.text(`계좌 ID: ${String(chatId).slice(-4).padStart(4, "*")}`, ML, H - 204, 10, C.muted);

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
    "본 리포트는 Signal Scanner Bot이 생성한 가상 포트폴리오 정보이며, 실제 투자 결과를 보증하지 않습니다.",
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
  ctx.rect(ctx.ML, ctx.y - PAGE_TITLE_H, ctx.BODY_W, PAGE_TITLE_H, C.navy);
  ctx.textCenter(title, ctx.W / 2, ctx.y - PAGE_TITLE_H / 2 + 5, 12, C.white);
  ctx.y -= PAGE_TITLE_H + 8;
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

  ctx.rect(bx,     by - blockH, ctx.BODY_W, blockH, C.bg);
  ctx.rect(bx,     by - blockH, 4,          blockH, color);
  ctx.line(bx,     by - blockH, bx + ctx.BODY_W, by - blockH, C.border);
  ctx.line(bx,     by,          bx + ctx.BODY_W, by,          C.border);

  // 타이틀
  ctx.text(title, bx + 12, by - 10, titleFontSize, color, maxW);
  // 바디 라인
  bodyLines.forEach((line, li) => {
    ctx.text(line, bx + 12, by - 10 - titleFontSize - 6 - li * (fontSize + 4), fontSize, C.text, maxW);
  });

  ctx.y -= blockH + 6;
}

// ─── 메인 export ──────────────────────────────────────────────────────────
export async function createWeeklyReportPdf(
  supabase: SupabaseClient,
  options: { chatId: number }
): Promise<WeeklyPdfReport> {
  const chatId = options.chatId;
  const now = new Date();
  const kstNow = asKstDate(now);
  const ymd = toYmd(kstNow);
  const krDate = toKrDate(now);

  // ── 데이터 조회 ─────────────────────────────────────────────────────────
  const tradeSince = shiftDays(now, -28).toISOString();

  const [tradeRes, watchRes, sectorRes] = await Promise.all([
    supabase
      .from("virtual_trades")
      .select("side, code, price, quantity, pnl_amount, traded_at")
      .eq("chat_id", chatId)
      .gte("traded_at", tradeSince)
      .order("traded_at", { ascending: false })
      .limit(300)
      .returns<TradeRow[]>(),
    supabase
      .from("watchlist")
      .select("code, buy_price, quantity, invested_amount, status, stock:stocks(code,name,close)")
      .eq("chat_id", chatId)
      .returns<WatchlistRow[]>(),
    supabase
      .from("sectors")
      .select("name, score, change_rate")
      .order("score", { ascending: false })
      .limit(3)
      .returns<SectorRow[]>(),
  ]);

  if (tradeRes.error) throw new Error(`virtual_trades 조회 실패: ${tradeRes.error.message}`);
  if (watchRes.error) throw new Error(`watchlist 조회 실패: ${watchRes.error.message}`);

  const market = await fetchReportMarketData().catch(() => ({} as any));

  const rows = tradeRes.data ?? [];
  const windows = splitWindows(rows, now);
  const curr = summarizeWindow(windows.current14);
  const prev = summarizeWindow(windows.prev14);

  const codes = (watchRes.data ?? []).map((r) => r.code);
  const realtimeMap = codes.length
    ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>))
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
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadKoreanFontBytes();
  const font = await pdf.embedFont(fontBytes);
  const ctx = new ReportContext(pdf, font);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [1] 커버 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctx.addPage();
  drawCoverPage(ctx, krDate, chatId);
  drawFooter(ctx, ymd);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [2] 시장 개요 + 포트폴리오 요약 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctx.addPage();
  drawPageTitle(ctx, "I.  시장 개요 및 포트폴리오 요약");

  // 시장 지표 KPI 카드
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
      sub: vixVal >= 30 ? "⚠ 고공포" : vixVal >= 20 ? "주의" : "안정",
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
  // 4의 배수로 패딩
  while (mktCards.length % 4 !== 0) mktCards.push({ label: "", value: "" });
  if (mktCards.length > 0) drawKpiGrid(ctx, mktCards, 4);

  // 주도 섹터
  const sectors = sectorRes.data ?? [];
  if (sectors.length > 0) {
    ctx.y -= 4;
    drawSectionHeader(ctx, "주도 섹터 Top 3", `기준: ${ymd}`);
    drawTable(
      ctx,
      [
        { header: "순위", width: 40,  align: "center" },
        { header: "섹터명", width: 200 },
        { header: "점수", width: 70,  align: "right" },
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

  // 포트폴리오 요약
  ctx.y -= 6;
  drawSectionHeader(ctx, "II.  포트폴리오 요약");
  const pfCards: KpiCard[] = [
    { label: "총 원금",            value: `${fmtInt(totalInvested)}원`,      valueColor: C.text },
    { label: "평가금액",           value: `${fmtInt(totalValue)}원`,          valueColor: C.text },
    { label: "평가손익",           value: fmtSignedInt(totalUnrealized),      sub: fmtPct(totalUnrealizedPct), valueColor: pnlColor(totalUnrealized) },
    { label: "보유 종목수",        value: `${watchItems.length}개`,           valueColor: C.text },
    { label: "거래 (최근 2주)",    value: `${curr.tradeCount}건`,             sub: `매수 ${curr.buyCount} / 매도 ${curr.sellCount}`, valueColor: C.text },
    { label: "실현손익 (2주)",     value: fmtSignedInt(curr.realizedPnl),     valueColor: pnlColor(curr.realizedPnl) },
    { label: "승률 (2주)",         value: `${curr.winRate.toFixed(1)}%`,      sub: curr.sellCount > 0 ? `${curr.sellCount}건 매도 기준` : "매도 없음", valueColor: curr.winRate >= 50 ? C.up : C.down },
    { label: "이전 2주 대비",      value: fmtSignedInt(curr.realizedPnl - prev.realizedPnl), sub: "실현손익 증감", valueColor: pnlColor(curr.realizedPnl - prev.realizedPnl) },
  ];
  drawKpiGrid(ctx, pfCards, 4);
  drawFooter(ctx, ymd);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [3] 매매 기록 상세 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctx.addPage();
  drawPageTitle(ctx, "III.  매매 기록 및 성과 분석");

  const perfCards: KpiCard[] = [
    { label: "이전 2주 거래",  value: `${prev.tradeCount}건`,               sub: `매수 ${prev.buyCount} / 매도 ${prev.sellCount}` },
    { label: "이번 2주 거래",  value: `${curr.tradeCount}건`,               sub: `매수 ${curr.buyCount} / 매도 ${curr.sellCount}`, valueColor: C.navyLight },
    { label: "이전 2주 승률",  value: `${prev.winRate.toFixed(1)}%`,        sub: "전분기", valueColor: pnlColor(prev.winRate - 50) },
    { label: "이번 2주 승률",  value: `${curr.winRate.toFixed(1)}%`,        sub: "당분기", valueColor: pnlColor(curr.winRate - 50) },
    { label: "이전 실현손익",  value: fmtSignedInt(prev.realizedPnl),       valueColor: pnlColor(prev.realizedPnl) },
    { label: "이번 실현손익",  value: fmtSignedInt(curr.realizedPnl),       valueColor: pnlColor(curr.realizedPnl) },
    { label: "손익 증감",       value: fmtSignedInt(curr.realizedPnl - prev.realizedPnl), sub: "이전 대비", valueColor: pnlColor(curr.realizedPnl - prev.realizedPnl) },
    { label: "승률 변화",       value: fmtPct(curr.winRate - prev.winRate), valueColor: pnlColor(curr.winRate - prev.winRate) },
  ];
  drawKpiGrid(ctx, perfCards, 4);

  ctx.y -= 4;
  drawSectionHeader(ctx, "최근 거래 내역", "최근 10건");

  if (windows.recent.length > 0) {
    drawTable(
      ctx,
      [
        { header: "일자",      width: 58,  align: "center" },
        { header: "구분",      width: 42,  align: "center" },
        { header: "종목코드",  width: 64,  align: "center" },
        { header: "수량",      width: 50,  align: "right" },
        { header: "단가 (원)", width: 88,  align: "right" },
        { header: "금액 (원)", width: 88,  align: "right" },
        { header: "실현손익",  width: 117, align: "right" },
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
      windows.recent.map((r) =>
        r.side === "SELL" ? pnlColor(toNum(r.pnl_amount)) : C.down
      )
    );
  } else {
    ctx.y -= 4;
    ctx.text("최근 2주 거래 기록이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
  }

  drawFooter(ctx, ymd);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [4] 보유 종목 상세 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctx.addPage();
  drawPageTitle(ctx, "IV.  보유 종목 상세");

  if (watchItems.length > 0) {
    ctx.y -= 2;
    drawSectionHeader(ctx, "종목별 현황", `총 ${watchItems.length}개 종목`);
    drawTable(
      ctx,
      [
        { header: "종목명",   width: 112, align: "left" },
        { header: "코드",     width: 54,  align: "center" },
        { header: "수량",     width: 46,  align: "right" },
        { header: "평균단가", width: 78,  align: "right" },
        { header: "현재가",   width: 78,  align: "right" },
        { header: "평가손익", width: 80,  align: "right" },
        { header: "수익률",   width: 59,  align: "right" },
      ],
      watchItems.slice(0, 20).map((item) => [
        truncate(item.name, 10),
        item.code,
        `${item.qty}주`,
        item.buyPrice    ? fmtInt(item.buyPrice)    : "-",
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

  drawFooter(ctx, ymd);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // [5] 주간 코멘트 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ctx.addPage();
  drawPageTitle(ctx, "V.  주간 코멘트 및 대응 전략");

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
  drawCommentBlock(
    ctx,
    "승률 분석",
    winNote,
    curr.winRate >= prev.winRate ? C.up : C.down,
    font
  );

  const pfNote =
    totalUnrealized >= 0
      ? `현재 포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)}(${fmtPct(totalUnrealizedPct)})로 양호합니다.`
      : `현재 포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)}(${fmtPct(totalUnrealizedPct)})로 미실현 손실 구간입니다. 개별 종목 비중 점검이 필요합니다.`;
  drawCommentBlock(ctx, "포트폴리오 평가", pfNote, pnlColor(totalUnrealized), font);

  const topLoss = watchItems.filter((i) => (i.pnlPct ?? 0) < -5);
  if (topLoss.length > 0) {
    const names = topLoss
      .slice(0, 3)
      .map((i) => `${i.name}(${fmtPct(i.pnlPct ?? 0)})`)
      .join(", ");
    drawCommentBlock(
      ctx,
      "손절 재점검 대상",
      `평가손실 -5% 초과 종목: ${names}. 손절 기준일 재확인 후 비중 축소를 고려하세요.`,
      C.up,
      font
    );
  }

  const sectorNames = (sectorRes.data ?? [])
    .slice(0, 2)
    .map((s) => s.name)
    .join(", ");
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

  drawFooter(ctx, ymd);

  // ── 반환 ────────────────────────────────────────────────────────────────
  const bytes = await pdf.save();

  const caption = [
    `주간 포트폴리오 리포트 — ${krDate}`,
    `거래 ${curr.tradeCount}건 · 실현손익 ${fmtSignedInt(curr.realizedPnl)} · 보유평가 ${fmtSignedInt(totalUnrealized)}`,
    "다운로드 후 인쇄해서 사용하세요.",
  ].join("\n");

  const summaryText = [
    `주간 요약 (${ymd})`,
    `거래 ${curr.tradeCount}건 / 실현손익 ${fmtSignedInt(curr.realizedPnl)} / 승률 ${curr.winRate.toFixed(1)}%`,
    `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
  ].join("\n");

  return {
    bytes,
    fileName: `signal_weekly_report_${chatId}_${ymd}.pdf`,
    caption,
    summaryText,
  };
}