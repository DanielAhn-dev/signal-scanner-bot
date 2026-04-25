import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, rgb, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";
import {
  createDailyCandidatePlanningReportResult,
  type DailyCandidateForecast,
  type DailyCandidatePlanningReportResult,
} from "../../services/marketInsightService";
import { summarizeWindow, type TradeRow } from "../../services/weeklyReportData";
import { drawTopicHero } from "../../services/weeklyReportLayout";
import { ReportContext, loadFontBytes, wrapText } from "../../services/weeklyReportPdfCore";
import { asKstDate, getReportTheme, toKrDate, toYmd } from "../../services/weeklyReportShared";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  fetchWatchMicroSignalsByCodes,
  resolveWatchDecision,
} from "../../lib/watchlistSignals";
import { getDecisionReliabilitySummary } from "../../services/decisionLogService";
import { getUserInvestmentPrefs } from "../../services/userService";
import { handlePreMarketPlanCommand } from "./preMarketPlan";
import { ACTIONS, actionButtons, buildRecommendationActionButtons } from "../messages/layout";

const REPORT_TOPIC_GUIDE = [
  { command: "주간", aliases: ["주간", "종합", "전체", "full", "weekly"], description: "시장과 포트폴리오를 함께 보는 종합 PDF" },
  { command: "눌림목", aliases: ["눌림목", "다음주", "선진입", "pullback", "nextweek"], description: "다음 주 선진입 후보와 진입/비중 가이드 PDF" },
  { command: "월간", aliases: ["월간", "monthly", "month"], description: "월별 성과 요약 텍스트" },
  { command: "실전운용", aliases: ["실전운용", "실전", "운용", "플레이북", "playbook", "ops"], description: "월~금 자동매매 실전 체크리스트 텍스트" },
  { command: "추천", aliases: ["추천", "후보", "daily", "plan", "planning", "ideas"], description: "매일 대응할 투자 후보 PDF" },
  { command: "공개추천", aliases: ["공개추천", "공개 추천", "공유추천", "public", "publicplan", "share"], description: "개인 보유·자금 정보를 제외한 후보 PDF" },
  { command: "가이드", aliases: ["가이드", "운영가이드", "guide", "guidepdf"], description: "운영 가이드 PDF" },
    { command: "자동매매", aliases: ["자동매매", "명령어", "command", "automate"], description: "자동매매 명령어 사용 가이드 PDF" },
  { command: "포트폴리오", aliases: ["포트폴리오", "보유", "holdings", "portfolio"], description: "보유 종목과 최근 거래 중심 PDF" },
  { command: "관심종목", aliases: ["관심종목", "관심", "watchonly", "watch"], description: "수익 추적 중인 관심 종목 목록 PDF" },
  { command: "거시", aliases: ["거시", "경제", "매크로", "economy", "macro"], description: "금리·환율·변동성 중심 PDF" },
  { command: "수급", aliases: ["수급", "자금", "flow"], description: "외국인·기관 자금 흐름 PDF" },
  { command: "섹터", aliases: ["섹터", "업종", "테마", "sector"], description: "섹터 강도 랭킹 PDF" },
  { command: "장전플랜", aliases: ["장전플랜", "주문플랜", "오늘주문", "premarket", "morningplan"], description: "오늘 적응형 주문 플랜 텍스트" },
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
    "/리포트 눌림목 — 다음 주 선진입 후보 PDF",
    "/리포트 월간 — 월별 성과 요약 텍스트",
    "/리포트 실전운용 — 월~금 자동매매 실전 체크리스트 텍스트",
    "  전략 유지 여부, 보유 추가매수, 부분 익절, 분할 매도 점검용",
    "/리포트 추천 — 오늘 대응할 투자 후보 PDF",
    "/리포트 공유추천 — 개인 보유/자금 정보 제외 후보 PDF",
    "/리포트 가이드 — 기능 활용 운영 가이드 PDF",
      "/리포트 자동매매 — 자동매매 명령어 사용 방법 PDF",
    "/리포트 포트폴리오 — 보유 종목/거래 중심 PDF",
    "/리포트 관심종목 — 관심 추적 종목 목록 PDF",
    "/리포트 거시 — 금리·환율·변동성 PDF",
    "/리포트 수급 — 외국인·기관 자금 흐름 PDF",
    "/리포트 섹터 — 섹터 강도 랭킹 PDF",
    "/리포트 장전플랜 — 오늘 적응형 주문 플랜 (성과 반영 보수/공격 조정)",
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
    text: "오늘 대응할 투자 후보 PDF를 생성 중입니다. 잠시만 기다려주세요...",
  });

  let report: Awaited<ReturnType<typeof createDailyCandidatePlanningReportResult>> | null = null;

  try {
    const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
    report = await createDailyCandidatePlanningReportResult(supabase, {
      riskProfile: (prefs.risk_profile ?? "safe") as "safe" | "balanced" | "active",
      chatId: ctx.chatId,
    });

    const pdf = await createDailyCandidateReportPdf(ctx.chatId, report);
    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", pdf.caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer], { type: "application/pdf" }), pdf.fileName);

    const sendResult = await tgSend("sendDocument", form);

    if (!sendResult?.ok) {
      const sendError = sendResult?.description || "Telegram sendDocument failed";
      throw new Error(sendError);
    }

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        pdf.summaryText,
        "핵심 후보는 아래 버튼으로 바로 이어서 확인할 수 있습니다.",
      ].join("\n"),
      reply_markup: actionButtons(
        buildRecommendationActionButtons(report.actionItems, [...ACTIONS.recommendationFollowup, ...ACTIONS.reportMenu]),
        2
      ),
    });
  } catch (e: any) {
    const detail = e instanceof Error ? e.message : String(e);
    if (report) {
      // 리포트 데이터는 있으나 PDF 전송에 실패한 경우 → 텍스트로 대체
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          "추천 PDF 전송에 실패해 텍스트 리포트로 대체합니다.",
          `원인: ${detail}`,
          "",
          report.text,
        ].join("\n"),
        parse_mode: "HTML",
        reply_markup: actionButtons(
          buildRecommendationActionButtons(report.actionItems, [...ACTIONS.recommendationFollowup, ...ACTIONS.reportMenu]),
          2
        ),
      });
    } else {
      // 리포트 생성 자체가 실패한 경우
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
}

