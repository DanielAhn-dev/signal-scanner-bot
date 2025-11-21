import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
// getLeadersForSector가 이제 가격/등락률 등 상세 정보를 포함한다고 가정
import { getLeadersForSector } from "../../data/sector";
import { KO_MESSAGES } from "../messages/ko";
import { fmtKRW } from "../../lib/normalize"; // normalize에서 재사용

// --- 포맷팅 유틸리티 (내부용) ---
const fmtPrice = (n: number) => n.toLocaleString("ko-KR");
const fmtChange = (n: number) => {
  if (n > 0) return `🔴 +${n.toFixed(1)}%`;
  if (n < 0) return `🔵 ${n.toFixed(1)}%`; // 음수는 부호 자동 포함됨
  return `⚪ 0.0%`;
};

// --- 상세 정보 타입 정의 (DB 조회 결과 가정) ---
// 실제 data/sector.ts의 반환 타입에 맞춰 조정 필요
type StockSummary = {
  code: string;
  name: string;
  close: number; // 현재가 (stock_daily)
  changeRate: number; // 등락률 (전일 대비)
  value: number; // 거래대금 (stock_daily)
};

export async function handleStocksCommand(
  sectorName: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 1. 데이터 조회: 거래대금(value) 기준 내림차순 상위 10개
  // 기존 함수가 { code, name }만 반환한다면, DB 쿼리를 수정하여 위 StockSummary 정보를 가져오도록 개선 필요
  const leaders = (await getLeadersForSector(
    sectorName,
    10
  )) as unknown as StockSummary[];

  if (!leaders?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.STOCKS_EMPTY,
    });
  }

  // 2. 메시지 본문 생성 (상위 5개 종목 브리핑)
  const top5 = leaders.slice(0, 5);
  const listText = top5
    .map((s, idx) => {
      const rank = idx + 1;
      // 예: 1. 삼성전자 74,000원 (🔴 +1.2%)
      //       └ 💰 거래대금: 5000억
      return [
        `${rank}. *${s.name}* \`${fmtPrice(s.close)}원\` (${fmtChange(
          s.changeRate
        )})`,
        `   └ 💰 거래대금: ${fmtKRW(s.value)}`,
      ].join("\n");
    })
    .join("\n\n");

  const header = `🏭 *${sectorName}* 주도주 현황\n💡 _거래대금(유동성) 상위 TOP 5_`;
  const footer = `👇 *종목 버튼을 눌러 상세 진단(Score)을 확인하세요.*`;

  const message = [header, "", listText, "", footer].join("\n");

  // 3. 버튼 생성 (상위 10개 전체)
  // 버튼 텍스트는 심플하게: "삼성전자 (+1.2%)"
  const buttons = leaders.map((s) => {
    // 등락률 아이콘 간단 표시
    const icon = s.changeRate > 0 ? "🔺" : s.changeRate < 0 ? "UA" : "";
    // 텔레그램 버튼 글자수 제한 고려하여 이름만 넣거나 짧게 구성
    return {
      text: `${s.name} ${s.changeRate > 0 ? "+" : ""}${s.changeRate.toFixed(
        1
      )}%`,
      callback_data: `score:${s.code}`,
    };
  });

  // 4. 전송
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "Markdown",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
