// src/bot/commands/news.ts
// /뉴스 — 종목·시장 뉴스 조회

import type { ChatContext } from "../router";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchStockNews, fetchMarketNews } from "../../utils/fetchNews";
import { esc } from "../messages/format";
import {
  header,
  section,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";

export async function handleNewsCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  // 종목 미지정 → 시장 전체 뉴스
  if (!query) {
    const items = await fetchMarketNews(7);

    let msg = header("시장 주요 뉴스");
    if (!items.length) {
      msg = buildMessage([msg, section("목록", ["뉴스를 불러올 수 없습니다."])]);
    } else {
      const lines = items.map(
        (item, i) => `${i + 1}. <a href="${item.link}">${esc(item.title)}</a>`
      );
      msg = buildMessage([msg, section("목록", lines), divider()]);
    }

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: actionButtons(ACTIONS.marketFlowWithPromptNews, 2),
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

  const head = header(`${name} (${code}) 관련 뉴스`);
  const lines: string[] = [];
  if (!items.length) {
    lines.push("관련 뉴스를 찾을 수 없습니다.");
  } else {
    items.forEach((item, i) => {
      lines.push(`${i + 1}. <a href="${item.link}">${esc(item.title)}</a>`);
      if (item.source || item.date) {
        lines.push(`   <i>${item.source || ""} ${item.date || ""}</i>`);
      }
    });
  }

  const msg = buildMessage([head, section("목록", lines), divider()]);

  // 관련 명령어 버튼
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons(ACTIONS.analyzeStock(code), 3),
  });
}
