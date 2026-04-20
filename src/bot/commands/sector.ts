import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  scoreSectors,
  SectorScore,
  getTopSectors,
  getNextSectorCandidates,
} from "../../lib/sectors";
import { fmtKRW, fmtPctSafe, getBizDaysAgo } from "../../lib/normalize";
import { getLeadersForSectorById } from "../../data/sector";
import { getDailySeries } from "../../adapters";
import { calculateScore } from "../../score/engine";
import { buildInvestmentPlan } from "../../lib/investPlan";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { pickSaferCandidates, type RiskProfile } from "../../lib/investableUniverse";
import { getUserInvestmentPrefs } from "../../services/userService";
import { buildSectorInsightLines } from "../../services/marketInsightService";
import { esc, fmtInt, fmtPct } from "../messages/format";
import {
  header,
  section,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// --- 메시지 빌더 (HTML) ---
function buildSectorListMessage(title: string, sectors: SectorScore[]): string {
  if (!sectors.length) return "데이터가 없습니다.";

  const insightLines = buildSectorInsightLines(sectors).map((line) => esc(line));

  const topLines = sectors.map((s, idx) => {
    const rank = idx + 1;
    const flows: string[] = [];
    if (s.flowF5 !== 0) flows.push(`외 ${fmtKRW(s.flowF5)}`);
    if (s.flowI5 !== 0) flows.push(`기 ${fmtKRW(s.flowI5)}`);
    const flowStr = flows.length ? flows.join(", ") : "수급 특이 없음";
    const rsDisplay = fmtPctSafe(s.rs1M);

    return `${rank}. <b>${esc(s.name)}</b>  <code>${s.score.toFixed(0)}점</code>\n${flowStr} · RS(1M) ${rsDisplay}`;
  });

  return buildMessage([
    header(`${title} TOP ${sectors.length}`, "수급(5일) · 단기 모멘텀(RS) 기준"),
    ...(insightLines.length > 0 ? [section("해석", insightLines)] : []),
    section("섹터 랭킹", topLines),
    divider(),
  ]);
}

function buildSectorDetailMessage(
  sectorName: string,
  sectorScore: number | null,
  picks: Array<{
    code: string;
    name: string;
    price: number;
    changeRate?: number;
    planLabel: string;
    entryLow: number;
    entryHigh: number;
    target1Pct: number;
  }>
): string {
  const title = sectorScore != null
    ? `${sectorName} ${Math.round(sectorScore)}점`
    : sectorName;

  return buildMessage([
    header(title, "테마 안에서 바로 볼 후보만 압축"),
    section(
      "상위 종목",
      picks.map((pick, index) => {
        const change = pick.changeRate !== undefined
          ? ` ${pick.changeRate >= 0 ? "▲" : "▼"}${Math.abs(pick.changeRate).toFixed(1)}%`
          : "";

        return [
          `${index + 1}. <b>${esc(pick.name)}</b> <code>${pick.code}</code> <code>${fmtInt(pick.price)}원</code>${change}`,
          `   ${pick.planLabel} · 진입 ${fmtInt(pick.entryLow)}~${fmtInt(pick.entryHigh)} · 1차 ${fmtPct(pick.target1Pct * 100)}`,
        ].join("\n");
      })
    ),
    divider(),
    "상세 종목 분석은 버튼에서 이어집니다.",
  ]);
}

const CALLBACK_MAX = 60;

// --- 메인 핸들러: /sector ---
export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let sectors: SectorScore[] = [];

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const refDate = getBizDaysAgo(todayStr, 1); // 전 영업일
    sectors = await scoreSectors(refDate); // ✅ 재선언 없이 대입만
  } catch (e) {
    console.error("[sector] error:", e);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 섹터 분석 중 오류가 발생했습니다.",
    });
  }

  if (!sectors.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 분석된 섹터 데이터가 없습니다.",
    });
  }

  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
  const top = pickSaferCandidates(getTopSectors(sectors), 6, riskProfile);

  if (!top.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 기준을 만족하는 유망 섹터가 없습니다.",
    });
  }

  const text = buildSectorListMessage("주도 섹터 랭킹", top);

  const buttons = top
    .slice(0, 4)
    .filter((s) => s.id && Buffer.byteLength(s.id, "utf8") <= CALLBACK_MAX)
    .map((s) => ({
      text: s.name,
      callback_data: `sector:${s.id}`,
    }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: actionButtons([
      ...buttons,
      { text: "다음섹터", callback_data: "cmd:nextsector" },
      { text: "시장", callback_data: "cmd:market" },
    ], 2),
  });
}

