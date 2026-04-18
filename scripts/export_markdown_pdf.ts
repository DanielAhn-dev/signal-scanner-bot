import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { loadFontBytes, wrapText } from "../src/services/weeklyReportPdfCore";

type CliOptions = {
  input: string;
  output: string;
  title: string;
  check: boolean;
};

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; lines: string[] }
  | { type: "divider" };

type TocEntry = {
  level: 1 | 2 | 3;
  text: string;
  page: number;
};

type Fonts = {
  light: PDFFont;
  regular: PDFFont;
  bold: PDFFont;
};

const PAGE = {
  width: 595,
  height: 842,
  marginLeft: 48,
  marginRight: 48,
  marginTop: 48,
  marginBottom: 54,
} as const;

const COLORS = {
  text: rgb(0.12, 0.12, 0.14),
  muted: rgb(0.42, 0.42, 0.46),
  border: rgb(0.84, 0.84, 0.88),
  surface: rgb(0.96, 0.96, 0.97),
  accent: rgb(0.08, 0.22, 0.40),
  accentSoft: rgb(0.90, 0.94, 0.98),
  quote: rgb(0.94, 0.95, 0.97),
  code: rgb(0.95, 0.95, 0.96),
  white: rgb(1, 1, 1),
} as const;

class Cursor {
  pageNum = 0;
  y = 0;

  constructor(private readonly onNewPage: () => void) {}

  newPage() {
    this.pageNum += 1;
    this.y = PAGE.height - PAGE.marginTop;
    this.onNewPage();
  }

  ensure(height: number) {
    if (this.pageNum === 0 || this.y - height < PAGE.marginBottom) {
      this.newPage();
    }
  }

  move(delta: number) {
    this.y -= delta;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = { check: false };
  const readValue = (startIndex: number): { value: string; nextIndex: number } => {
    const parts: string[] = [];
    let nextIndex = startIndex;
    while (nextIndex < argv.length && !argv[nextIndex].startsWith("--")) {
      parts.push(argv[nextIndex]);
      nextIndex += 1;
    }
    return { value: parts.join(" ").trim(), nextIndex };
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      const { value, nextIndex } = readValue(index + 1);
      if (value) options.input = value;
      index = nextIndex - 1;
      continue;
    }
    if (token === "--output") {
      const { value, nextIndex } = readValue(index + 1);
      if (value) options.output = value;
      index = nextIndex - 1;
      continue;
    }
    if (token === "--title") {
      const { value, nextIndex } = readValue(index + 1);
      if (value) options.title = value;
      index = nextIndex - 1;
      continue;
    }
    if (token === "--check") {
      options.check = true;
    }
  }

  if (!options.input || !options.output) {
    throw new Error("사용법: tsx scripts/export_markdown_pdf.ts --input <markdown> --output <pdf> [--title <title>]");
  }

  return {
    input: options.input,
    output: options.output,
    title: options.title ?? "운영 가이드",
    check: Boolean(options.check),
  };
}