export function buildPublicDailyCandidateText(rawText: string): string {
  const lines = String(rawText || "").split("\n");
  const hiddenSections = new Set(["<b>자금·리스크 상태</b>", "<b>분산 경고</b>"]);
  const sanitized: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (hiddenSections.has(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^<b>.*<\/b>$/.test(trimmed)) {
        skipping = false;
      } else {
        continue;
      }
    }
    sanitized.push(line);
  }

  const compacted: string[] = [];
  for (const line of sanitized) {
    const isEmpty = line.trim() === "";
    const prevEmpty = compacted.length > 0 && compacted[compacted.length - 1].trim() === "";
    if (isEmpty && prevEmpty) continue;
    compacted.push(line);
  }

  return [
    ...compacted,
    "",
    "<b>공유용 한 장 포인트</b>",
    "- 오늘은 상 주목도 1~2개만 우선 점검하고, 나머지는 장중 추적 후보로 두세요.",
    "- 후보 종목은 추격보다 분할 접근을 기본으로 하고, 손절/익절 기준을 진입 전에 먼저 고정하세요.",
    "- 시장 방향이 불명확하면 종목 수를 늘리기보다 상위 섹터 대표주 중심으로 집중도를 높이세요.",
    "- 이 리포트는 학습·공유 목적 자료이며, 최종 판단은 개인 책임입니다.",
  ].join("\n");
}

async function handlePublicDailyCandidateReportCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "투자 후보 PDF를 생성 중입니다. 잠시만 기다려주세요...",
  });

  let report: Awaited<ReturnType<typeof createDailyCandidatePlanningReportResult>> | null = null;

  try {
    report = await createDailyCandidatePlanningReportResult(supabase, {
      riskProfile: "balanced",
    });

    report = {
      ...report,
      text: buildPublicDailyCandidateText(report.text),
    };

    const pdf = await createDailyCandidateReportPdf(ctx.chatId, report, {
      title: "오늘의 투자 후보 리포트",
      subtitle: "개인 보유·자금·리스크 정보를 제외한 요약입니다.",
      filePrefix: "public_candidate_report",
      captionTitle: "오늘의 투자 후보 리포트",
      captionSubtitle: "추천 엔진 기준 일일 후보 PDF (개인정보 제외)",
      summaryText: "오늘의 투자 후보 리포트 PDF를 보냈습니다.",
    });
    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", pdf.caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer], { type: "application/pdf" }), pdf.fileName);

    const sendResult = await tgSend("sendDocument", form);

    if (!sendResult?.ok) {
      const sendError = sendResult?.description || "Telegram sendDocument failed";
      throw new Error(sendError);
    }

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        pdf.summaryText,
        "개인 보유/자금 정보가 제거된 버전입니다.",
      ].join("\n"),
      reply_markup: actionButtons(
        buildRecommendationActionButtons(report.actionItems, [...ACTIONS.recommendationFollowupCompact, ...ACTIONS.reportMenu]),
        2
      ),
    });
  } catch (e: any) {
    const detail = e instanceof Error ? e.message : String(e);
    if (report) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          "추천 PDF 전송에 실패해 텍스트 리포트로 대체합니다.",
          `원인: ${detail}`,
          "",
          report.text,
        ].join("\n"),
        parse_mode: "HTML",
        reply_markup: actionButtons(
          buildRecommendationActionButtons(report.actionItems, [...ACTIONS.recommendationFollowupCompact, ...ACTIONS.reportMenu]),
          2
        ),
      });
    } else {
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
}

