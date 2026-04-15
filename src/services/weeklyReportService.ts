import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchAllMarketData } from "../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";

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
  stock: {
    code: string;
    name: string;
    close: number | null;
  } | {
    code: string;
    name: string;
    close: number | null;
  }[] | null;
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

function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function summarizeWindow(rows: TradeRow[]): WindowSummary {
  const buys = rows.filter((r) => r.side === "BUY");
  const sells = rows.filter((r) => r.side === "SELL");
  const realized = sells.reduce((acc, r) => acc + toNum(r.pnl_amount), 0);
  const winCount = sells.filter((r) => toNum(r.pnl_amount) > 0).length;
  const winRate = sells.length ? (winCount / sells.length) * 100 : 0;

  return {
    buyCount: buys.length,
    sellCount: sells.length,
    tradeCount: rows.length,
    realizedPnl: realized,
    winRate,
  };
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

  const current14 = rows.filter((r) => {
    const t = new Date(r.traded_at).getTime();
    return t >= currStart;
  });

  const prev14 = rows.filter((r) => {
    const t = new Date(r.traded_at).getTime();
    return t >= prevStart && t < currStart;
  });

  const recent = rows.slice(0, 8);

  return { current14, prev14, recent };
}

function lineDate(raw: string): string {
  const d = new Date(raw);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

async function loadKoreanFontBytes(): Promise<Uint8Array> {
  const fontPath = path.join(process.cwd(), "assets", "fonts", "NotoSansCJKkr-Regular.otf");
  return readFile(fontPath);
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function createWeeklyReportPdf(
  supabase: SupabaseClient,
  options: { chatId: number }
): Promise<WeeklyPdfReport> {
  const chatId = options.chatId;
  const now = new Date();
  const kstNow = asKstDate(now);
  const ymd = toYmd(kstNow);

  const tradeSince = shiftDays(now, -28).toISOString();
  const { data: tradeRows, error: tradeErr } = await supabase
    .from("virtual_trades")
    .select("side, code, price, quantity, pnl_amount, traded_at")
    .eq("chat_id", chatId)
    .gte("traded_at", tradeSince)
    .order("traded_at", { ascending: false })
    .limit(300)
    .returns<TradeRow[]>();

  if (tradeErr) {
    throw new Error(`virtual_trades 조회 실패: ${tradeErr.message}`);
  }

  const { data: watchRows, error: watchErr } = await supabase
    .from("watchlist")
    .select("code, buy_price, quantity, invested_amount, status, stock:stocks(code,name,close)")
    .eq("chat_id", chatId)
    .returns<WatchlistRow[]>();

  if (watchErr) {
    throw new Error(`watchlist 조회 실패: ${watchErr.message}`);
  }

  const { data: sectorRows } = await supabase
    .from("sectors")
    .select("name, score, change_rate")
    .order("score", { ascending: false })
    .limit(3)
    .returns<SectorRow[]>();

  const market = await fetchAllMarketData().catch(() => ({} as any));

  const rows = tradeRows ?? [];
  const windows = splitWindows(rows, now);
  const curr = summarizeWindow(windows.current14);
  const prev = summarizeWindow(windows.prev14);

  const codes = (watchRows ?? []).map((r) => r.code);
  const realtimeMap = codes.length
    ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>))
    : {};

  const watchItems: WatchItem[] = (watchRows ?? [])
    .map((row) => {
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
    })
    .sort((a, b) => Math.abs(b.unrealized) - Math.abs(a.unrealized));

  const totalInvested = watchItems.reduce((acc, item) => acc + item.invested, 0);
  const totalValue = watchItems.reduce((acc, item) => acc + item.value, 0);
  const totalUnrealized = totalValue - totalInvested;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadKoreanFontBytes();
  const regular = await pdf.embedFont(fontBytes, { subset: true });

  let page = pdf.addPage([595, 842]);
  const margin = 42;
  const usableWidth = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;

  const ensureSpace = (required = 20) => {
    if (y < margin + required) {
      page = pdf.addPage([595, 842]);
      y = page.getHeight() - margin;
    }
  };

  const draw = (text: string, size = 11, color = rgb(0.12, 0.12, 0.12), gap = 16) => {
    const lines = wrapText(text, usableWidth, regular, size);
    for (const line of lines) {
      ensureSpace(gap);
      page.drawText(line, { x: margin, y, size, font: regular, color });
      y -= gap;
    }
  };

  draw(`Signal Scanner 주간 리포트 (${ymd})`, 17, rgb(0.05, 0.05, 0.05), 22);
  draw("", 10, rgb(0, 0, 0), 8);

  draw("1) 브리핑 핵심", 13, rgb(0.1, 0.1, 0.1), 18);
  if (market.kospi) {
    draw(`- KOSPI ${fmtInt(toNum(market.kospi.price))} (${fmtPct(toNum(market.kospi.changeRate))})`);
  }
  if (market.kosdaq) {
    draw(`- KOSDAQ ${fmtInt(toNum(market.kosdaq.price))} (${fmtPct(toNum(market.kosdaq.changeRate))})`);
  }
  if (market.usdkrw) {
    draw(`- 환율 ${fmtInt(toNum(market.usdkrw.price))}원 (${fmtPct(toNum(market.usdkrw.changeRate))})`);
  }
  if (market.vix) {
    draw(`- VIX ${toNum(market.vix.price).toFixed(1)}`);
  }
  if ((sectorRows ?? []).length > 0) {
    draw("- 주도 섹터 Top 3");
    (sectorRows ?? []).forEach((s, idx) => {
      draw(`  ${idx + 1}. ${s.name} | 점수 ${toNum(s.score).toFixed(1)} | 수익률 ${fmtPct(toNum(s.change_rate))}`);
    });
  }

  draw("", 10, rgb(0, 0, 0), 8);
  draw("2) 매매 기록 요약 (최근 2주)", 13, rgb(0.1, 0.1, 0.1), 18);
  draw(`- 거래 ${curr.tradeCount}건 (매수 ${curr.buyCount} / 매도 ${curr.sellCount})`);
  draw(`- 실현손익 ${fmtSignedInt(curr.realizedPnl)} | 승률 ${curr.winRate.toFixed(1)}%`);
  draw(`- 이전 2주 대비 거래 ${curr.tradeCount - prev.tradeCount >= 0 ? "+" : ""}${curr.tradeCount - prev.tradeCount}건`);
  draw(`- 이전 2주 대비 승률 ${fmtPct(curr.winRate - prev.winRate)} | 실현손익 ${fmtSignedInt(curr.realizedPnl - prev.realizedPnl)}`);

  if (windows.recent.length > 0) {
    draw("- 최근 거래");
    windows.recent.forEach((r) => {
      const qty = Math.max(0, Math.floor(toNum(r.quantity)));
      const px = fmtInt(toNum(r.price));
      const pnl = r.side === "SELL" ? ` | 손익 ${fmtSignedInt(toNum(r.pnl_amount))}` : "";
      draw(`  · ${lineDate(r.traded_at)} ${r.side} ${r.code} ${qty}주 @ ${px}원${pnl}`);
    });
  } else {
    draw("- 최근 2주 거래 기록이 없습니다.");
  }

  draw("", 10, rgb(0, 0, 0), 8);
  draw("3) 현재 관심종목 상세", 13, rgb(0.1, 0.1, 0.1), 18);
  draw(`- 보유 평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`);
  draw(`- 원금 ${fmtInt(totalInvested)}원 | 평가액 ${fmtInt(totalValue)}원 | 종목수 ${watchItems.length}개`);

  if (watchItems.length > 0) {
    watchItems.slice(0, 14).forEach((item) => {
      const current = item.currentPrice ? fmtInt(item.currentPrice) : "-";
      const buy = item.buyPrice ? fmtInt(item.buyPrice) : "-";
      const pct = item.pnlPct != null ? fmtPct(item.pnlPct) : "-";
      draw(`- ${item.name}(${item.code}) ${item.qty}주 | 평단 ${buy}원 | 현재 ${current}원 | 평가 ${pct}`);
    });
  } else {
    draw("- 등록된 관심종목이 없습니다.");
  }

  draw("", 10, rgb(0, 0, 0), 8);
  draw("4) 2주 변화 코멘트", 13, rgb(0.1, 0.1, 0.1), 18);
  const momentum = curr.tradeCount > prev.tradeCount ? "거래 활동이 늘어났습니다." : "거래 활동이 안정적이거나 감소했습니다.";
  const riskNote = totalUnrealized < 0 ? "평가손익이 음수인 종목의 비중 점검이 필요합니다." : "평가손익 흐름은 양호합니다.";
  draw(`- ${momentum}`);
  draw(`- ${riskNote}`);
  draw("- 인쇄용 기준으로 최근 2주 데이터에 집중해 구성했습니다.");

  const bytes = await pdf.save();
  const caption = [
    "주간 PDF 리포트를 전달드립니다.",
    `기준일: ${ymd}`,
    `거래 ${curr.tradeCount}건 · 실현손익 ${fmtSignedInt(curr.realizedPnl)} · 보유평가 ${fmtSignedInt(totalUnrealized)}`,
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
