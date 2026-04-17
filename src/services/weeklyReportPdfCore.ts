import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFPage, PDFFont, type RGB } from "pdf-lib";
import { C, type ReportTheme } from "./weeklyReportShared";
import { drawFooter, drawPageTitle } from "./weeklyReportLayout";

export async function loadFontBytes(): Promise<{ light: Uint8Array; regular: Uint8Array; bold: Uint8Array }> {
  const base = path.join(process.cwd(), "assets", "fonts");
  const lightPath = path.join(base, "Pretendard-Light.ttf");
  const regularPath = path.join(base, "Pretendard-Regular.ttf");
  const boldPath = path.join(base, "Pretendard-Bold.ttf");
  const fallback = path.join(base, "NotoSansCJKkr-Regular.otf");

  async function tryLoad(...paths: string[]): Promise<Uint8Array> {
    for (const filePath of paths) {
      try {
        return await readFile(filePath);
      } catch {
        // try next font path
      }
    }
    throw new Error(`[PDF] 폰트 파일을 찾을 수 없습니다. 확인 경로: ${paths.join(", ")}`);
  }

  const regular = await tryLoad(regularPath, fallback);
  const bold = await tryLoad(boldPath, regularPath, fallback);
  const light = await tryLoad(lightPath, regularPath, fallback);
  return { light, regular, bold };
}

/** @deprecated use loadFontBytes */
export async function loadKoreanFontBytes(): Promise<Uint8Array> {
  return (await loadFontBytes()).regular;
}

export function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  if (!text) return [""];
  const normalized = text.normalize("NFC");
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
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export class ReportContext {
  pdf: PDFDocument;
  page!: PDFPage;
  fontLight: PDFFont;
  font: PDFFont;
  fontBold: PDFFont;
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
    this.pdf = pdf;
    this.fontLight = fontLight;
    this.font = font;
    this.fontBold = fontBold;
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

  ensureSpace(height: number, buffer = 8) {
    if (this.y < this.MB + height + buffer) this.addPage();
  }

  finalizePage() {
    if (!this.page || this.pageFinalized || !this.footerLabel) return;
    drawFooter(this, this.footerLabel);
    this.pageFinalized = true;
  }

  private lh(size: number): number {
    return Math.round(size * 1.45);
  }

  text(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.font, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.8 - i * lh, size, font: this.font, color });
    }
    return lines.length;
  }

  textBold(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.fontBold, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.8 - i * lh, size, font: this.fontBold, color });
    }
    return lines.length;
  }

  textLight(s: string, x: number, y: number, size: number, color: RGB = C.ink, maxW?: number): number {
    const lh = this.lh(size);
    const lines = wrapText(s, maxW ?? this.BODY_W, this.fontLight, size);
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x, y: y - size * 0.8 - i * lh, size, font: this.fontLight, color });
    }
    return lines.length;
  }

  textRight(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const width = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - width, y: y - size * 0.8, size, font: this.font, color });
  }

  textRightBold(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const width = this.fontBold.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - width, y: y - size * 0.8, size, font: this.fontBold, color });
  }

  textRightLight(s: string, rightEdge: number, y: number, size: number, color: RGB = C.ink) {
    const width = this.fontLight.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: rightEdge - width, y: y - size * 0.8, size, font: this.fontLight, color });
  }

  textCenter(s: string, cx: number, y: number, size: number, color: RGB = C.ink) {
    const width = this.font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: cx - width / 2, y: y - size * 0.8, size, font: this.font, color });
  }

  textCenterBold(s: string, cx: number, y: number, size: number, color: RGB = C.ink) {
    const width = this.fontBold.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: cx - width / 2, y: y - size * 0.8, size, font: this.fontBold, color });
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = C.rule, thickness = 0.5) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }
}