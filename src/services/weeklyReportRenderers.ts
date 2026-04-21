import type { PDFFont, RGB } from "pdf-lib";
import { C, truncate, vCenterTopY } from "./weeklyReportShared";

export type ReportRenderContext = {
  ML: number;
  MR: number;
  W: number;
  BODY_W: number;
  y: number;
  font: PDFFont;
  ensureSpace(height: number, buffer?: number): void;
  line(x1: number, y1: number, x2: number, y2: number, color?: RGB, thickness?: number): void;
  text(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textBold(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textLight(s: string, x: number, y: number, size: number, color?: RGB, maxW?: number): number;
  textRight(s: string, rightEdge: number, y: number, size: number, color?: RGB): void;
  textRightBold(s: string, rightEdge: number, y: number, size: number, color?: RGB): void;
  textRightLight(s: string, rightEdge: number, y: number, size: number, color?: RGB): void;
  textCenter(s: string, cx: number, y: number, size: number, color?: RGB): void;
  textCenterBold(s: string, cx: number, y: number, size: number, color?: RGB): void;
};

export type KpiCard = { label: string; value: string; sub?: string; valueColor?: RGB };
export type ColDef = { header: string; width: number; align?: "left" | "right" | "center" };

const SECTION_H = 22;
const ROW_H = 18;
const HEADER_H = 20;
const CELL_PAD = 5;

function ellipsizeToWidth(text: string, maxWidth: number, font: PDFFont, size: number): string {
  const raw = String(text ?? "");
  if (!raw) return "";
  if (font.widthOfTextAtSize(raw, size) <= maxWidth) return raw;

  const ellipsis = "…";
  let end = raw.length;
  while (end > 1) {
    const candidate = raw.slice(0, end - 1) + ellipsis;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      return candidate;
    }
    end -= 1;
  }

  return ellipsis;
}

function fitColumnsToWidth(cols: ColDef[], targetWidth: number): ColDef[] {
  const totalWidth = cols.reduce((sum, col) => sum + col.width, 0);
  if (totalWidth <= targetWidth) {
    return cols;
  }

  const scaled = cols.map((col) => ({
    ...col,
    width: Math.max(28, Math.floor((col.width / totalWidth) * targetWidth)),
  }));

  let scaledTotal = scaled.reduce((sum, col) => sum + col.width, 0);
  let diff = targetWidth - scaledTotal;
  let index = 0;

  while (diff !== 0 && scaled.length > 0) {
    const col = scaled[index % scaled.length];
    if (diff > 0) {
      col.width += 1;
      diff -= 1;
    } else if (col.width > 28) {
      col.width -= 1;
      diff += 1;
    }
    index += 1;
    if (index > scaled.length * 4 && diff < 0) break;
  }

  scaledTotal = scaled.reduce((sum, col) => sum + col.width, 0);
  if (scaledTotal !== targetWidth) {
    scaled[scaled.length - 1].width += targetWidth - scaledTotal;
  }

  return scaled;
}

export function drawSectionHeader(ctx: ReportRenderContext, label: string, sub?: string) {
  ctx.ensureSpace(SECTION_H + 18);
  const { ML, MR, W } = ctx;
  ctx.line(ML, ctx.y, W - MR, ctx.y, C.rule, 0.75);
  const textY = ctx.y - 9;
  ctx.textBold(label, ML, textY, 10.5, C.ink);
  if (sub) ctx.textRightLight(sub, W - MR - 24, textY, 6.5, C.dim);
  ctx.y -= SECTION_H + 3;
}

export function drawKpiGrid(ctx: ReportRenderContext, cards: KpiCard[], cols = 4) {
  const { ML, W } = ctx;
  const totalW = W - ML - ctx.MR;
  const cardW = totalW / cols;
  const cardH = 56;
  const padX = 10;
  const maxW = cardW - padX * 2;
  const rows = Math.ceil(cards.length / cols);

  ctx.ensureSpace(cardH * rows + 8);

  const startX = ML;
  const startY = ctx.y;

  for (let r = 0; r <= rows; r++) {
    const ry = startY - r * cardH;
    const thickness = r === 0 ? 0.75 : r === rows ? 1.5 : 0.25;
    ctx.line(ML, ry, ML + totalW, ry, C.rule, thickness);
  }
  for (let c = 1; c < cols; c++) {
    ctx.line(ML + c * cardW, startY, ML + c * cardW, startY - rows * cardH, C.rule, 0.25);
  }

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * cardW;
    const y = startY - row * cardH;

    if (!card.label && !card.value) return;

    ctx.textLight(card.label, x + padX, y - 10, 6.5, C.dim, maxW);
    ctx.textBold(card.value, x + padX, y - 21, 14, card.valueColor ?? C.ink, maxW);
    if (card.sub) ctx.textLight(card.sub, x + padX, y - 40, 6.5, C.subtle, maxW);
  });

  ctx.y -= rows * cardH + 6;
}

