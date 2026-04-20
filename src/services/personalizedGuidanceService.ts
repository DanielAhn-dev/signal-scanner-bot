import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { getUserInvestmentPrefs } from "./userService";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type AutoTradeSettingRow = {
  selected_strategy?: string | null;
  is_enabled?: boolean | null;
  last_daily_review_at?: string | null;
  last_monday_buy_at?: string | null;
};

type AutoTradeRunRow = {
  run_type?: string | null;
  status?: string | null;
  summary?: Record<string, unknown> | null;
  started_at?: string | null;
};

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function getStrategyLabel(strategy?: string | null): string | null {
  const key = String(strategy ?? "").trim().toUpperCase();
  if (!key) return null;

  const labels: Record<string, string> = {
    HOLD_SAFE: "안전 포지션",
    REDUCE_TIGHT: "타이트 손절",
    WAIT_AND_DIP_BUY: "매수 기회 대기",
    SHORT_SWING: "단기 스윙",
    SWING: "스윙",
    POSITION_CORE: "중장기 코어",
  };

  return labels[key] ?? key;
}

function isRecentIso(iso?: string | null, maxHours = 36): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= maxHours * 60 * 60 * 1000;
}

function extractRunHint(run?: AutoTradeRunRow | null): string | null {
  if (!run?.summary || typeof run.summary !== "object") return null;
  const summary = run.summary as Record<string, unknown>;
  const notes = Array.isArray(summary.notes)
    ? summary.notes.filter((item): item is string => typeof item === "string")
    : [];
  const joined = notes.join(" ");

  if (/추가매수\s+\d+건/.test(joined) || /실행 추가매수/.test(joined)) {
    return "최근 자동사이클은 보유 종목 추가매수까지 반영했습니다.";
  }
  if (/부분익절|분할 매도|take-profit-partial/i.test(joined)) {
    return "최근 자동사이클은 부분 익절 흐름까지 반영했습니다.";
  }
  if (/후보 0건|후보 없음|미체결/.test(joined)) {
    return "최근 자동사이클 기준으로는 오늘 바로 체결할 후보가 부족했습니다.";
  }
  if (/보유 종목 .* 유지|보유유지/.test(joined)) {
    return "최근 자동사이클 기준으로는 보유 종목 유지 구간이었습니다.";
  }

  return null;
}

function buildModeHint(): string {
  return "참고: /자동사이클 실행 은 실행 시점에 월요일이면 매수, 그 외에는 일일점검을 자동 선택하고, /자동사이클 실행 daily 는 항상 일일점검만 실행합니다.";
}

export async function buildPersonalizedGuidance(input: {
  chatId: number;
  focusCode?: string | null;
  context: "brief" | "scan" | "flow" | "buy" | "market" | "holding-plan";
}): Promise<string[]> {
  const chatId = input.chatId;
  const focusCode = String(input.focusCode ?? "").trim().toUpperCase() || null;

  const [prefs, settingRes, runRes, holdingsRes] = await Promise.all([
    getUserInvestmentPrefs(chatId),
    supabase
      .from("virtual_autotrade_settings")
      .select("selected_strategy, is_enabled, last_daily_review_at, last_monday_buy_at")
      .eq("chat_id", chatId)
      .maybeSingle(),
    supabase
      .from("virtual_autotrade_runs")
      .select("run_type, status, summary, started_at")
      .eq("chat_id", chatId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(PORTFOLIO_TABLES.positionsLegacy)
      .select("code, status")
      .eq("chat_id", chatId),
  ]);

  const setting = (settingRes.data ?? null) as AutoTradeSettingRow | null;
  const latestRun = (runRes.data ?? null) as AutoTradeRunRow | null;
  const holdings = ((holdingsRes.data ?? []) as Array<{ code?: string | null; status?: string | null }>)
    .filter((row) => (row.status ?? "holding") !== "closed")
    .map((row) => String(row.code ?? "").trim().toUpperCase())
    .filter(Boolean);

  const holdCount = holdings.length;
  const hasFocusHolding = focusCode ? holdings.includes(focusCode) : false;
  const strategyLabel = getStrategyLabel(setting?.selected_strategy);
  const latestRunRecent = isRecentIso(latestRun?.started_at);
  const cash = Math.max(
    0,
    toNumber(prefs.virtual_cash, toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0)))
  );
  const lines: string[] = [];

  if (strategyLabel) {
    lines.push(`현재 기본 전략은 ${strategyLabel}입니다.`);
  }

  if (hasFocusHolding) {
    lines.push("이 종목은 이미 보유 중이라 신규진입보다 추가매수 또는 부분익절 조건을 같이 보는 편이 맞습니다.");
  } else if (holdCount > 0) {
    lines.push(`현재 보유 ${holdCount}종목, 가용현금 ${fmtKrw(cash)} 기준으로는 신규 진입보다 보유 대응을 먼저 보는 편이 자연스럽습니다.`);
  } else if (cash > 0) {
    lines.push(`현재 보유가 없어 ${fmtKrw(cash)} 범위에서 정찰 진입 후보를 먼저 압축해 보는 흐름이 맞습니다.`);
  }

  if (String(setting?.selected_strategy ?? "").toUpperCase() === "WAIT_AND_DIP_BUY") {
    lines.push("현재 전략상 신규 매수보다 관찰과 눌림 확인이 우선입니다.");
  }

  const runHint = extractRunHint(latestRun);
  if (runHint) {
    lines.push(runHint);
  } else if (!latestRun || !latestRunRecent) {
    lines.push("최근 자동사이클 결과가 없거나 오래되어, 이번 화면의 제안을 우선 참고한 뒤 필요할 때만 자동사이클을 실행하면 됩니다.");
  }

  if (input.context === "brief") {
    if (latestRunRecent) {
      lines.push("오늘은 브리핑과 최근 자동사이클 결과가 이미 있어, 바로 자동사이클을 다시 돌리지 않아도 판단 기준을 잡을 수 있습니다.");
    } else {
      lines.push("오늘 판단을 바로 확정해야 하면 브리핑 확인 후 /자동사이클 테스트 또는 /자동사이클 실행 daily 로 최종 점검하면 충분합니다.");
    }
  }

  if (input.context === "buy") {
    if (hasFocusHolding) {
      lines.push("이 종목은 이미 보유 중이므로, 지금 화면은 신규매수보다 추가매수 가능 여부와 부분익절 구간 확인용으로 보는 편이 맞습니다.");
    } else if (holdCount > 0) {
      lines.push("신규 진입을 검토하더라도 현재 보유 포지션과 현금 여력을 함께 비교해서 비중을 정하는 편이 안전합니다.");
    }
  }

  if (input.context === "holding-plan") {
    if (holdCount > 0) {
      lines.push("보유대응은 자동사이클 실행 전에도 익절·손절·추가매수 우선순위를 읽는 용도로 충분합니다.");
    }
    if (latestRunRecent) {
      lines.push("최근 자동사이클 결과가 있어, 이번 화면은 실행보다 해석과 우선순위 정리에 더 가깝게 보면 됩니다.");
    }
  }

  if (input.context === "market") {
    if (holdCount > 0) {
      lines.push("시장 화면은 신규 매수 타이밍보다 현재 보유 포지션의 방어/확대 여부를 정하는 기준으로 보는 편이 좋습니다.");
    } else if (cash > 0) {
      lines.push("시장 화면에서는 지금이 정찰 진입을 시작할 장인지, 관찰만 할 장인지 먼저 판단하면 됩니다.");
    }
  }

  if (input.context !== "flow") {
    lines.push(buildModeHint());
  }

  return Array.from(new Set(lines)).slice(0, 4);
}