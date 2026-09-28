/**
 * 전략 승격 승인·해제 — 텔레그램 버튼과 웹 전략 화면이 같은 기록을 쓴다.
 *
 * 규칙:
 *   - 승인은 최신 전향검증 판정(reviewStrategies)이 그 전략을 승격 후보로 낸 경우에만 받는다.
 *     (8주 이상 측정 + 봇·KODEX 200·CD금리를 모두 앞섬 + 낙폭이 봇 이하)
 *   - 승인된 전략이 봇에 구현돼 있으면(ACTIVATABLE_STRATEGIES) 그 전략이 켜진다. 아니면 "승인됨 — 구현 필요"로 남는다.
 *   - 해제는 언제든 가능 — 봇은 기존 방식으로 돌아간다.
 * 자동 전환은 없다. 사람이 누른 버튼만 상태를 바꾼다.
 */
import {
  FORWARD_TEST_RESULT_PATH,
  STRATEGY_LABELS,
  type ForwardTestSnapshot,
  type StrategyName,
} from "./strategyForwardTest";

type SupabaseClientAny = any;

const BUCKET = "market-snapshots";
export const STRATEGY_DECISIONS_PATH = "forward-test/decisions.json";
export const PROMOTION_CALLBACK_PREFIX = "promo:";

/** 봇 전략으로 구현돼 있어 승인 즉시 켤 수 있는 전략 */
/** gate-top20 = gateCoreStrategy.ts (virtualAutoTradeService.runGateCoreForUser) */
export const ACTIVATABLE_STRATEGIES: StrategyName[] = ["gate-top20"];

export type StrategyDecisionAction = "approve" | "defer" | "deactivate";

export type StrategyDecision = {
  strategy: StrategyName;
  action: StrategyDecisionAction;
  at: string;
  by: string;
  source: "telegram" | "web";
  /** 승인 당시 근거 (전향검증 기간·수익) */
  evidence?: string;
};

export type StrategyActivationState = {
  /** 지금 봇이 따르는 승격 전략 (없으면 기존 봇 방식) */
  active: StrategyName | null;
  /** 승인됐지만 봇 구현이 없어 아직 못 켠 전략 */
  approvedPendingImplementation: StrategyName[];
  decisions: StrategyDecision[];
};

export function resolveActivationState(decisions: StrategyDecision[]): StrategyActivationState {
  let active: StrategyName | null = null;
  const pending = new Set<StrategyName>();
  for (const d of [...decisions].sort((a, b) => a.at.localeCompare(b.at))) {
    if (d.action === "approve") {
      if (ACTIVATABLE_STRATEGIES.includes(d.strategy)) active = d.strategy;
      else pending.add(d.strategy);
    } else if (d.action === "deactivate") {
      if (active === d.strategy) active = null;
      pending.delete(d.strategy);
    } else if (d.action === "defer") {
      pending.delete(d.strategy);
    }
  }
  return { active, approvedPendingImplementation: [...pending], decisions };
}

export function isStrategyName(value: string): value is StrategyName {
  return Object.prototype.hasOwnProperty.call(STRATEGY_LABELS, value);
}

export function buildPromotionCallback(action: StrategyDecisionAction, strategy: StrategyName): string {
  return `${PROMOTION_CALLBACK_PREFIX}${action}:${strategy}`;
}

export function parsePromotionCallback(data: string): { action: StrategyDecisionAction; strategy: StrategyName } | null {
  if (!data.startsWith(PROMOTION_CALLBACK_PREFIX)) return null;
  const [action, strategy] = data.slice(PROMOTION_CALLBACK_PREFIX.length).split(":");
  if (!["approve", "defer", "deactivate"].includes(action) || !strategy || !isStrategyName(strategy)) return null;
  return { action: action as StrategyDecisionAction, strategy };
}

/** 텔레그램 인라인 버튼: 후보마다 [승인] [보류] */
export function buildPromotionKeyboard(candidates: StrategyName[]): Array<Array<{ text: string; callback_data: string }>> {
  return candidates.map((name) => [
    { text: `승인: ${STRATEGY_LABELS[name]}`, callback_data: buildPromotionCallback("approve", name) },
    { text: "보류", callback_data: buildPromotionCallback("defer", name) },
  ]);
}

async function downloadJson<T>(supabase: SupabaseClientAny, path: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

export async function loadStrategyDecisions(supabase: SupabaseClientAny): Promise<StrategyDecision[]> {
  return (await downloadJson<StrategyDecision[]>(supabase, STRATEGY_DECISIONS_PATH)) ?? [];
}

export async function loadStrategyActivation(supabase: SupabaseClientAny): Promise<StrategyActivationState> {
  return resolveActivationState(await loadStrategyDecisions(supabase));
}

/**
 * 결정 기록. 승인은 최신 판정이 그 전략을 후보로 냈을 때만 받는다.
 * 반환 message는 버튼을 누른 사람에게 그대로 보여 준다.
 */
export async function recordStrategyDecision(
  supabase: SupabaseClientAny,
  input: { strategy: StrategyName; action: StrategyDecisionAction; by: string; source: "telegram" | "web" }
): Promise<{ ok: boolean; message: string; state?: StrategyActivationState }> {
  const label = STRATEGY_LABELS[input.strategy];
  let evidence: string | undefined;
  if (input.action === "approve") {
    const snap = await downloadJson<ForwardTestSnapshot>(supabase, FORWARD_TEST_RESULT_PATH);
    const review = snap?.review;
    if (!snap || !review || review.status !== "propose" || !review.candidates.includes(input.strategy)) {
      return {
        ok: false,
        message: `${label}: 최신 판정에서 승격 후보가 아니라 승인할 수 없습니다 (8주 이상 측정 + 봇·KODEX 200·CD금리를 모두 앞서야 함).`,
      };
    }
    const r = snap.results.find((x) => x.name === input.strategy);
    evidence = `${snap.startDate}~${snap.endDate} ${r ? `${r.totalReturnPct.toFixed(1)}% · 낙폭 ${r.maxDrawdownPct.toFixed(1)}%` : ""}`;
  }
  const decisions = await loadStrategyDecisions(supabase);
  decisions.push({ strategy: input.strategy, action: input.action, at: new Date().toISOString(), by: input.by, source: input.source, evidence });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(STRATEGY_DECISIONS_PATH, JSON.stringify(decisions), { upsert: true, contentType: "application/json" });
  if (error) return { ok: false, message: `기록 실패: ${error.message}` };
  const state = resolveActivationState(decisions);
  const message =
    input.action === "approve"
      ? state.active === input.strategy
        ? `승인됨: ${label} — 다음 자동매매 실행부터 봇이 이 전략을 따릅니다. 해제하면 기존 방식으로 돌아갑니다.`
        : `승인 기록됨: ${label} — 봇 전략으로 아직 구현되지 않아 바로 켜지지 않습니다. Claude Code 세션에서 "전략 승격 적용: ${input.strategy}"을 요청하세요.`
      : input.action === "deactivate"
        ? `해제됨: ${label} — 봇은 기존 방식으로 돌아갑니다.`
        : `보류됨: ${label} — 다음 판정 때 다시 제안됩니다.`;
  return { ok: true, message, state };
}