// --- 메인 핸들러: /nextsector ---
export async function handleNextSectorCommand(
  ctx: ChatContext,
  tgSend: any,
  minFlow: number = 5_000_000_000 // 기본 50억 (순환매 초기에는 수급 작을 수 있음)
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let sectors: SectorScore[] = [];

  try {
    sectors = (await scoreSectors(today)) || [];
  } catch (e) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 수급 분석 중 오류가 발생했습니다.",
    });
  }

  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
  const next = pickSaferCandidates(getNextSectorCandidates(sectors, minFlow), 6, riskProfile);

  if (!next.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 현재 수급이 유입되는 순환매 후보 섹터가 없습니다.",
    });
  }

  const text = buildSectorListMessage("수급 급등(Next) 섹터", next);

  const buttons = next
    .slice(0, 4)
    .filter((s) => s.id && Buffer.byteLength(s.id, "utf8") <= CALLBACK_MAX)
    .map((s) => ({
      text: s.name,
      callback_data: `sector:${s.id}`,
    }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: actionButtons([
      ...buttons,
      { text: "주도섹터", callback_data: "cmd:sector" },
      { text: "시장", callback_data: "cmd:market" },
    ], 2),
  });
}

export async function handleSectorDetailCommand(
  sectorId: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
  const { data: sectorRow } = await supabase
    .from("sectors")
    .select("name, score")
    .eq("id", sectorId)
    .maybeSingle();

  const leaders = pickSaferCandidates(await getLeadersForSectorById(sectorId, 8), 6, riskProfile);
  if (!leaders.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "해당 테마에서 바로 볼 종목을 찾지 못했습니다.",
    });
  }

  const preview = leaders.slice(0, 3);
  const realtimeMap = await fetchRealtimePriceBatch(leaders.map((item) => item.code)).catch(
    () => ({} as Record<string, any>)
  );
  const seriesList = await Promise.all(
    preview.map((item) => getDailySeries(item.code, 420).catch(() => []))
  );

  const picks = preview
    .map((item, index) => {
      const realtime = realtimeMap[item.code];
      const series = seriesList[index];
      const currentPrice = realtime?.price ?? series?.[series.length - 1]?.close ?? 0;
      if (!currentPrice) return null;

      const scored = series && series.length >= 200 ? calculateScore(series) : null;
      const plan = buildInvestmentPlan({
        currentPrice,
        factors: scored?.factors ?? {},
        technicalScore: scored?.score,
      });

      return {
        code: item.code,
        name: item.name,
        price: currentPrice,
        changeRate: realtime?.changeRate,
        planLabel: plan.statusLabel,
        entryLow: plan.entryLow,
        entryHigh: plan.entryHigh,
        target1Pct: plan.target1Pct,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const fallbackPicks = leaders.slice(0, 3).map((item) => ({
    code: item.code,
    name: item.name,
    price: realtimeMap[item.code]?.price ?? 0,
    changeRate: realtimeMap[item.code]?.changeRate,
    planLabel: "후보 확인",
    entryLow: realtimeMap[item.code]?.price ?? 0,
    entryHigh: realtimeMap[item.code]?.price ?? 0,
    target1Pct: 0.05,
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: buildSectorDetailMessage(
      sectorRow?.name ?? sectorId,
      sectorRow?.score ?? null,
      picks.length ? picks : fallbackPicks
    ),
    parse_mode: "HTML",
    reply_markup: actionButtons(
      leaders.slice(0, 3).map((item) => ({
        text: item.name,
        callback_data: `trade:${item.code}`,
      })),
      2
    ),
  });
}