function stripTelegramHtml(raw: string): string {
  return String(raw ?? "")
    .replace(/<\/?(b|i|code)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function getAttentionHighlight(line: string): { fill: RGB; text: RGB } | null {
  const normalized = String(line ?? "").trim();
  if (/^\d+\.\s+🟥\s+상\s+/.test(normalized)) {
    return { fill: rgb(1.0, 0.93, 0.93), text: rgb(0.72, 0.16, 0.16) };
  }
  if (/^\d+\.\s+🟩\s+중\s+/.test(normalized)) {
    return { fill: rgb(0.92, 0.98, 0.93), text: rgb(0.12, 0.45, 0.24) };
  }
  if (/^\d+\.\s+🟦\s+하\s+/.test(normalized)) {
    return { fill: rgb(0.92, 0.96, 1.0), text: rgb(0.13, 0.34, 0.62) };
  }
  return null;
}

function getSectorRoleLineStyle(line: string): { text: RGB; bold: boolean } | null {
  const normalized = String(line ?? "").trim();
  if (/^\[대표\]/.test(normalized)) {
    return { text: rgb(0.13, 0.28, 0.53), bold: true };
  }
  if (/^\[대기\]/.test(normalized)) {
    return { text: rgb(0.16, 0.38, 0.24), bold: true };
  }
  return null;
}

function getSectorRoleCardStyle(line: string): { fill: RGB; accent: RGB; text: RGB } | null {
  const normalized = String(line ?? "").trim();
  if (/^\[대표\]/.test(normalized)) {
    return {
      fill: rgb(0.95, 0.97, 1.0),
      accent: rgb(0.18, 0.36, 0.66),
      text: rgb(0.12, 0.27, 0.48),
    };
  }
  if (/^\[대기\]/.test(normalized)) {
    return {
      fill: rgb(0.95, 0.99, 0.96),
      accent: rgb(0.18, 0.46, 0.29),
      text: rgb(0.12, 0.35, 0.22),
    };
  }
  return null;
}

function isCandidateSectionHeading(line: string): boolean {
  return line === "눌림목 우선 체크" || line === "코스피 우선 후보" || line === "코스닥 우선 후보";
}

function isCandidateHeaderLine(line: string): boolean {
  return /^\d+\.\s+(?:🟥|🟩|🟦)?\s*(상|중|하)\s+/.test(String(line ?? "").trim());
}

function isCandidatePriorityLine(line: string): boolean {
  return /^우선\s+\d+순위/.test(String(line ?? "").trim());
}

function isCandidateScoreLine(line: string): boolean {
  return /^점수\s+기술/.test(String(line ?? "").trim());
}

function normalizeCandidateHeaderLine(line: string): string {
  const raw = String(line ?? "").trim();
  const match = raw.match(/^(\d+\.\s+)(?:🟥|🟩|🟦)?\s*(상|중|하)\s+(.+?)\s+(\d{6})\s+([\d,]+원)$/);
  if (!match) {
    return raw.replace(/^(\d+\.\s+)(?:🟥|🟩|🟦)?\s*(상|중|하)\s+/, "$1[$2] ").trim();
  }
  const [, prefix, tier, name, code, price] = match;
  return `${prefix}[${tier}] ${name} / ${code} / ${price}`;
}

function getCandidateHeaderColor(line: string): RGB {
  const normalized = String(line ?? "").trim();
  if (/^\d+\.\s+상\s+/.test(normalized)) return rgb(0.56, 0.16, 0.16);
  if (/^\d+\.\s+중\s+/.test(normalized)) return rgb(0.13, 0.37, 0.22);
  if (/^\d+\.\s+하\s+/.test(normalized)) return rgb(0.12, 0.30, 0.52);
  return rgb(0.12, 0.12, 0.16);
}

function getCandidateHeaderHighlight(line: string): { fill: RGB; text: RGB } {
  const normalized = String(line ?? "").trim();
  if (/^\d+\.\s+(?:🟥|🟩|🟦)?\s*상\s+/.test(normalized)) {
    return { fill: rgb(1.0, 0.93, 0.93), text: rgb(0.72, 0.16, 0.16) };
  }
  if (/^\d+\.\s+(?:🟥|🟩|🟦)?\s*중\s+/.test(normalized)) {
    return { fill: rgb(0.92, 0.98, 0.93), text: rgb(0.12, 0.45, 0.24) };
  }
  if (/^\d+\.\s+(?:🟥|🟩|🟦)?\s*하\s+/.test(normalized)) {
    return { fill: rgb(0.92, 0.96, 1.0), text: rgb(0.13, 0.34, 0.62) };
  }
  return { fill: rgb(0.95, 0.95, 0.97), text: rgb(0.12, 0.12, 0.16) };
}

function drawDailyForecastSection(ctx: ReportContext, forecasts: DailyCandidateForecast[]) {
  if (!forecasts.length) return;

  const sectionTitleSize = 10;
  const bodySize = 8;
  const bodyLineHeight = Math.round(bodySize * 1.45);

  ctx.ensureSpace(28);
  const titleCount = ctx.textBold("예측 시나리오 (백테스트 아님)", ctx.ML, ctx.y, sectionTitleSize, rgb(0.10, 0.28, 0.52), ctx.BODY_W);
  ctx.y -= titleCount * Math.round(sectionTitleSize * 1.45) + 4;
  const noteCount = ctx.textLight(
    "과거 유사 구간의 점수·추세·리스크 패턴을 이용한 추정입니다. 실제 손익은 체결/슬리피지/장세 변화에 따라 달라질 수 있습니다.",
    ctx.ML,
    ctx.y,
    bodySize,
    rgb(0.36, 0.36, 0.42),
    ctx.BODY_W
  );
  ctx.y -= noteCount * bodyLineHeight + 8;

  for (const [index, item] of forecasts.slice(0, 3).entries()) {
    const cardHeight = 86;
    ctx.ensureSpace(cardHeight + 10);

    const topY = ctx.y;
    const cardY = topY - cardHeight;
    ctx.rect(ctx.ML, cardY, ctx.BODY_W, cardHeight, rgb(0.96, 0.97, 0.99));
    ctx.rect(ctx.ML, cardY, 4, cardHeight, index === 0 ? rgb(0.78, 0.27, 0.27) : rgb(0.26, 0.44, 0.70));

    const header = `${index + 1}. ${item.name} (${item.code}) · ${item.strategyLabel}`;
    ctx.textBold(header, ctx.ML + 10, topY - 8, 9, rgb(0.13, 0.13, 0.18), ctx.BODY_W - 20);
    ctx.text(
      `기준가 ${Math.round(item.entryPrice).toLocaleString("ko-KR")}원 · 권장수량 ${item.suggestedQuantity > 0 ? `${item.suggestedQuantity}주` : "수량 산출 불가"}`,
      ctx.ML + 10,
      topY - 20,
      bodySize,
      rgb(0.18, 0.18, 0.24),
      ctx.BODY_W - 20
    );
    ctx.text(
      `예상손실 -${item.expectedDrawdownPct.toFixed(1)}% · 기준 +${item.expectedBasePct.toFixed(1)}% · 상단 +${item.expectedUpsidePct.toFixed(1)}% · 신뢰 ${item.confidencePct.toFixed(1)}%`,
      ctx.ML + 10,
      topY - 31,
      bodySize,
      rgb(0.18, 0.18, 0.24),
      ctx.BODY_W - 20
    );

    const chartAreaW = ctx.BODY_W - 20;
    const chartW = Math.max(140, Math.round(chartAreaW * 0.68));
    const chartX = ctx.ML + 10 + Math.round((chartAreaW - chartW) / 2);
    const chartY = topY - 76;
    const chartH = 34;
    const values = item.scenarioPathPct.length ? item.scenarioPathPct : [0, -1.5, -3.2, -0.9, 2.4, item.expectedBasePct];
    const maxVal = Math.max(1, ...values, item.expectedUpsidePct);
    const minVal = Math.min(-1, ...values, -item.expectedDrawdownPct);
    const span = Math.max(1, maxVal - minVal);

    const zeroY = chartY + ((0 - minVal) / span) * chartH;
    ctx.line(chartX, zeroY, chartX + chartW, zeroY, rgb(0.78, 0.80, 0.85), 0.7);
    ctx.line(chartX, chartY, chartX, chartY + chartH, rgb(0.82, 0.84, 0.88), 0.7);

    const points = values.map((value, valueIndex) => {
      const x = chartX + (chartW * valueIndex) / Math.max(1, values.length - 1);
      const y = chartY + ((value - minVal) / span) * chartH;
      return { x, y };
    });

    for (let i = 1; i < points.length; i += 1) {
      ctx.line(
        points[i - 1].x,
        points[i - 1].y,
        points[i].x,
        points[i].y,
        rgb(0.18, 0.46, 0.79),
        1.6
      );
    }

    const last = points[points.length - 1];
    ctx.rect(last.x - 1.8, last.y - 1.8, 3.6, 3.6, rgb(0.14, 0.38, 0.70));
    ctx.textLight("손익% 경로", chartX + chartW - 48, chartY - 1, 6.8, rgb(0.40, 0.42, 0.48));

    ctx.y -= cardHeight + 8;
  }
}

export async function createDailyCandidateReportPdf(
  chatId: number,
  report: DailyCandidatePlanningReportResult,
  options?: {
    title?: string;
    subtitle?: string;
    filePrefix?: string;
    captionTitle?: string;
    captionSubtitle?: string;
    summaryText?: string;
  }
): Promise<{
  bytes: Uint8Array;
  fileName: string;
  caption: string;
  summaryText: string;
}> {
  const now = new Date();
  const ymd = toYmd(asKstDate(now));
  const krDate = toKrDate(now);
  const theme = getReportTheme("full");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const fontLight = await pdf.embedFont(fontBytes.light);
  const font = await pdf.embedFont(fontBytes.regular);
  const fontBold = await pdf.embedFont(fontBytes.bold);
  const ctx = new ReportContext(pdf, fontLight, font, fontBold, theme);
  ctx.footerLabel = ymd;
  ctx.addPage(null);
  const title = options?.title ?? "오늘의 투자 후보 리포트";
  const subtitle = options?.subtitle ?? "추천 엔진이 고른 당일 후보를 PDF로 묶은 테스트 출력입니다. PDF 전송 경로와 추천 데이터 경로를 함께 검증할 수 있습니다.";
  const filePrefix = options?.filePrefix ?? "daily_candidate_report";
  const captionTitle = options?.captionTitle ?? "오늘의 투자 후보 리포트";
  const captionSubtitle = options?.captionSubtitle ?? "추천 엔진 기준 일일 대응 후보 PDF";
  const summaryText = options?.summaryText ?? "오늘의 투자 후보 리포트 PDF를 보냈습니다.";
  ctx.pageTitle = title;
  drawTopicHero(
    ctx,
    title,
    subtitle
  );

  drawDailyForecastSection(ctx, report.forecasts ?? []);

  const rawLines = String(report.text ?? "").split("\n");
  const sectionFontSize = 10;
  const bodyFontSize = 8.5;
  const bodyLineHeight = Math.round(bodyFontSize * 1.45);
  let inSectorTemplateSection = false;
  let inCandidateListSection = false;
  let hasRenderedCandidateItem = false;
  let hasRenderedSectorIndexLine = false;
  let lastHeadingY = 0;

  for (const rawLine of rawLines) {
    const isDivider = /^[-─]{5,}$/.test(rawLine.trim());
    const isHeading = /<b>.*<\/b>/.test(rawLine);
    const isMuted = /<i>.*<\/i>/.test(rawLine);
    const line = stripTelegramHtml(rawLine);
    const attentionHighlight = getAttentionHighlight(line);
    const roleLineStyle = getSectorRoleLineStyle(line);

    if (!line) {
      if (inCandidateListSection) continue;
      ctx.y -= 8;
      continue;
    }

    if (line === "오늘의 투자 후보 리포트" || line === "오늘의 공개 투자 후보 리포트") {
      continue;
    }

    if (isDivider) {
      ctx.ensureSpace(14);
      ctx.line(ctx.ML, ctx.y, ctx.ML + ctx.BODY_W, ctx.y, theme.border, 0.75);
      ctx.y -= 12;
      continue;
    }

    // 후보 섹션 내 항목 헤더: "<b>🟩 중</b> <b>종목명</b>..." 형태라 isHeading에 먼저 잡히므로
    // isHeading 전에 가로채야 inCandidateListSection이 잘못 리셋되지 않습니다.
    if (inCandidateListSection && isCandidateHeaderLine(line)) {
      if (hasRenderedCandidateItem) {
        // 항목(1번/2번/3번...) 사이 공백을 줄입니다.
        ctx.y -= 8;
      }
      const normalizedHeader = normalizeCandidateHeaderLine(line);
      const highlight = getCandidateHeaderHighlight(line);
      const wrapped = wrapText(normalizedHeader, ctx.BODY_W - 12, ctx.fontBold, bodyFontSize);
      const highlightHeight = wrapped.length * bodyLineHeight + 7;
      const bgWidth = Math.min(
        wrapped.reduce((max, l) => Math.max(max, ctx.fontBold.widthOfTextAtSize(l, bodyFontSize)), 0) + 16,
        ctx.BODY_W
      );
      ctx.ensureSpace(highlightHeight + 20);
      ctx.rect(ctx.ML - 2, ctx.y - highlightHeight + 5, bgWidth, highlightHeight, highlight.fill);
      ctx.textBold(normalizedHeader, ctx.ML + 4, ctx.y, bodyFontSize, highlight.text, ctx.BODY_W - 12);
      // 헤더 라벨과 본문(우선/점수) 간격을 조금 더 타이트하게 맞춥니다.z
      ctx.y -= wrapped.length * bodyLineHeight + 5;
      hasRenderedCandidateItem = true;
      continue;
    }

    if (isHeading || line === "섹터별 대표·대기" || isCandidateSectionHeading(line)) {
      const wasSectorTemplateSection = inSectorTemplateSection;
      const wasCandidateListSection = inCandidateListSection;
      const nextIsSectorTemplateSection = line === "섹터별 대표·대기";
      const nextIsCandidateListSection = isCandidateSectionHeading(line);
      if (wasSectorTemplateSection && !nextIsSectorTemplateSection) {
        // 섹터 템플릿 다음의 다른 섹션(예: 눌림목 우선 체크)은 블록 간 여백을 분명히 둡니다.
        ctx.y -= 6;
      }
      if (wasCandidateListSection && !nextIsCandidateListSection) {
        // 후보 리스트 블록이 끝나고 다른 섹션으로 넘어갈 때도 여백을 둡니다.
        ctx.y -= 12;
      }
      if (wasCandidateListSection && nextIsCandidateListSection) {
        // 코스피 우선 후보 진입 시에만 간격을 1.5배로 넓힙니다.
        ctx.y -= line === "코스피 우선 후보" ? 15 : 10;
      }

      inSectorTemplateSection = nextIsSectorTemplateSection;
      inCandidateListSection = nextIsCandidateListSection;
      hasRenderedCandidateItem = false;
      hasRenderedSectorIndexLine = false;
      ctx.ensureSpace(20);
      const count = ctx.textBold(line, ctx.ML, ctx.y, sectionFontSize, theme.accent, ctx.BODY_W);
      lastHeadingY = ctx.y;
      const headingBottomGap = nextIsSectorTemplateSection ? 14 : nextIsCandidateListSection ? 4 : 6;
      ctx.y -= count * Math.round(sectionFontSize * 1.45) + headingBottomGap;
      continue;
    }

    if (inCandidateListSection && !hasRenderedCandidateItem && /^기준일/.test(line)) {
      ctx.textRightLight(line, ctx.ML + ctx.BODY_W, lastHeadingY, bodyFontSize - 0.5, theme.subtitle);
      continue;
    }

    if (inCandidateListSection && isCandidatePriorityLine(line)) {
      const count = ctx.text(line, ctx.ML + 8, ctx.y, bodyFontSize, rgb(0.24, 0.24, 0.30), ctx.BODY_W - 8);
      ctx.y -= count * bodyLineHeight;
      continue;
    }

    if (inCandidateListSection && isCandidateScoreLine(line)) {
      const count = ctx.textLight(line, ctx.ML + 8, ctx.y, bodyFontSize, rgb(0.38, 0.38, 0.44), ctx.BODY_W - 8);
      ctx.y -= count * bodyLineHeight;
      continue;
    }

    if (inCandidateListSection && /^⚠️/.test(line)) {
      const count = ctx.text(line, ctx.ML + 8, ctx.y, bodyFontSize, rgb(0.63, 0.20, 0.20), ctx.BODY_W - 8);
      ctx.y -= count * bodyLineHeight + 1;
      continue;
    }

    if (inSectorTemplateSection && /^\d+\.\s+/.test(line.trim())) {
      if (hasRenderedSectorIndexLine) {
        ctx.y -= 10;
      }
      ctx.ensureSpace(bodyLineHeight + 10);
      const count = ctx.textBold(line, ctx.ML, ctx.y, bodyFontSize, rgb(0.14, 0.14, 0.18), ctx.BODY_W);
      ctx.y -= count * bodyLineHeight + 6;
      hasRenderedSectorIndexLine = true;
      continue;
    }

    if (attentionHighlight) {
      const wrapped = wrapText(line, ctx.BODY_W - 12, ctx.fontBold, bodyFontSize);
      const highlightHeight = wrapped.length * bodyLineHeight + 7;
      const bgWidth = Math.min(
        wrapped.reduce((max, l) => Math.max(max, ctx.fontBold.widthOfTextAtSize(l, bodyFontSize)), 0) + 16,
        ctx.BODY_W
      );
      ctx.ensureSpace(highlightHeight + 4);
      ctx.rect(ctx.ML - 2, ctx.y - highlightHeight + 5, bgWidth, highlightHeight, attentionHighlight.fill);
      ctx.textBold(line, ctx.ML + 4, ctx.y, bodyFontSize, attentionHighlight.text, ctx.BODY_W - 12);
      ctx.y -= wrapped.length * bodyLineHeight + 10;
      continue;
    }

    if (roleLineStyle) {
      const cardStyle = inSectorTemplateSection ? getSectorRoleCardStyle(line) : null;
      if (cardStyle) {
        const wrapped = wrapText(line, ctx.BODY_W - 22, ctx.fontBold, bodyFontSize);
        const cardHeight = wrapped.length * bodyLineHeight + 11;
        const bgCardWidth = Math.min(
          wrapped.reduce((max, l) => Math.max(max, ctx.fontBold.widthOfTextAtSize(l, bodyFontSize)), 0) + 24,
          ctx.BODY_W
        );
        ctx.ensureSpace(cardHeight + 6);
        ctx.rect(ctx.ML - 1, ctx.y - cardHeight + 5, bgCardWidth, cardHeight, cardStyle.fill);
        ctx.rect(ctx.ML - 1, ctx.y - cardHeight + 5, 3, cardHeight, cardStyle.accent);
        const count = ctx.textBold(line, ctx.ML + 8, ctx.y - 1, bodyFontSize, cardStyle.text, ctx.BODY_W - 18);
        ctx.y -= count * bodyLineHeight + 5;
        continue;
      }

      const count = roleLineStyle.bold
        ? ctx.textBold(line, ctx.ML, ctx.y, bodyFontSize, roleLineStyle.text, ctx.BODY_W)
        : ctx.text(line, ctx.ML, ctx.y, bodyFontSize, roleLineStyle.text, ctx.BODY_W);
      ctx.y -= count * bodyLineHeight + 2;
      continue;
    }

    const count = isMuted
      ? ctx.textLight(line, ctx.ML, ctx.y, bodyFontSize, theme.subtitle, ctx.BODY_W)
      : ctx.text(line, ctx.ML, ctx.y, bodyFontSize, undefined, ctx.BODY_W);
    ctx.y -= count * bodyLineHeight + 2;
  }

  ctx.finalizePage();

  return {
    bytes: await pdf.save(),
    fileName: `${filePrefix}_${chatId}_${ymd}.pdf`,
    caption: [
      captionTitle,
      `기준일: ${krDate}`,
      captionSubtitle,
    ].join("\n"),
    summaryText,
  };
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

  if (normalizedTopic === "공개추천") {
    await handlePublicDailyCandidateReportCommand(ctx, tgSend);
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

  if (normalizedTopic === "장전플랜") {
    await handlePreMarketPlanCommand("", ctx, tgSend);
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
    form.set("document", new Blob([report.bytes.buffer.slice(report.bytes.byteOffset, report.bytes.byteOffset + report.bytes.byteLength) as ArrayBuffer], { type: "application/pdf" }), report.fileName);

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
