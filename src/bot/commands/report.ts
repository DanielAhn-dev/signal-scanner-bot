import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";
import { createDailyCandidatePlanningReportResult } from "../../services/marketInsightService";
import { summarizeWindow, type TradeRow } from "../../services/weeklyReportData";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  fetchWatchMicroSignalsByCodes,
  resolveWatchDecision,
} from "../../lib/watchlistSignals";
import { getDecisionReliabilitySummary } from "../../services/decisionLogService";
import { getUserInvestmentPrefs } from "../../services/userService";
import { ACTIONS, actionButtons } from "../messages/layout";

const REPORT_TOPIC_GUIDE = [
  { command: "주간", aliases: ["주간", "종합", "전체", "full", "weekly"], description: "시장과 포트폴리오를 함께 보는 종합 PDF" },
  { command: "월간", aliases: ["월간", "monthly", "month"], description: "월별 성과 요약 텍스트" },
  { command: "실전운용", aliases: ["실전운용", "실전", "운용", "플레이북", "playbook", "ops"], description: "월~금 자동매매 실전 체크리스트 텍스트" },
  { command: "추천", aliases: ["추천", "후보", "daily", "plan", "planning", "ideas"], description: "매일 대응할 투자 후보 텍스트 리포트" },
  { command: "가이드", aliases: ["가이드", "운영가이드", "guide", "guidepdf"], description: "운영 가이드 PDF" },
    { command: "자동매매", aliases: ["자동매매", "명령어", "command", "automate"], description: "자동매매 명령어 사용 가이드 PDF" },
  { command: "포트폴리오", aliases: ["포트폴리오", "보유", "holdings", "portfolio"], description: "보유 종목과 최근 거래 중심 PDF" },
  { command: "관심종목", aliases: ["관심종목", "관심", "watchonly", "watch"], description: "수익 추적 중인 관심 종목 목록 PDF" },
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
    "/리포트 실전운용 — 월~금 자동매매 실전 체크리스트 텍스트",
    "  전략 유지 여부, 보유 추가매수, 부분 익절, 분할 매도 점검용",
    "/리포트 추천 — 오늘 대응할 투자 후보 텍스트 리포트",
    "/리포트 가이드 — 기능 활용 운영 가이드 PDF",
      "/리포트 자동매매 — 자동매매 명령어 사용 방법 PDF",
    "/리포트 포트폴리오 — 보유 종목/거래 중심 PDF",
    "/리포트 관심종목 — 관심 추적 종목 목록 PDF",
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

    const riskTier =
      ruleCompliancePct < 80 || (summary.payoffRatio != null && summary.payoffRatio < 1)
        ? "defensive"
        : summary.winRate >= 55 && (summary.payoffRatio == null || summary.payoffRatio >= 1.2)
          ? "offensive"
          : "neutral";

    const nextActions =
      riskTier === "defensive"
        ? [
            "우선순위: 신규 진입보다 손실 방어를 먼저 적용하세요.",
            "가이드: 종목당 손실 한도(-4%~-6%)를 고정하고, 손절 미이행 종목부터 정리하세요.",
            "현금: 단기적으로 현금 비중을 20% 이상 유지해 변동성 재진입 여력을 확보하세요.",
          ]
        : riskTier === "offensive"
          ? [
              "우선순위: 현재 전략은 유효합니다. 다만 추격 매수보다 눌림 구간 분할 진입을 유지하세요.",
              "가이드: 수익 구간 종목은 분할 익절(예: 1차 30~50%)로 변동성 리스크를 줄이세요.",
              "현금: 과열 구간 대비를 위해 현금 10% 이상은 상시 유지하세요.",
            ]
          : [
              "우선순위: 공격/방어 중립 구간입니다. 포지션 수를 늘리기보다 종목 질을 높이세요.",
              "가이드: 신규 진입은 상위 1~2개 후보로 제한하고, 손익비가 낮은 패턴을 제외하세요.",
              "현금: 현금 15~20% 구간을 유지해 장중 변동 대응력을 확보하세요.",
            ];

    // 결정로그 신뢰도 조회 (당월 30일 기준)
    const reliability = await getDecisionReliabilitySummary(ctx.chatId, 30).catch(() => null);

    const reliabilityLines: string[] = [];
    if (reliability && reliability.totalDecisions > 0) {
      reliabilityLines.push("");
      reliabilityLines.push("─────────────────");
      reliabilityLines.push("<b>판단 신뢰도 요약</b>");
      reliabilityLines.push(`총 의사결정: ${reliability.totalDecisions}건 (실행 ${reliability.executedDecisions}건)`);
      reliabilityLines.push(`근거 기록률: ${reliability.explanationCoveragePct.toFixed(1)}%`);
      if (reliability.averageConfidencePct != null) {
        reliabilityLines.push(`평균 신뢰도: ${reliability.averageConfidencePct.toFixed(1)}%`);
      }
      if (reliability.linkedSellCount > 0) {
        reliabilityLines.push(`연결 매도 승률: ${reliability.linkedSellWinRatePct != null ? `${reliability.linkedSellWinRatePct.toFixed(1)}%` : "집계중"} (${reliability.linkedSellCount}건)`);
        reliabilityLines.push(`연결 실현손익: ${fmtSignedWon(reliability.linkedRealizedPnl)}`);
      }
      if (reliability.trustScore != null) {
        reliabilityLines.push(`판단 신뢰점수: <code>${reliability.trustScore}점</code>`);
      }
      if (reliability.strategyVersionCount > 1) {
        reliabilityLines.push(`전략 버전 수: ${reliability.strategyVersionCount}개`);
      }
    }

    const msg = [
      `<b>${range.label} 월간 성과</b>`,
      "─────────────────",
      `거래 수: ${summary.tradeCount}건 (매수 ${summary.buyCount} / 매도 ${summary.sellCount})`,
      `승률(FIFO): ${summary.winRate.toFixed(1)}%`,
      `실현손익(FIFO): ${fmtSignedWon(summary.realizedPnl)}`,
      payoffLine,
      `최대 단일 손실: ${fmtSignedWon(summary.maxSingleLoss)}`,
      `규칙 준수율: ${ruleCompliancePct.toFixed(1)}% (손절 미이행 ${stopLossViolationCount}건)`,
      ...reliabilityLines,
      "",
      "<b>다음 운용 포인트</b>",
      ...nextActions.map((line, idx) => `${idx + 1}) ${line}`),
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

async function handleGuidePdfCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  const guidePdfPath = path.join(process.cwd(), "docs", "generated", "user-operating-guide.pdf");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "운영 가이드 PDF를 준비 중입니다. 잠시만 기다려주세요...",
  });

  try {
    const bytes = await readFile(guidePdfPath);
    const nowKst = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
    const caption = [
      "Signal Scanner Bot 운영 가이드",
      `기준 문서: docs/user-operating-guide.md`,
      `전송 시각: ${nowKst} KST`,
      "문서 수정 후 /리포트 가이드 로 최신본을 다시 확인하세요.",
    ].join("\n");

    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([bytes], { type: "application/pdf" }), "user-operating-guide.pdf");

    const sendResult = await tgSend("sendDocument", form);
    if (!sendResult?.ok) {
      const sendError = sendResult?.description || "Telegram sendDocument failed";
      throw new Error(sendError);
    }

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "운영 가이드 PDF를 보냈습니다.",
        "핵심 흐름: /경제 → /시장 → /브리핑 → /스캔 → /종목분석",
      ].join("\n"),
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
  } catch (e: any) {
    const detail = e instanceof Error ? e.message : String(e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "운영 가이드 PDF 전송에 실패했습니다.",
        `원인: ${detail}`,
        "운영팀은 `pnpm docs:guide:pdf` 실행 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}

  async function handleAutoTradeCommandGuidePdf(ctx: ChatContext, tgSend: any): Promise<void> {
    const guidePdfPath = path.join(process.cwd(), "docs", "generated", "automate-trade-command-guide.pdf");

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "자동매매 명령어 가이드 PDF를 준비 중입니다. 잠시만 기다려주세요...",
    });

    try {
      const bytes = await readFile(guidePdfPath);
      const nowKst = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
      const caption = [
        "Signal Scanner Bot 자동매매 명령어 운영 가이드",
        `기준 문서: docs/automate-trade-command-guide.md`,
        `전송 시각: ${nowKst} KST`,
        "주요 명령어: /자동사이클 점검, /자동사이클 실행, /자동사이클 실행 진입, /보유대응",
      ].join("\n");

      const form = new FormData();
      form.set("chat_id", String(ctx.chatId));
      form.set("caption", caption);
      form.set("disable_content_type_detection", "true");
      form.set("document", new Blob([bytes], { type: "application/pdf" }), "automate-trade-command-guide.pdf");

      const sendResult = await tgSend("sendDocument", form);
      if (!sendResult?.ok) {
        const sendError = sendResult?.description || "Telegram sendDocument failed";
        throw new Error(sendError);
      }

      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          "자동매매 명령어 가이드 PDF를 보냈습니다.",
          "핵심 흐름: 09:05 점검 → 09:15 필요시 실행 → 장중 모니터링 → 16:00 재판단",
          "월요일: /자동사이클 실행 진입 으로 신규 포지션 진입",
        ].join("\n"),
        reply_markup: actionButtons(ACTIONS.reportMenu, 2),
      });
    } catch (e: any) {
      const detail = e instanceof Error ? e.message : String(e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          "자동매매 명령어 가이드 PDF 전송에 실패했습니다.",
          `원인: ${detail}`,
          "운영팀은 `npx tsx scripts/export_markdown_pdf.ts --input docs/automate-trade-command-guide.md --output docs/generated/automate-trade-command-guide.pdf` 실행 후 다시 시도해주세요.",
        ].join("\n"),
      });
    }
  }

