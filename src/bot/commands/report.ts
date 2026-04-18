import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";
import { summarizeWindow, type TradeRow } from "../../services/weeklyReportData";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  fetchWatchMicroSignalsByCodes,
  resolveWatchDecision,
} from "../../lib/watchlistSignals";
import { ACTIONS, actionButtons } from "../messages/layout";

const REPORT_TOPIC_GUIDE = [
  { command: "주간", aliases: ["주간", "종합", "전체", "full", "weekly"], description: "시장과 포트폴리오를 함께 보는 종합 PDF" },
  { command: "월간", aliases: ["월간", "monthly", "month"], description: "월별 성과 요약 텍스트" },
  { command: "포트폴리오", aliases: ["포트폴리오", "보유", "holdings", "portfolio"], description: "보유 종목과 최근 거래 중심 PDF" },
  { command: "거시", aliases: ["거시", "경제", "매크로", "economy", "macro"], description: "금리·환율·변동성 중심 PDF" },
  { command: "수급", aliases: ["수급", "자금", "flow"], description: "외국인·기관 자금 흐름 PDF" },
  { command: "섹터", aliases: ["섹터", "업종", "테마", "sector"], description: "섹터 강도 랭킹 PDF" },
] as const;

function normalizeReportTopicInput(topicInput?: string | null): string | null {
  const token = String(topicInput ?? "").trim().toLowerCase();
  if (!token) return null;
  if (["menu", "메뉴", "선택", "list", "목록", "도움", "도움말", "help"].includes(token)) {
    return null;
  }

  const found = REPORT_TOPIC_GUIDE.find((item) => item.aliases.some((alias) => alias === token));
  return found?.command ?? "";
}

function buildReportMenuText(): string {
  return [
    "가능한 리포트 종류입니다.",
    "/리포트 는 이 메뉴를 다시 보여줍니다.",
    "/리포트 주간 — 시장 + 포트폴리오 종합 PDF",
    "/리포트 월간 — 월별 성과 요약 텍스트",
    "/리포트 포트폴리오 — 보유 종목/거래 중심 PDF",
    "/리포트 거시 — 금리·환율·변동성 PDF",
    "/리포트 수급 — 외국인·기관 자금 흐름 PDF",
    "/리포트 섹터 — 섹터 강도 랭킹 PDF",
  ].join("\n");
}

function fmtInt(v: number): string {
  return Math.round(v || 0).toLocaleString("ko-KR");
}