function parseStableDateFromMarkdown(markdown: string): { label: string; date: Date } {
  const lineMatch = markdown.match(/^\s*-\s*기준일:\s*(.+)$/m);
  const label = lineMatch?.[1]?.trim();

  if (label) {
    const dateMatch = label.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (dateMatch) {
      const year = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const day = Number(dateMatch[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      if (!Number.isNaN(parsed.getTime())) {
        return { label, date: parsed };
      }
    }
  }

  return {
    label: "2026-01-01",
    date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  };
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: stripInlineMarkdown(headingMatch[2]) });
      index += 1;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(stripInlineMarkdown(lines[index].trim().replace(/^>\s?/, "")));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    if (line.trim().startsWith("```")) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", lines: codeLines });
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(stripInlineMarkdown(lines[index].trim().replace(/^[-*]\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(stripInlineMarkdown(lines[index].trim().replace(/^\d+\.\s+/, "")));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextLine = lines[index].trimEnd();
      const trimmed = nextLine.trim();
      if (!trimmed) break;
      if (/^(#{1,3})\s+/.test(trimmed)) break;
      if (/^---+$/.test(trimmed)) break;
      if (trimmed.startsWith(">")) break;
      if (trimmed.startsWith("```") || /^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) break;
      paragraphLines.push(stripInlineMarkdown(trimmed));
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function lineHeight(fontSize: number, ratio = 1.45): number {
  return Math.round(fontSize * ratio);
}

function drawWrappedText(args: {
  text: string;
  x: number;
  y: number;
  font: PDFFont;
  fontSize: number;
  color: RGB;
  maxWidth: number;
  page: ReturnType<PDFDocument["addPage"]>;
}) {
  const lines = wrapText(args.text, args.maxWidth, args.font, args.fontSize);
  const lh = lineHeight(args.fontSize);
  for (let index = 0; index < lines.length; index += 1) {
    args.page.drawText(lines[index], {
      x: args.x,
      y: args.y - args.fontSize * 0.8 - index * lh,
      size: args.fontSize,
      font: args.font,
      color: args.color,
    });
  }
  return { lines, height: lines.length * lh };
}

function headingMetrics(level: 1 | 2 | 3) {
  if (level === 1) return { size: 20, before: 18, after: 14 };
  if (level === 2) return { size: 15, before: 16, after: 10 };
  return { size: 12, before: 12, after: 8 };
}

function blockHeight(block: Block, fonts: Fonts): number {
  const bodyWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight;
  if (block.type === "divider") return 18;
  if (block.type === "heading") {
    const metrics = headingMetrics(block.level);
    const lines = wrapText(block.text, bodyWidth, fonts.bold, metrics.size);
    return metrics.before + lines.length * lineHeight(metrics.size, 1.25) + metrics.after;
  }
  if (block.type === "paragraph") {
    const lines = wrapText(block.text, bodyWidth, fonts.regular, 10.5);
    return lines.length * lineHeight(10.5) + 10;
  }
  if (block.type === "blockquote") {
    const lines = wrapText(block.text, bodyWidth - 28, fonts.regular, 10.5);
    return lines.length * lineHeight(10.5) + 18;
  }
  if (block.type === "code") {
    const total = Math.max(1, block.lines.length) * lineHeight(9.5, 1.35);
    return total + 18;
  }
  const markerWidth = 24;
  let totalHeight = 4;
  for (const item of block.items) {
    const lines = wrapText(item, bodyWidth - markerWidth, fonts.regular, 10.5);
    totalHeight += lines.length * lineHeight(10.5) + 4;
  }
  return totalHeight + 6;
}

function createPage(pdf: PDFDocument, docTitle: string, dateLabel: string, fonts: Fonts, pageNumber: number) {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 0, y: PAGE.height - 36, width: PAGE.width, height: 36, color: COLORS.accent });
  page.drawText(docTitle, {
    x: PAGE.marginLeft,
    y: PAGE.height - 24,
    size: 11,
    font: fonts.bold,
    color: COLORS.white,
  });
  page.drawText(dateLabel, {
    x: PAGE.width - PAGE.marginRight - fonts.light.widthOfTextAtSize(dateLabel, 9),
    y: PAGE.height - 22,
    size: 9,
    font: fonts.light,
    color: COLORS.white,
  });
  page.drawLine({
    start: { x: PAGE.marginLeft, y: PAGE.marginBottom - 10 },
    end: { x: PAGE.width - PAGE.marginRight, y: PAGE.marginBottom - 10 },
    thickness: 0.6,
    color: COLORS.border,
  });
  const pageLabel = String(pageNumber);
  page.drawText(pageLabel, {
    x: PAGE.width - PAGE.marginRight - fonts.regular.widthOfTextAtSize(pageLabel, 9),
    y: PAGE.marginBottom - 28,
    size: 9,
    font: fonts.regular,
    color: COLORS.muted,
  });
  return page;
}

function renderCover(pdf: PDFDocument, fonts: Fonts, title: string, sourcePath: string, generatedAt: string) {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: COLORS.surface });
  page.drawRectangle({ x: 0, y: PAGE.height - 220, width: PAGE.width, height: 220, color: COLORS.accent });
  page.drawText("OPERATING GUIDE", {
    x: PAGE.marginLeft,
    y: PAGE.height - 90,
    size: 13,
    font: fonts.light,
    color: COLORS.white,
  });
  const titleLines = wrapText(title, PAGE.width - PAGE.marginLeft - PAGE.marginRight, fonts.bold, 26);
  for (let index = 0; index < titleLines.length; index += 1) {
    page.drawText(titleLines[index], {
      x: PAGE.marginLeft,
      y: PAGE.height - 130 - index * 36,
      size: 26,
      font: fonts.bold,
      color: COLORS.white,
    });
  }
  const infoY = PAGE.height - 300;
  page.drawText("이 PDF는 docs 기반 운영 문서를 그대로 내보낸 결과물입니다.", {
    x: PAGE.marginLeft,
    y: infoY,
    size: 11,
    font: fonts.regular,
    color: COLORS.text,
  });
  page.drawText(`원본 문서: ${sourcePath.replace(/\\/g, "/")}`, {
    x: PAGE.marginLeft,
    y: infoY - 30,
    size: 10,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page.drawText(`생성 시각: ${generatedAt}`, {
    x: PAGE.marginLeft,
    y: infoY - 52,
    size: 10,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page.drawText("빠른 시작", {
    x: PAGE.marginLeft,
    y: infoY - 112,
    size: 16,
    font: fonts.bold,
    color: COLORS.text,
  });
  const quickStart = [
    "1. 장 시작 전에는 /경제, /시장, /브리핑 순서로 먼저 본다.",
    "2. 후보는 /스캔 또는 /눌림목으로 3~5개만 추린다.",
    "3. 진입 전에는 /종목분석, /재무, /수급을 함께 확인한다.",
    "4. 장 마감 후에는 /보유, /관심, /리포트로 복기한다.",
  ];
  let y = infoY - 146;
  for (const item of quickStart) {
    page.drawCircle({ x: PAGE.marginLeft + 4, y: y + 5, size: 2.4, color: COLORS.accent });
    const wrapped = drawWrappedText({
      text: item,
      x: PAGE.marginLeft + 14,
      y,
      font: fonts.regular,
      fontSize: 11,
      color: COLORS.text,
      maxWidth: PAGE.width - PAGE.marginLeft - PAGE.marginRight - 14,
      page,
    });
    y -= wrapped.height + 8;
  }
}

function estimateTocPages(entries: TocEntry[], fonts: Fonts): number {
  const bodyWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight - 60;
  let y = PAGE.height - PAGE.marginTop - 62;
  let pages = 1;
  for (const entry of entries) {
    const fontSize = entry.level === 1 ? 11 : entry.level === 2 ? 10 : 9.5;
    const lines = wrapText(entry.text, bodyWidth - entry.level * 12, fonts.regular, fontSize);
    const needed = lines.length * lineHeight(fontSize, 1.3) + 6;
    if (y - needed < PAGE.marginBottom) {
      pages += 1;
      y = PAGE.height - PAGE.marginTop - 62;
    }
    y -= needed;
  }
  return pages;
}

function collectTocEntries(blocks: Block[], fonts: Fonts, initialPageOffset: number): TocEntry[] {
  const cursor = new Cursor(() => undefined);
  const entries: TocEntry[] = [];

  for (const block of blocks) {
    const estimated = blockHeight(block, fonts);
    cursor.ensure(estimated);
    if (block.type === "heading") {
      entries.push({ level: block.level, text: block.text, page: initialPageOffset + cursor.pageNum });
    }
    cursor.move(estimated);
  }

  return entries;
}

function renderToc(pdf: PDFDocument, fonts: Fonts, title: string, dateLabel: string, entries: TocEntry[], startPageNumber: number) {
  let pageNumber = startPageNumber;
  let page = createPage(pdf, title, dateLabel, fonts, pageNumber);
  let y = PAGE.height - PAGE.marginTop - 10;

  page.drawText("목차", {
    x: PAGE.marginLeft,
    y: y - 16,
    size: 18,
    font: fonts.bold,
    color: COLORS.text,
  });
  y -= 48;

  for (const entry of entries) {
    const fontSize = entry.level === 1 ? 11 : entry.level === 2 ? 10 : 9.5;
    const indent = entry.level === 1 ? 0 : entry.level === 2 ? 16 : 30;
    const maxWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight - 70 - indent;
    const lines = wrapText(entry.text, maxWidth, fonts.regular, fontSize);
    const needed = lines.length * lineHeight(fontSize, 1.3) + 8;

    if (y - needed < PAGE.marginBottom) {
      pageNumber += 1;
      page = createPage(pdf, title, dateLabel, fonts, pageNumber);
      y = PAGE.height - PAGE.marginTop - 10;
      page.drawText("목차", {
        x: PAGE.marginLeft,
        y: y - 16,
        size: 18,
        font: fonts.bold,
        color: COLORS.text,
      });
      y -= 48;
    }

    const wrapped = drawWrappedText({
      text: entry.text,
      x: PAGE.marginLeft + indent,
      y,
      font: entry.level === 1 ? fonts.bold : fonts.regular,
      fontSize,
      color: COLORS.text,
      maxWidth,
      page,
    });
    const pageLabel = String(entry.page);
    page.drawText(pageLabel, {
      x: PAGE.width - PAGE.marginRight - fonts.regular.widthOfTextAtSize(pageLabel, fontSize),
      y: y - fontSize * 0.8,
      size: fontSize,
      font: fonts.regular,
      color: COLORS.muted,
    });
    page.drawLine({
      start: { x: PAGE.marginLeft + indent, y: y - wrapped.height + 4 },
      end: { x: PAGE.width - PAGE.marginRight, y: y - wrapped.height + 4 },
      thickness: 0.4,
      color: COLORS.border,
      dashArray: [2, 2],
    });
    y -= wrapped.height + 8;
  }
}

function renderBlocks(pdf: PDFDocument, fonts: Fonts, title: string, dateLabel: string, blocks: Block[], startPageNumber: number) {
  const bodyWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight;
  let pageNumber = startPageNumber - 1;
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  pdf.removePage(pdf.getPageCount() - 1);
  const cursor = new Cursor(() => {
    pageNumber += 1;
    page = createPage(pdf, title, dateLabel, fonts, pageNumber);
  });

  for (const block of blocks) {
    const estimated = blockHeight(block, fonts);
    cursor.ensure(estimated);

    if (block.type === "divider") {
      page.drawLine({
        start: { x: PAGE.marginLeft, y: cursor.y - 4 },
        end: { x: PAGE.width - PAGE.marginRight, y: cursor.y - 4 },
        thickness: 0.6,
        color: COLORS.border,
      });
      cursor.move(18);
      continue;
    }

    if (block.type === "heading") {
      const metrics = headingMetrics(block.level);
      cursor.move(metrics.before);
      const wrapped = drawWrappedText({
        text: block.text,
        x: PAGE.marginLeft,
        y: cursor.y,
        font: fonts.bold,
        fontSize: metrics.size,
        color: COLORS.text,
        maxWidth: bodyWidth,
        page,
      });
      if (block.level <= 2) {
        page.drawRectangle({
          x: PAGE.marginLeft,
          y: cursor.y - wrapped.height - 8,
          width: block.level === 1 ? bodyWidth : 120,
          height: 2,
          color: COLORS.accentSoft,
        });
      }
      cursor.move(wrapped.height + metrics.after);
      continue;
    }

    if (block.type === "paragraph") {
      const wrapped = drawWrappedText({
        text: block.text,
        x: PAGE.marginLeft,
        y: cursor.y,
        font: fonts.regular,
        fontSize: 10.5,
        color: COLORS.text,
        maxWidth: bodyWidth,
        page,
      });
      cursor.move(wrapped.height + 10);
      continue;
    }

    if (block.type === "blockquote") {
      const height = blockHeight(block, fonts) - 8;
      page.drawRectangle({
        x: PAGE.marginLeft,
        y: cursor.y - height + 4,
        width: bodyWidth,
        height,
        color: COLORS.quote,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });
      page.drawRectangle({ x: PAGE.marginLeft, y: cursor.y - height + 4, width: 4, height, color: COLORS.accent });
      const wrapped = drawWrappedText({
        text: block.text,
        x: PAGE.marginLeft + 14,
        y: cursor.y - 4,
        font: fonts.regular,
        fontSize: 10.5,
        color: COLORS.text,
        maxWidth: bodyWidth - 24,
        page,
      });
      cursor.move(wrapped.height + 18);
      continue;
    }

    if (block.type === "code") {
      const innerHeight = Math.max(1, block.lines.length) * lineHeight(9.5, 1.35);
      page.drawRectangle({
        x: PAGE.marginLeft,
        y: cursor.y - innerHeight - 10,
        width: bodyWidth,
        height: innerHeight + 14,
        color: COLORS.code,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });
      let lineY = cursor.y - 4;
      for (const line of block.lines) {
        page.drawText(line || " ", {
          x: PAGE.marginLeft + 10,
          y: lineY - 9,
          size: 9.5,
          font: fonts.regular,
          color: COLORS.text,
        });
        lineY -= lineHeight(9.5, 1.35);
      }
      cursor.move(innerHeight + 18);
      continue;
    }

    const markerWidth = 24;
    for (let itemIndex = 0; itemIndex < block.items.length; itemIndex += 1) {
      const item = block.items[itemIndex];
      const marker = block.ordered ? `${itemIndex + 1}.` : "•";
      const fontSize = 10.5;
      page.drawText(marker, {
        x: PAGE.marginLeft,
        y: cursor.y - fontSize * 0.8,
        size: fontSize,
        font: block.ordered ? fonts.bold : fonts.regular,
        color: COLORS.text,
      });
      const wrapped = drawWrappedText({
        text: item,
        x: PAGE.marginLeft + markerWidth,
        y: cursor.y,
        font: fonts.regular,
        fontSize,
        color: COLORS.text,
        maxWidth: bodyWidth - markerWidth,
        page,
      });
      cursor.move(wrapped.height + 4);
    }
    cursor.move(6);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), options.input);
  const outputPath = path.resolve(process.cwd(), options.output);
  const markdown = await readFile(inputPath, "utf8");
  const blocks = parseMarkdown(markdown);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const fonts: Fonts = {
    light: await pdf.embedFont(fontBytes.light),
    regular: await pdf.embedFont(fontBytes.regular),
    bold: await pdf.embedFont(fontBytes.bold),
  };

  const stable = parseStableDateFromMarkdown(markdown);
  const generatedAt = stable.label;
  const dateLabel = `기준일 ${generatedAt}`;
  pdf.setTitle(options.title);
  pdf.setSubject("Signal Scanner Bot 운영 가이드 PDF");
  pdf.setCreator("signal-scanner-bot docs exporter");
  pdf.setProducer("signal-scanner-bot docs exporter");
  pdf.setCreationDate(stable.date);
  pdf.setModificationDate(stable.date);

  const provisionalEntries = collectTocEntries(blocks, fonts, 1);
  const tocPages = estimateTocPages(provisionalEntries, fonts);
  const entries = collectTocEntries(blocks, fonts, 1 + tocPages);

  renderCover(pdf, fonts, options.title, path.relative(process.cwd(), inputPath), generatedAt);
  renderToc(pdf, fonts, options.title, dateLabel, entries, 2);
  renderBlocks(pdf, fonts, options.title, dateLabel, blocks, 2 + tocPages);

  const nextBytes = await pdf.save();

  if (options.check) {
    let currentBytes: Uint8Array;
    try {
      currentBytes = await readFile(outputPath);
    } catch {
      throw new Error(`체크 실패: 출력 파일이 없습니다 (${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")})`);
    }

    const current = Buffer.from(currentBytes);
    const next = Buffer.from(nextBytes);
    if (current.length !== next.length || !current.equals(next)) {
      throw new Error([
        "체크 실패: 운영 가이드 PDF가 최신이 아닙니다.",
        "`pnpm docs:guide:pdf`를 실행해 PDF를 갱신하고 커밋하세요.",
      ].join(" "));
    }

    console.log(`[docs:pdf] up-to-date ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, nextBytes);
  console.log(`[docs:pdf] created ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error("[docs:pdf] failed", error);
  process.exitCode = 1;
});