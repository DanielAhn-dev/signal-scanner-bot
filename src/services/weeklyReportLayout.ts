import { type PDFFont, rgb, type RGB } from "pdf-lib";
import { C, type ReportTheme, vCenterTopY } from "./weeklyReportShared";

type LayoutContext = {
  W: number;
  H: number;
  ML: number;
  MR: number;
  MB: number;
  BODY_W: number;
  pageNum: number;
  y: number;
  font: PDFFont;
  theme: ReportTheme;
  ensureSpace(height: number, buffer?: number): void;
  rect(x: number, y: number, w: number, h: number, color: RGB): void;
  line(x1: number, y1: number, x2: number, y2: number, color?: RGB, thickness?: number): void;
  text(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textBold(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textLight(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textRight(s: string, rightEdge: number, y: number, size: number, color?: RGB): void;
  textCenter(s: string, cx: number, y: number, size: number, color?: RGB): void;
  textCenterBold(s: string, cx: number, y: number, size: number, color?: RGB): void;
};

const PAGE_TITLE_H = 20;

export function drawFooter(ctx: LayoutContext, today: string) {
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

export function drawCoverPage(
  ctx: LayoutContext,
  ymd: string,
  chatId: number,
  headline?: { kicker: string; detail: string }
) {
  const { W, H, ML, MR } = ctx;
  const bodyW = W - ML - MR;

  ctx.rect(0, H - 180, W, 180, C.black);
  ctx.rect(0, H - 181, W, 2.5, ctx.theme.accent);
  ctx.textCenter("WEEKLY MARKET REPORT", W / 2, H - 44, 8, ctx.theme.accent);
  ctx.textCenterBold("주간 증시 리포트", W / 2, H - 80, 24, C.white);
  ctx.textCenter(`${ymd}  ·  ID ${String(chatId).slice(-4).padStart(4, "*")}`, W / 2, H - 118, 8.5, C.subtle);

  if (headline) {
    const boxY = H - 148;
    const boxH = 28;
    ctx.rect(ML, boxY - boxH, bodyW * 0.76, boxH, rgb(0.10, 0.10, 0.12));
    ctx.rect(ML, boxY - boxH, 3, boxH, ctx.theme.accent);
    const hY = vCenterTopY(boxY, boxH, 8.5);
    ctx.text(headline.kicker, ML + 10, hY, 8, C.subtle, bodyW * 0.72);
  }

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
  toc.forEach((item, index) => {
    ctx.text(item, ML, tocY - 16 - index * 17, 8.5, C.ink);
  });

  const barX = ML + bodyW * 0.65;
  for (let i = 0; i < 5; i++) {
    const bh = 20 + i * 10;
    ctx.rect(barX + i * 10, tocY - toc.length * 17 - 6, 1.5, bh, i === 2 ? ctx.theme.accent : C.rule);
  }

  const dY = 76;
  ctx.line(ML, dY + 1, W - MR, dY + 1, C.rule, 0.5);
  ctx.text(
    "본 리포트는 가상 포트폴리오 기준이며 실제 투자 결과를 보증하지 않습니다. 투자 판단의 최종 책임은 투자자 본인에게 있습니다.",
    ML, dY - 6, 6.5, C.subtle, bodyW
  );
}

export function drawPageTitle(ctx: LayoutContext, title: string) {
  ctx.rect(ctx.ML, ctx.y - PAGE_TITLE_H, ctx.BODY_W, PAGE_TITLE_H, ctx.theme.pageBand);
  ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, ctx.theme.accent, 1);
  const tY = vCenterTopY(ctx.y, PAGE_TITLE_H, 9);
  ctx.textCenterBold(title, ctx.W / 2, tY, 9, C.white);
  ctx.y -= PAGE_TITLE_H + 6;
}

export function drawTopicHero(ctx: LayoutContext, title: string, subtitle: string) {
  const bodyW = ctx.BODY_W;
  const x = ctx.ML;
  ctx.ensureSpace(80);

  ctx.textLight(ctx.theme.heroLabel, x, ctx.y, 6.5, ctx.theme.accent);
  ctx.y -= Math.round(6.5 * 1.45) + 5;

  ctx.textBold(title, x, ctx.y, 20, C.ink, bodyW);
  ctx.y -= Math.round(20 * 1.45) + 4;

  const subLines = ctx.textLight(subtitle, x, ctx.y, 8.5, C.dim, bodyW);
  ctx.y -= subLines * Math.round(8.5 * 1.45) + 10;

  ctx.line(x, ctx.y, x + bodyW, ctx.y, C.black, 1);
  ctx.y -= 24;
}

export function drawClosingHighlight(
  ctx: LayoutContext,
  title: string,
  body: string,
  wrapText: (text: string, maxWidth: number, font: PDFFont, size: number) => string[]
) {
  const fontSize = 8.5;
  const titleSize = 9.5;
  const maxW = ctx.BODY_W;
  const lh = Math.round(fontSize * 1.45);
  const lines = wrapText(body, maxW, ctx.font, fontSize);
  const blockH = 10 + titleSize + 6 + lines.length * lh + 10;

  ctx.ensureSpace(blockH + 8);

  const x = ctx.ML;
  const y = ctx.y;
  ctx.line(x, y, x + ctx.BODY_W, y, ctx.theme.accent, 1);
  ctx.textBold(title, x, y - 10, titleSize, ctx.theme.accent, maxW);
  lines.forEach((line, index) => {
    ctx.text(line, x, y - 10 - titleSize - 6 - index * lh, fontSize, C.ink, maxW);
  });
  ctx.line(x, y - blockH, x + ctx.BODY_W, y - blockH, C.rule, 0.25);
  ctx.y = y - blockH - 8;
}