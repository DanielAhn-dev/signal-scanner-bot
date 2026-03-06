// src/bot/commands/flow.ts
// /수급 — 외국인·기관 순매수 조회

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import {
  fetchRealtimeStockData,
  type RealtimeStockData,
} from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import * as cheerio from "cheerio";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

interface InvestorRow {
  date: string;
  foreignNet: number;
  instNet: number;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/** 네이버 금융 외국인/기관 일별 데이터 스크래핑 */
async function fetchInvestorData(code: string): Promise<InvestorRow[]> {
  try {
    const url = `https://finance.naver.com/item/frgn.naver?code=${code}`;
    const html = await fetch(url, { headers: { "User-Agent": UA } }).then(
      (r) => r.text()
    );
    const $ = cheerio.load(html);
    const rows: InvestorRow[] = [];

    $("table.type2 tr").each((_, el) => {
      const tds = $(el).find("td");
      if (tds.length < 9) return;

      const dateText = $(tds[0]).text().trim();
      if (!/\d{4}\.\d{2}\.\d{2}/.test(dateText)) return;

      const parse = (idx: number) => {
        const t = $(tds[idx]).text().trim().replace(/,/g, "");
        return parseInt(t, 10) || 0;
      };

      rows.push({
        date: dateText.replace(/\./g, "-"),
        foreignNet: parse(5),
        instNet: parse(6),
      });
    });

    return rows.slice(0, 10);
  } catch (e) {
    console.error(`수급 스크래핑 실패 (${code}):`, e);
    return [];
  }
}

/** /수급 [종목명] */
export async function handleFlowCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  // 종목 미지정 → 섹터 수급 요약
  if (!query) return handleMarketFlowSummary(ctx, tgSend);

  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다. 종목명 또는 코드를 확인해주세요.",
    });
  }

  const { code, name } = hits[0];

  // 실시간 가격 + 수급 데이터 동시 조회
  const [realtime, investors] = await Promise.all([
    fetchRealtimeStockData(code),
    fetchInvestorData(code),
  ]);

  const price = realtime?.price ?? 0;
  const changeStr = realtime
    ? `${realtime.change >= 0 ? "▲" : "▼"} ${Math.abs(realtime.changeRate).toFixed(2)}%`
    : "";

  let msg = `<b>${esc(name)}</b> (${code}) 투자자별 매매동향\n`;
  if (price)
    msg += `현재가 <code>${fmtInt(price)}원</code>  ${changeStr}\n`;
  if (realtime?.foreignRatio)
    msg += `외국인 보유비율 ${realtime.foreignRatio.toFixed(1)}%\n`;
  msg += LINE + "\n";

  if (!investors.length) {
    msg += "\n<i>수급 데이터를 조회할 수 없습니다.</i>\n";
    msg += "<i>장중 또는 최근 거래일 데이터가 없을 수 있습니다.</i>";
  } else {
    // 일별 테이블
    msg += "\n";
    for (const row of investors.slice(0, 5)) {
      const fSign = row.foreignNet >= 0 ? "+" : "";
      const iSign = row.instNet >= 0 ? "+" : "";
      msg += `  ${row.date}`;
      msg += `  외 <code>${fSign}${fmtInt(row.foreignNet)}</code>`;
      msg += `  기 <code>${iSign}${fmtInt(row.instNet)}</code>\n`;
    }

    // 5일 합산
    const f5 = investors.slice(0, 5).reduce((s, r) => s + r.foreignNet, 0);
    const i5 = investors.slice(0, 5).reduce((s, r) => s + r.instNet, 0);
    msg += `\n<b>5일 합산</b>\n`;
    msg += `  외국인 ${f5 >= 0 ? "▲" : "▼"} ${fmtInt(Math.abs(f5))}주`;
    msg += `  기관 ${i5 >= 0 ? "▲" : "▼"} ${fmtInt(Math.abs(i5))}주`;
  }

  msg += `\n\n${LINE}\n아래 버튼으로 상세 분석을 이어가세요.`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: createMultiRowKeyboard(3, [
      { text: "점수", callback_data: `score:${code}` },
      { text: "매수", callback_data: `buy:${code}` },
      { text: "재무", callback_data: `finance:${code}` },
      { text: "뉴스", callback_data: `news:${code}` },
      { text: "관심추가", callback_data: `watchadd:${code}` },
    ]),
  });
}

/** 시장 전체 섹터 수급 요약 */
async function handleMarketFlowSummary(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { data: sectors } = await supabase
    .from("sectors")
    .select("id, name, score, metrics")
    .order("score", { ascending: false })
    .limit(15);

  let msg = `<b>시장 수급 동향</b>\n`;
  msg += `<i>섹터별 외국인·기관 순매수 (5일)</i>\n${LINE}\n\n`;

  if (!sectors?.length) {
    msg += "데이터가 없습니다.";
  } else {
    let shown = 0;
    for (const s of sectors) {
      const m = s.metrics || {};
      const fFlow = Number(m.flow_foreign_5d || 0);
      const iFlow = Number(m.flow_inst_5d || 0);
      const total = fFlow + iFlow;
      if (total === 0) continue;

      const fStr =
        fFlow !== 0
          ? `외 ${fFlow > 0 ? "+" : ""}${(fFlow / 1e8).toFixed(0)}억`
          : "";
      const iStr =
        iFlow !== 0
          ? `기 ${iFlow > 0 ? "+" : ""}${(iFlow / 1e8).toFixed(0)}억`
          : "";

      const emoji = total > 0 ? "🟢" : "🔴";
      msg += `${emoji} <b>${esc(s.name)}</b>  ${fStr}  ${iStr}\n`;
      shown++;
    }
    if (!shown) msg += "수급 데이터가 수집되지 않았습니다.";
  }

  msg += `\n${LINE}\n/수급 종목명 — 개별 종목 수급 조회`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
