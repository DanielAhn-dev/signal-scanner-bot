import * as cheerio from "cheerio";
import type { ChatContext } from "../router";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";
import {
  formatEokAmount,
  formatFundamentalInline,
  formatPctValue,
  formatPer,
} from "../messages/fundamental";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import fundamentalStore from "../../services/fundamentalStore";
import { actionButtons, ACTIONS } from "../messages/layout";

function interpretFinance(input: {
  sectorName?: string;
  profileLabel?: string;
  profileNote?: string;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
}): string {
  const notes: string[] = [];

  if (input.per !== undefined) {
    if (input.per < 0) notes.push("적자 상태라 PER보다는 PBR·현금흐름·이익 턴어라운드 확인이 우선");
    else if (input.per <= 10) notes.push("PER이 낮아 밸류 부담은 상대적으로 작은 편");
    else if (input.per >= 25) notes.push("PER이 높은 편이라 성장 기대가 가격에 반영된 구간");
    else notes.push("PER은 중립 구간");
  }

  if (input.pbr !== undefined && input.roe !== undefined) {
    if (input.roe >= 15 && input.pbr <= 2) {
      notes.push("ROE 대비 PBR 조합이 양호해 수익성-밸류 균형이 좋음");
    } else if (input.roe < 8 && input.pbr > 1.5) {
      notes.push("ROE가 낮은데 PBR은 높은 편이라 밸류 부담 주의");
    } else if (input.roe < 10) {
      notes.push("ROE는 높지 않지만 PBR 부담은 크지 않은 편");
    }
  } else if (input.roe !== undefined) {
    if (input.roe >= 12) notes.push("ROE가 양호해 자본효율이 좋은 편");
    else if (input.roe < 6) notes.push("ROE가 낮아 수익성 개선 여부 확인 필요");
  }

  if (input.debtRatio !== undefined) {
    if (input.debtRatio < 80) notes.push("부채비율이 낮아 재무안정성 우수");
    else if (input.debtRatio > 200) notes.push("부채비율이 높아 금리/실적 변동 민감도 주의");
  }

  if (!notes.length) {
    const base = "핵심 재무지표가 충분히 확보되지 않아 중립 판단입니다. 분기 실적 발표와 추정치 변화를 함께 확인하세요.";
    return input.profileNote ? `${base}\n업종 기준: ${input.profileNote}` : base;
  }

  const sectorLine = input.sectorName
    ? `대상 업종: ${input.sectorName}${input.profileLabel ? ` (${input.profileLabel} 기준)` : ""}`
    : input.profileLabel
      ? `적용 기준: ${input.profileLabel}`
      : "";

  return [
    notes.join(" · "),
    sectorLine,
    input.profileNote ? `업종 기준: ${input.profileNote}` : "",
    "재무지표는 업종 평균과 함께 비교하는 것이 정확합니다.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleFinanceCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /재무 종목명 또는 코드\n예) /재무 삼성전자",
    });
  }

  const hits = await searchByNameOrCode(query, 5);
  if (!hits.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다. 종목명 또는 코드를 확인해주세요.",
    });
  }

  if (hits.length > 1 && !/^\d{6}$/.test(query)) {
    const btns = hits.slice(0, 5).map((h) => ({
      text: `${h.name} (${h.code})`,
      callback_data: `finance:${h.code}`,
    }));

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(query)}' 검색 결과 ${hits.length}건 — 종목을 선택하세요`,
      parse_mode: "HTML",
      reply_markup: actionButtons(btns, 2),
    });
  }

  const { code, name } = hits[0];

  const [rt, fin] = await Promise.all([
    fetchRealtimeStockData(code),
    (async () => {
      try {
        const dbRec = await fundamentalStore.getLatestFundamentalSnapshot(code);
        if (dbRec) {
          return {
            sectorName: typeof dbRec.computed?.sectorName === "string" ? dbRec.computed.sectorName : dbRec.source ?? undefined,
            profileLabel: typeof dbRec.computed?.profileLabel === "string" ? dbRec.computed.profileLabel : undefined,
            profileNote: typeof dbRec.computed?.profileNote === "string" ? dbRec.computed.profileNote : undefined,
            per: typeof dbRec.per === "number" ? dbRec.per : undefined,
            pbr: typeof dbRec.pbr === "number" ? dbRec.pbr : undefined,
            roe: typeof dbRec.roe === "number" ? dbRec.roe : undefined,
            debtRatio: typeof dbRec.debt_ratio === "number" ? dbRec.debt_ratio : undefined,
            qualityScore: Number(dbRec.computed?.qualityScore ?? 50) || 50,
            sales: typeof dbRec.sales === "number" ? dbRec.sales : undefined,
            opIncome: typeof dbRec.operating_income === "number" ? dbRec.operating_income : undefined,
            netIncome: typeof dbRec.net_income === "number" ? dbRec.net_income : undefined,
            salesGrowthPct: Number(dbRec.computed?.salesGrowthPct ?? NaN) || undefined,
            opIncomeGrowthPct: Number(dbRec.computed?.opIncomeGrowthPct ?? NaN) || undefined,
            netIncomeGrowthPct: Number(dbRec.computed?.netIncomeGrowthPct ?? NaN) || undefined,
            salesGrowthLowBase: Boolean(dbRec.computed?.salesGrowthLowBase ?? false),
            opIncomeGrowthLowBase: Boolean(dbRec.computed?.opIncomeGrowthLowBase ?? false),
            opIncomeTurnaround: Boolean(dbRec.computed?.opIncomeTurnaround ?? false),
            netIncomeGrowthLowBase: Boolean(dbRec.computed?.netIncomeGrowthLowBase ?? false),
            netIncomeTurnaround: Boolean(dbRec.computed?.netIncomeTurnaround ?? false),
            commentary:
              typeof dbRec.computed?.commentary === "string"
                ? dbRec.computed?.commentary
                : typeof dbRec.computed?.note === "string"
                ? dbRec.computed?.note
                : undefined,
          };
        }
      } catch (e) {
        console.error("fundamentalStore.getLatestFundamentalSnapshot error:", e);
      }
      return getFundamentalSnapshot(code).catch(() => null);
    })(),
  ]);

  const finSafe = (fin ?? {}) as any;

  const price = rt?.price;
  const per = rt?.per ?? finSafe.per;
  const pbr = rt?.pbr ?? finSafe.pbr;

  const comment = interpretFinance({
    sectorName: finSafe.sectorName,
    profileLabel: finSafe.profileLabel,
    profileNote: finSafe.profileNote,
    per,
    pbr,
    roe: finSafe.roe,
    debtRatio: finSafe.debtRatio,
  });

  let msg = `<b>${esc(name)}</b>  <code>${code}</code> 재무 요약\n`;
  if (price) {
    const sign = (rt?.change || 0) >= 0 ? "▲" : "▼";
    msg += `현재가 <code>${fmtInt(price)}원</code>  ${sign} ${Math.abs(rt?.changeRate || 0).toFixed(2)}%\n`;
  }

  msg += `\n${LINE}\n`;
  msg += `<b>핵심 지표</b>\n`;
  msg += `PER <code>${formatPer(per)}</code> · `;
  msg += `PBR <code>${pbr !== undefined ? pbr.toFixed(2) : "-"}</code> · `;
  msg += `ROE <code>${formatPctValue(finSafe.roe)}</code>\n`;
  msg += `부채비율 <code>${formatPctValue(finSafe.debtRatio)}</code>\n\n`;
  msg += `${formatFundamentalInline({
    qualityScore: finSafe.qualityScore,
    profileLabel: finSafe.profileLabel,
    per,
    pbr,
    roe: finSafe.roe,
    debtRatio: finSafe.debtRatio,
  }, { includeDebtRatio: true, htmlCodeForScore: true })}\n\n`;
  if (finSafe.sectorName) {
    msg += `업종 <code>${esc(finSafe.sectorName)}</code>\n`;
  }
  if (finSafe.profileNote) {
    msg += `<i>${esc(finSafe.profileNote)}</i>\n\n`;
  }

  msg += `<b>실적(최근 연간 기준)</b>\n`;
  msg += `매출 <code>${formatEokAmount(finSafe.sales)}</code>\n`;
  msg += `영업이익 <code>${formatEokAmount(finSafe.opIncome)}</code>\n`;
  msg += `당기순이익 <code>${formatEokAmount(finSafe.netIncome)}</code>\n`;
  msg += `<i>실적은 최근 연간 확정치 기준</i>\n`;
  msg += `\n`; 
  msg += `<b>성장률(전년 대비)</b>\n`;
  msg += `매출 <code>${formatPctValue(finSafe.salesGrowthPct)}</code> · `;
  msg += `영업이익 <code>${formatPctValue(finSafe.opIncomeGrowthPct)}</code> · `;
  msg += `순이익 <code>${formatPctValue(finSafe.netIncomeGrowthPct)}</code>\n`;
  msg += `<i>현재 PER/PBR은 최근 4분기 기준</i>\n`;
  const growthHints = [
    finSafe.salesGrowthLowBase ? "매출 성장률은 낮은 기저 영향 가능성" : "",
    finSafe.opIncomeTurnaround ? "영업이익은 턴어라운드 구간" : "",
    finSafe.opIncomeGrowthLowBase ? "영업이익 성장률은 낮은 기저 영향 가능성" : "",
    finSafe.netIncomeTurnaround ? "순이익은 턴어라운드 구간" : "",
    finSafe.netIncomeGrowthLowBase ? "순이익 성장률은 낮은 기저 영향 가능성" : "",
  ].filter(Boolean);
  if (growthHints.length) {
    msg += `<i>${esc(growthHints.join(" · "))}</i>\n`;
  }

  msg += `\n${LINE}\n<b>해석 코멘트</b>\n`;
  msg += `${esc(comment)}\n`;
  msg += `${esc(finSafe.commentary ?? "")}`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.analyzeStock(code), 3),
  });
}