async function handlePlaybookReportCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "<b>실전운용 리포트 (월~금)</b>",
      "─────────────────",
      "월요일: 테스트 후 개장 직후 monday 실집행 1회",
      "화~금: daily/auto 하루 1회 고정",
      "보유 0개 재진입: daily/auto도 점수·현금 조건 충족 시 신규매수 가능",
      "",
      "<b>오늘 체크리스트</b>",
      "1) 점검 먼저 실행",
      "2) 실집행은 같은 날 같은 모드 반복 금지",
      "3) 실행 후 /보유, /거래기록으로 결과 확인",
      "",
      "출력본(PDF)이 필요하면 /리포트 가이드를 사용하세요.",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons([...ACTIONS.reportMenu, ...ACTIONS.autoCycleQuick], 2),
  });
}

async function handleDailyCandidateReportCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "오늘 대응할 투자 후보를 정리 중입니다. 잠시만 기다려주세요...",
  });

  try {
    const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
    const report = await createDailyCandidatePlanningReportResult(supabase, {
      riskProfile: (prefs.risk_profile ?? "safe") as "safe" | "balanced" | "active",
      chatId: ctx.chatId,
    });
    const analyzeButtons = report.topAnalyzeCodes.map((code, index) => ({
      text: `후보${index + 1} 분석`,
      callback_data: `trade:${code}`,
    }));
    const usedCodes = new Set(report.topAnalyzeCodes);
    const sectorLeaderButtons = report.sectorLeaderCodes
      .filter((code) => !usedCodes.has(code))
      .map((code, index) => ({
        text: `섹터대표${index + 1}`,
        callback_data: `trade:${code}`,
      }));

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: report.text,
      parse_mode: "HTML",
      reply_markup: actionButtons(
        [
          ...analyzeButtons,
          ...sectorLeaderButtons,
          { text: "눌림목", callback_data: "cmd:pullback" },
          { text: "코스피", callback_data: "cmd:kospi" },
          { text: "코스닥", callback_data: "cmd:kosdaq" },
          { text: "시장", callback_data: "cmd:market" },
          ...ACTIONS.reportMenu,
        ],
        2
      ),
    });
  } catch (e: any) {
    const detail = e instanceof Error ? e.message : String(e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "추천 리포트 생성에 실패했습니다.",
        `원인: ${detail}`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}

export async function handleReportMenu(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: buildReportMenuText(),
    reply_markup: actionButtons([...ACTIONS.reportMenu, ...ACTIONS.autoCycleQuick], 2),
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
      reply_markup: actionButtons([...ACTIONS.reportMenu, ...ACTIONS.autoCycleQuick], 2),
    });
    return;
  }

  if (normalizedTopic === "월간") {
    await handleMonthlyReportCommand(ctx, tgSend);
    return;
  }

  if (normalizedTopic === "실전운용") {
    await handlePlaybookReportCommand(ctx, tgSend);
    return;
  }

  if (normalizedTopic === "추천") {
    await handleDailyCandidateReportCommand(ctx, tgSend);
    return;
  }

  if (normalizedTopic === "가이드") {
    await handleGuidePdfCommand(ctx, tgSend);
    return;
  }

    if (normalizedTopic === "자동매매") {
      await handleAutoTradeCommandGuidePdf(ctx, tgSend);
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