function fmtSignedWon(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtInt(v)}원`;
}

function getKstMonthRange(now = new Date()): {
  label: string;
  startIso: string;
  endIso: string;
} {
  const offsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + offsetMs);
  const year = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth();
  const startUtcMs = Date.UTC(year, month, 1) - offsetMs;
  const endUtcMs = Date.UTC(year, month + 1, 1) - offsetMs;
  return {
    label: `${year}년 ${month + 1}월`,
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
  };
}

async function handleMonthlyReportCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "월간 성과 리포트를 집계 중입니다. 잠시만 기다려주세요...",
  });

  const startedAt = Date.now();

  try {
    const range = getKstMonthRange();

    const { data: tradeRows, error: tradeError } = await supabase
      .from("virtual_trades")
      .select("side, code, price, quantity, pnl_amount, traded_at, memo")
      .eq("chat_id", ctx.chatId)
      .gte("traded_at", range.startIso)
      .lt("traded_at", range.endIso)
      .order("traded_at", { ascending: false })
      .limit(2000)
      .returns<TradeRow[]>();

    if (tradeError) {
      throw new Error(`월간 거래 집계 실패: ${tradeError.message}`);
    }

    const summary = summarizeWindow(tradeRows ?? []);

    const { data: watchRows } = await supabase
      .from("watchlist")
      .select(
        `
        code, buy_price,
        stock:stocks!inner ( close, rsi14 )
      `
      )
      .eq("chat_id", ctx.chatId);

    const watchItems = (watchRows ?? []) as Array<{
      code: string;
      buy_price: number | null;
      stock:
        | { close: number | null; rsi14: number | null }
        | { close: number | null; rsi14: number | null }[]
        | null;
    }>;

    const watchCodes = watchItems.map((row) => String(row.code));
    const microByCode = watchCodes.length
      ? await fetchWatchMicroSignalsByCodes(supabase, watchCodes)
      : new Map();

    let stopLossViolationCount = 0;
    for (const row of watchItems) {
      const stock = Array.isArray(row.stock) ? row.stock[0] ?? null : row.stock;
      const close = Number(stock?.close ?? 0);
      const buyPrice = Number(row.buy_price ?? 0);
      if (close <= 0 || buyPrice <= 0) continue;

      const plan = buildInvestmentPlan({
        currentPrice: close,
        factors: { rsi14: stock?.rsi14 ?? undefined },
      });
      const decision = resolveWatchDecision({
        close,
        buyPrice,
        plan,
        microSignal: microByCode.get(String(row.code)),
      });

      if (decision.action === "STOP_LOSS" || decision.blockedStopLoss) {
        stopLossViolationCount += 1;
      }
    }

    const complianceBase = Math.max(1, watchItems.length);
    const ruleCompliancePct =
      stopLossViolationCount === 0
        ? 100
        : Math.max(
            0,
            ((complianceBase - stopLossViolationCount) / complianceBase) * 100
          );

    const payoffLine =
      summary.payoffRatio != null
        ? `손익비 ${summary.payoffRatio.toFixed(2)}:1 (평균 수익 +${summary.avgWinPct.toFixed(2)}% / 평균 손실 -${summary.avgLossPct.toFixed(2)}%)`
        : "손익비 집계 불가 (월간 매도 데이터 부족)";

    const msg = [
      `<b>${range.label} 월간 성과</b>`,
      "─────────────────",
      `거래 수: ${summary.tradeCount}건 (매수 ${summary.buyCount} / 매도 ${summary.sellCount})`,
      `승률(FIFO): ${summary.winRate.toFixed(1)}%`,
      `실현손익(FIFO): ${fmtSignedWon(summary.realizedPnl)}`,
      payoffLine,
      `최대 단일 손실: ${fmtSignedWon(summary.maxSingleLoss)}`,
      `규칙 준수율: ${ruleCompliancePct.toFixed(1)}% (손절 미이행 ${stopLossViolationCount}건)`,
      "",
      "참고: 규칙 준수율은 현재 보유 종목의 손절 조건 충족 여부 기준입니다.",
    ].join("\n");

    console.log("[report] monthly completed", {
      chatId: ctx.chatId,
      label: range.label,
      tradeCount: summary.tradeCount,
      elapsedMs: Date.now() - startedAt,
    });

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "HTML",
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
  } catch (e: any) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[report] monthly failed", {
      chatId: ctx.chatId,
      elapsedMs: Date.now() - startedAt,
      error: detail,
      raw: e,
    });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "월간 성과 리포트 생성에 실패했습니다.",
        `원인: ${detail}`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleReportMenu(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: buildReportMenuText(),
    reply_markup: actionButtons(ACTIONS.reportMenu, 2),
  });
}

export async function handleReportCommand(
  ctx: ChatContext,
  tgSend: any,
  topicInput?: string | null
): Promise<void> {
  const normalizedTopic = normalizeReportTopicInput(topicInput);

  if (normalizedTopic === null) {
    await handleReportMenu(ctx, tgSend);
    return;
  }

  if (!normalizedTopic) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "지원하지 않는 리포트 종류입니다.",
        "아래 메뉴에서 가능한 리포트를 선택하세요.",
        "",
        buildReportMenuText(),
      ].join("\n"),
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
    return;
  }

  if (normalizedTopic === "월간") {
    await handleMonthlyReportCommand(ctx, tgSend);
    return;
  }

  const progressLabel = `${normalizedTopic} 리포트`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${progressLabel} PDF 생성 중입니다. 잠시만 기다려주세요...`,
  });

  const startedAt = Date.now();

  try {
    const report = await createWeeklyReportPdf(supabase, {
      chatId: ctx.chatId,
      topic: normalizedTopic,
    });

    console.log("[report] pdf created", {
      chatId: ctx.chatId,
      fileName: report.fileName,
      byteLength: report.bytes.byteLength,
      elapsedMs: Date.now() - startedAt,
    });

    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", report.caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([report.bytes], { type: "application/pdf" }), report.fileName);

    const sendResult = await tgSend("sendDocument", form);

    if (!sendResult?.ok) {
      const sendError = sendResult?.description || "Telegram sendDocument failed";
      console.error("[report] sendDocument failed", {
        chatId: ctx.chatId,
        fileName: report.fileName,
        byteLength: report.bytes.byteLength,
        elapsedMs: Date.now() - startedAt,
        error: sendError,
      });
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          `${report.title} PDF 전송에 실패했습니다.`,
          `사유: ${sendError}`,
          "텍스트 요약으로 대체합니다.",
          "",
          report.summaryText,
        ].join("\n"),
      });
      return;
    }

    console.log("[report] completed", {
      chatId: ctx.chatId,
      fileName: report.fileName,
      elapsedMs: Date.now() - startedAt,
    });

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        report.summaryText,
        "",
        "다른 주제 리포트도 바로 생성할 수 있습니다.",
      ].join("\n"),
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
  } catch (e: any) {
    const detail = describeWeeklyReportFailure(e);
    console.error("[report] generation failed", {
      chatId: ctx.chatId,
      elapsedMs: Date.now() - startedAt,
      error: detail,
      raw: e,
    });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `${progressLabel} 생성에 실패했습니다.`,
        `원인: ${detail}`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}