export function drawPortfolioSummaryRow(
  ctx: ReportRenderContext,
  label: string,
  leftText: string,
  rightText: string,
  rightColor: RGB
) {
  const padX = 10;
  const fontSize = 8.5;
  const baseH = 20;
  const leftX = ctx.ML + padX + 36;
  const rightEdge = ctx.ML + ctx.BODY_W - padX;
  const leftW = ctx.font.widthOfTextAtSize(leftText, fontSize);
  const rightW = ctx.font.widthOfTextAtSize(rightText, fontSize);
  const needsWrap = leftX + leftW + 16 > rightEdge - rightW;
  const rowH = needsWrap ? 32 : baseH;

  ctx.ensureSpace(rowH + 4);
  ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, C.rule, 0.5);
  ctx.line(ctx.ML, ctx.y - rowH, ctx.ML + ctx.BODY_W, ctx.y - rowH, C.rule, 0.25);

  const lY = vCenterTopY(ctx.y, rowH, fontSize);
  ctx.textBold(label, ctx.ML + padX, needsWrap ? ctx.y - 10 : lY, fontSize, C.ink);

  if (needsWrap) {
    ctx.text(leftText, leftX, ctx.y - 10, fontSize, C.ink);
    ctx.textRight(rightText, rightEdge, ctx.y - 22, fontSize, rightColor);
  } else {
    ctx.text(leftText, leftX, lY, fontSize, C.ink);
    ctx.textRight(rightText, rightEdge, lY, fontSize, rightColor);
  }

  ctx.y -= rowH + 4;
}

export function drawTable(
  ctx: ReportRenderContext,
  cols: ColDef[],
  rows: string[][],
  rowColors?: (RGB | null)[]
) {
  const { ML } = ctx;
  const fontSize = 8;
  const fittedCols = fitColumnsToWidth(cols, ctx.BODY_W);
  const totalW = fittedCols.reduce((s, c) => s + c.width, 0);
  const hTextY = vCenterTopY(ctx.y, HEADER_H, fontSize);

  ctx.ensureSpace(HEADER_H + ROW_H * 2);
  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.rule, 0.75);
  let hx = ML;
  for (const col of fittedCols) {
    const title = truncate(col.header, 18);
    if (col.align === "right") {
      ctx.textRightBold(title, hx + col.width - CELL_PAD, hTextY, fontSize, C.ink);
    } else if (col.align === "center") {
      ctx.textCenterBold(title, hx + col.width / 2, hTextY, fontSize, C.ink);
    } else {
      ctx.textBold(title, hx + CELL_PAD, hTextY, fontSize, C.ink);
    }
    hx += col.width;
  }
  ctx.line(ML, ctx.y - HEADER_H, ML + totalW, ctx.y - HEADER_H, C.rule, 0.5);
  ctx.y -= HEADER_H;

  rows.forEach((row, rowIndex) => {
    ctx.ensureSpace(ROW_H + 4);
    const rowTextY = vCenterTopY(ctx.y, ROW_H, fontSize);
    let rx = ML;
    row.forEach((cell, cellIndex) => {
      const col = fittedCols[cellIndex];
      if (!col) return;
      const cellColor = rowColors?.[rowIndex] ?? C.ink;
      const maxCellW = col.width - CELL_PAD * 2;
      const value = ellipsizeToWidth(cell, maxCellW, ctx.font, fontSize);
      if (col.align === "right") {
        ctx.textRight(value, rx + col.width - CELL_PAD, rowTextY, fontSize, cellColor);
      } else if (col.align === "center") {
        ctx.textCenter(value, rx + col.width / 2, rowTextY, fontSize, cellColor);
      } else {
        ctx.text(value, rx + CELL_PAD, rowTextY, fontSize, cellColor, maxCellW);
      }
      rx += col.width;
    });

    ctx.line(ML, ctx.y - ROW_H, ML + totalW, ctx.y - ROW_H, C.rule, 0.25);
    ctx.y -= ROW_H;
  });

  ctx.line(ML, ctx.y, ML + totalW, ctx.y, C.rule, 0.75);
  ctx.y -= 5;
}

export function drawCommentBlock(
  ctx: ReportRenderContext,
  title: string,
  body: string,
  color: RGB,
  font: PDFFont,
  wrapText: (text: string, maxWidth: number, font: PDFFont, size: number) => string[],
  showTopRule = true
) {
  const fontSize = 8.5;
  const titleFontSize = 9;
  const lh = Math.round(fontSize * 1.45);
  const maxW = ctx.BODY_W;
  const bodyLines = wrapText(body, maxW, font, fontSize);
  const blockH = 9 + titleFontSize + 5 + bodyLines.length * lh + 9;

  ctx.ensureSpace(blockH + 5);

  const bx = ctx.ML;
  const by = ctx.y;
  if (showTopRule) ctx.line(bx, by, bx + ctx.BODY_W, by, C.rule, 0.25);

  ctx.textBold(title, bx, by - 9, titleFontSize, color, maxW);
  bodyLines.forEach((line, index) => {
    ctx.text(line, bx, by - 9 - titleFontSize - 5 - index * lh, fontSize, C.ink, maxW);
  });

  ctx.y -= blockH + 5;
}