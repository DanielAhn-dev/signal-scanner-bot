import * as cheerio from "cheerio";
import type { ChatContext } from "../router";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";
import { formatEokAmount, formatFundamentalInline } from "../messages/fundamental";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import { actionButtons, ACTIONS } from "../messages/layout";

function interpretFinance(input: {
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
}): string {
  const notes: string[] = [];

  if (input.per !== undefined) {
    if (input.per <= 10) notes.push("PER이 낮아 밸류 부담은 상대적으로 작은 편");
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
    return "핵심 재무지표가 충분히 확보되지 않아 중립 판단입니다. 분기 실적 발표와 추정치 변화를 함께 확인하세요.";
  }

  return `${notes.join(" · ")}\n재무지표는 업종 평균과 함께 비교하는 것이 정확합니다.`;
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
    getFundamentalSnapshot(code),
  ]);

  const price = rt?.price;
  const per = rt?.per ?? fin.per;
  const pbr = rt?.pbr ?? fin.pbr;

  const comment = interpretFinance({
    per,
    pbr,
    roe: fin.roe,
    debtRatio: fin.debtRatio,
  });

  let msg = `<b>${esc(name)}</b>  <code>${code}</code> 재무 요약\n`;
  if (price) {
    const sign = (rt?.change || 0) >= 0 ? "▲" : "▼";
    msg += `현재가 <code>${fmtInt(price)}원</code>  ${sign} ${Math.abs(rt?.changeRate || 0).toFixed(2)}%\n`;
  }

  msg += `\n${LINE}\n`;
  msg += `<b>핵심 지표</b>\n`;
  msg += `PER <code>${per !== undefined ? per.toFixed(2) : "-"}</code> · `;
  msg += `PBR <code>${pbr !== undefined ? pbr.toFixed(2) : "-"}</code> · `;
  msg += `ROE <code>${fin.roe !== undefined ? `${fin.roe.toFixed(2)}%` : "-"}</code>\n`;
  msg += `부채비율 <code>${
    fin.debtRatio !== undefined ? `${fin.debtRatio.toFixed(2)}%` : "-"
  }</code>\n\n`;
  msg += `${formatFundamentalInline({
    qualityScore: fin.qualityScore,
    per,
    pbr,
    roe: fin.roe,
    debtRatio: fin.debtRatio,
  }, { includeDebtRatio: true, htmlCodeForScore: true })}\n\n`;

  msg += `<b>실적(최근 연간 기준)</b>\n`;
  msg += `매출 <code>${formatEokAmount(fin.sales)}</code>\n`;
  msg += `영업이익 <code>${formatEokAmount(fin.opIncome)}</code>\n`;
  msg += `당기순이익 <code>${formatEokAmount(fin.netIncome)}</code>\n`;
  msg += `\n`; 
  msg += `<b>성장률(전년 대비)</b>\n`;
  msg += `매출 <code>${
    fin.salesGrowthPct !== undefined ? `${fin.salesGrowthPct.toFixed(2)}%` : "-"
  }</code> · `;
  msg += `영업이익 <code>${
    fin.opIncomeGrowthPct !== undefined
      ? `${fin.opIncomeGrowthPct.toFixed(2)}%`
      : "-"
  }</code> · `;
  msg += `순이익 <code>${
    fin.netIncomeGrowthPct !== undefined
      ? `${fin.netIncomeGrowthPct.toFixed(2)}%`
      : "-"
  }</code>\n`;

  msg += `\n${LINE}\n<b>해석 코멘트</b>\n`;
  msg += `${esc(comment)}\n`;
  msg += `${esc(fin.commentary)}`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.analyzeStock(code), 3),
  });
}
