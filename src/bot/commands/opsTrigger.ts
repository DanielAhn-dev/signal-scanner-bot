import type { ChatContext } from "../router";

type CronTaskName =
  | "scoreSync"
  | "briefing"
  | "report"
  | "virtualAutoTrade"
  | "virtualAutoTradeIntraday"
  | "strategyGateRefresh";

type ResolvedTask = {
  task: CronTaskName;
  label: string;
};

type TriggerPlan = {
  key: "single" | "ready" | "intraday" | "close" | "all";
  label: string;
  tasks: ResolvedTask[];
};

function parseOpsChatIds(): Set<number> {
  const ids = new Set<number>();
  const raw = String(process.env.TELEGRAM_OPS_CHAT_IDS ?? "");
  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const value = Number(token);
    if (Number.isFinite(value) && value !== 0) ids.add(value);
  }

  const alertChatId = Number(process.env.AUTO_TRADE_ALERT_CHAT_ID ?? "0");
  if (Number.isFinite(alertChatId) && alertChatId !== 0) ids.add(alertChatId);

  return ids;
}

function isOpsAllowed(chatId: number): boolean {
  const allowed = parseOpsChatIds();
  return allowed.size > 0 && allowed.has(chatId);
}

function getCronBaseUrl(): string | null {
  const explicit = String(process.env.CRON_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelUrl = String(process.env.VERCEL_URL ?? "").trim();
  if (!vercelUrl) return null;
  if (/^https?:\/\//i.test(vercelUrl)) return vercelUrl.replace(/\/$/, "");
  return `https://${vercelUrl.replace(/\/$/, "")}`;
}

function resolveTask(input: string): ResolvedTask | null {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return null;

  if (["장중", "intraday", "장중트리거", "intradayrun"].some((k) => text.includes(k))) {
    return { task: "virtualAutoTradeIntraday", label: "장중 자동사이클" };
  }
  if (["게이트", "gate", "튜닝", "autotune"].some((k) => text.includes(k))) {
    return { task: "strategyGateRefresh", label: "전략 게이트 리프레시" };
  }
  if (["점수", "스코어", "scoresync"].some((k) => text.includes(k))) {
    return { task: "scoreSync", label: "점수 동기화" };
  }
  if (["브리핑", "briefing", "장전"].some((k) => text.includes(k))) {
    return { task: "briefing", label: "장전 브리핑" };
  }
  if (["리포트", "report", "주간"].some((k) => text.includes(k))) {
    return { task: "report", label: "주간 리포트" };
  }
  if (["야간", "night", "autotrade", "사이클"].some((k) => text.includes(k))) {
    return { task: "virtualAutoTrade", label: "야간 자동사이클" };
  }

  return null;
}

function resolveTriggerPlan(input: string): TriggerPlan | null {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return null;

  if (["전체", "all", "원클릭", "full", "올인원"].some((k) => text.includes(k))) {
    return {
      key: "all",
      label: "전체 자동 운용",
      tasks: [
        { task: "scoreSync", label: "점수 동기화" },
        { task: "briefing", label: "장전 브리핑" },
        { task: "virtualAutoTradeIntraday", label: "장중 자동사이클" },
        { task: "virtualAutoTrade", label: "야간 자동사이클" },
        { task: "strategyGateRefresh", label: "전략 게이트 리프레시" },
      ],
    };
  }

  if (["준비", "ready", "프리마켓", "사전"].some((k) => text.includes(k))) {
    return {
      key: "ready",
      label: "장전 준비",
      tasks: [
        { task: "scoreSync", label: "점수 동기화" },
        { task: "briefing", label: "장전 브리핑" },
      ],
    };
  }

  if (["장중", "intraday", "실행"].some((k) => text.includes(k))) {
    return {
      key: "intraday",
      label: "장중 대응",
      tasks: [
        { task: "scoreSync", label: "점수 동기화" },
        { task: "virtualAutoTradeIntraday", label: "장중 자동사이클" },
      ],
    };
  }

  if (["마감", "장종료", "close", "eod", "야간준비"].some((k) => text.includes(k))) {
    return {
      key: "close",
      label: "장마감 준비",
      tasks: [
        { task: "virtualAutoTrade", label: "야간 자동사이클" },
        { task: "strategyGateRefresh", label: "전략 게이트 리프레시" },
        { task: "scoreSync", label: "점수 동기화" },
        { task: "briefing", label: "다음날 브리핑 준비" },
      ],
    };
  }

  const single = resolveTask(text);
  if (!single) return null;
  return {
    key: "single",
    label: `${single.label} 단일 실행`,
    tasks: [single],
  };
}

function buildHelpText(): string {
  return [
    "<b>자동 트리거 명령</b>",
    "- /자동트리거 준비 (점수+브리핑)",
    "- /자동트리거 장중 (점수+장중자동사이클)",
    "- /자동트리거 마감 (야간사이클+게이트+다음날준비)",
    "- /자동트리거 전체 (준비~마감 전체 시퀀스)",
    "",
    "단일 실행도 가능:",
    "- /자동트리거 장중",
    "- /자동트리거 게이트",
    "- /자동트리거 점수",
    "- /자동트리거 브리핑",
    "- /자동트리거 리포트",
    "- /자동트리거 야간",
    "",
    "설명:",
    "- 운영 채팅에서만 실행됩니다.",
    "- 개인 계정 자동매매는 /자동사이클 실행 을 사용하세요.",
  ].join("\n");
}

function summarizePlanResult(
  planLabel: string,
  rows: Array<{ label: string; status: number; ok: boolean; body: string }>
): string {
  const okCount = rows.filter((row) => row.ok).length;
  const total = rows.length;
  const lines = [
    `<b>${planLabel}</b> 실행 결과`,
    `- 완료: ${okCount}/${total}`,
  ];

  for (const row of rows) {
    const compact = (row.body || "").replace(/\s+/g, " ").trim().slice(0, 110);
    lines.push(`- ${row.ok ? "성공" : "실패"} | ${row.label} | HTTP ${row.status}`);
    if (compact) lines.push(`  ↳ ${compact}`);
  }

  return lines.join("\n");
}

export async function handleOpsTriggerCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const chatId = Number(ctx.chatId);
  const normalized = String(input || "").trim();

  if (!normalized || ["help", "도움말", "?"].includes(normalized.toLowerCase())) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: buildHelpText(),
      parse_mode: "HTML",
    });
    return;
  }

  if (!isOpsAllowed(chatId)) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: [
        "이 명령은 운영 채팅에서만 사용할 수 있습니다.",
        "개인 실행은 /자동사이클 실행 또는 /자동사이클 실행 진입을 사용해 주세요.",
      ].join("\n"),
    });
    return;
  }

  const plan = resolveTriggerPlan(normalized);
  if (!plan) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: [
        "인식하지 못한 작업입니다.",
        "예시: /자동트리거 준비 | /자동트리거 장중 | /자동트리거 마감 | /자동트리거 전체",
      ].join("\n"),
    });
    return;
  }

  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const baseUrl = getCronBaseUrl();
  if (!cronSecret || !baseUrl) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: "서버 설정(CRON_SECRET 또는 CRON_BASE_URL/VERCEL_URL)이 없어 실행할 수 없습니다.",
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: chatId,
    text: `⏳ ${plan.label} 실행 요청 중...`,
  });

  try {
    const results: Array<{ label: string; status: number; ok: boolean; body: string }> = [];
    for (const step of plan.tasks) {
      const response = await fetch(`${baseUrl}/api/cron?task=${step.task}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "x-ops-trigger": "telegram",
        },
      });
      const bodyText = await response.text();
      results.push({
        label: step.label,
        status: response.status,
        ok: response.ok,
        body: bodyText,
      });
    }

    await tgSend("sendMessage", {
      chat_id: chatId,
      text: summarizePlanResult(plan.label, results),
      parse_mode: "HTML",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: `실행 중 오류: ${message}`,
    });
  }
}
