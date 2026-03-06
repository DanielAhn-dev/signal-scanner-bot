import * as cheerio from "cheerio";
import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";

type FinanceSnapshot = {
  sales?: number;
  opIncome?: number;
  netIncome?: number;
  debtRatio?: number;
  roe?: number;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function parseNum(text: string): number | undefined {
  const t = (text || "").replace(/,/g, "").trim();
  if (!t || t === "-" || t === "N/A") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function findLatestValue(row: string[]): number | undefined {
  for (const cell of row) {
    const v = parseNum(cell);
    if (v !== undefined) return v;
  }
  return undefined;
}

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

async function fetchNaverFinanceSnapshot(code: string): Promise<FinanceSnapshot> {
  try {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    const html = await fetch(url, { headers: { "User-Agent": UA } }).then((r) =>
      r.text()
    );

    const $ = cheerio.load(html);
    const rows = new Map<string, string[]>();

    $("div.section.cop_analysis table tbody tr").each((_, tr) => {
      const key = $(tr)
        .find("th")
        .first()
        .text()
        .replace(/\s+/g, "")
        .trim();
      if (!key) return;

      const vals: string[] = [];
      $(tr)
        .find("td")
        .each((__, td) => {
          const txt = $(td).text().replace(/\s+/g, "").trim();
          if (txt) vals.push(txt);
        });

      if (vals.length) rows.set(key, vals);
    });

    const sales = findLatestValue(rows.get("매출액") || []);
    const opIncome = findLatestValue(rows.get("영업이익") || []);
    const netIncome = findLatestValue(rows.get("당기순이익") || []);

    const debtRow =
      rows.get("부채비율") || rows.get("부채비율(%)") || rows.get("부채비율연결") || [];
    const roeRow =
      rows.get("ROE(지배주주)") || rows.get("ROE") || rows.get("ROE(%)") || [];

    return {
      sales,
      opIncome,
      netIncome,
      debtRatio: findLatestValue(debtRow),
      roe: findLatestValue(roeRow),
    };
  } catch (e) {
    console.error(`fetchNaverFinanceSnapshot failed (${code}):`, e);
    return {};
  }
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
      reply_markup: createMultiRowKeyboard(1, btns),
    });
  }

  const { code, name } = hits[0];

  const [rt, fin] = await Promise.all([
    fetchRealtimeStockData(code),
    fetchNaverFinanceSnapshot(code),
  ]);

  const price = rt?.price;
  const per = rt?.per;
  const pbr = rt?.pbr;

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

  msg += `${LINE}\n`;
  msg += `<b>핵심 지표</b>\n`;
  msg += `PER <code>${per !== undefined ? per.toFixed(2) : "-"}</code> · `;
  msg += `PBR <code>${pbr !== undefined ? pbr.toFixed(2) : "-"}</code> · `;
  msg += `ROE <code>${fin.roe !== undefined ? `${fin.roe.toFixed(2)}%` : "-"}</code>\n`;
  msg += `부채비율 <code>${
    fin.debtRatio !== undefined ? `${fin.debtRatio.toFixed(2)}%` : "-"
  }</code>\n\n`;

  msg += `<b>실적(최근 기준)</b>\n`;
  msg += `매출 <code>${fin.sales !== undefined ? fmtInt(fin.sales) : "-"}</code>\n`;
  msg += `영업이익 <code>${fin.opIncome !== undefined ? fmtInt(fin.opIncome) : "-"}</code>\n`;
  msg += `당기순이익 <code>${fin.netIncome !== undefined ? fmtInt(fin.netIncome) : "-"}</code>\n`;

  msg += `\n${LINE}\n<b>해석 코멘트</b>\n`;
  msg += `${esc(comment)}`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: createMultiRowKeyboard(3, [
      { text: "점수", callback_data: `score:${code}` },
      { text: "매수", callback_data: `buy:${code}` },
      { text: "수급", callback_data: `flow:${code}` },
      { text: "뉴스", callback_data: `news:${code}` },
      { text: "관심추가", callback_data: `watchadd:${code}` },
    ]),
  });
}
