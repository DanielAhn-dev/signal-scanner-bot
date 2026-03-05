// src/bot/commands/news.ts
// /뉴스 — 종목·시장 뉴스 조회

import type { ChatContext } from "../router";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchStockNews, fetchMarketNews } from "../../utils/fetchNews";
import { esc, LINE } from "../messages/format";
import { createMultiRowKeyboard } from "../../telegram/keyboards";

export async function handleNewsCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  // 종목 미지정 → 시장 전체 뉴스
  if (!query) {
    const items = await fetchMarketNews(7);

    let msg = `<b>시장 주요 뉴스</b>\n${LINE}\n\n`;
    if (!items.length) {
      msg += "뉴스를 불러올 수 없습니다.\n";
    } else {
      items.forEach((item, i) => {
        msg += `${i + 1}. <a href="${item.link}">${esc(item.title)}</a>\n`;
      });
    }
    msg += `\n${LINE}\n/뉴스 종목명 — 개별 종목 뉴스 조회`;

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  // 종목 검색
  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다.",
    });
  }

  const { code, name } = hits[0];
  const items = await fetchStockNews(code, 7);

  let msg = `<b>${esc(name)}</b> (${code}) 관련 뉴스\n${LINE}\n\n`;
  if (!items.length) {
    msg += "관련 뉴스를 찾을 수 없습니다.\n";
  } else {
    items.forEach((item, i) => {
      msg += `${i + 1}. <a href="${item.link}">${esc(item.title)}</a>\n`;
      if (item.source || item.date) {
        msg += `   <i>${item.source || ""} ${item.date || ""}</i>\n`;
      }
    });
  }

  msg += `\n${LINE}`;

  // 관련 명령어 버튼
  const btns = [
    { text: `점수 조회`, callback_data: `score:${code}` },
    { text: `매수 판독`, callback_data: `buy:${code}` },
    { text: `수급 조회`, callback_data: `flow:${code}` },
  ];

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: createMultiRowKeyboard(3, btns),
  });
}
