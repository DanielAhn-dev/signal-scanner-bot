import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 브리핑 리포트를 생성하는 메인 함수
 * @param supabase Supabase 클라이언트 인스턴스
 * @param type 브리핑 타입 (pre_market | market_close)
 */
export async function createBriefingReport(
  supabase: SupabaseClient,
  type: "pre_market" | "market_close" = "pre_market"
): Promise<string> {
  // 1. 주도 섹터 가져오기 (상위 3개)
  // sectors 테이블에 momentum_score나 roc_1m 같은 지표가 계산되어 있다고 가정
  const { data: topSectors, error: sectorError } = await supabase
    .from("sectors")
    .select("id, name, avg_change_rate, momentum_score")
    .order("momentum_score", { ascending: false }) // 모멘텀 점수 높은 순
    .limit(3);

  if (sectorError)
    throw new Error(`Sector fetch failed: ${sectorError.message}`);

  // 2. 섹터별 대장주 및 '밑에서' 잡을 종목 병렬 조회
  const sectorReports = await Promise.all(
    (topSectors || []).map(async (sector) => {
      // 해당 섹터의 대장주 (거래대금 & 점수 상위)
      const { data: topStocks } = await supabase
        .from("stocks")
        .select("name, code, close, change_rate")
        .eq("sector_id", sector.id)
        .order("score", { ascending: false }) // 자체 알고리즘 점수
        .limit(2);

      return formatSectorSection(sector, topStocks || []);
    })
  );

  // 3. '밑에서' 턴어라운드 후보 (RSI < 35 이면서 ROC 개선)
  const { data: bottomStocks } = await supabase
    .from("stocks")
    .select("name, code, close, rsi_14, roc_21")
    .lt("rsi_14", 35) // 과매도 구간
    .gt("roc_21", 0) // 모멘텀은 양수 전환 시도
    .order("roc_21", { ascending: false })
    .limit(3);

  // 4. 메시지 조합
  const date = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  let report = `☀️ **${date} 장전 브리핑**\n\n`;

  report += `🚀 **오늘의 주도 테마 (Top 3)**\n`;
  report += sectorReports.join("\n");

  report += `\n👀 **'빈집털이' 후보 (과매도+턴)**\n`;
  if (bottomStocks && bottomStocks.length > 0) {
    bottomStocks.forEach((stock) => {
      report += `- ${stock.name} (${stock.code}): RSI ${stock.rsi_14?.toFixed(
        0
      )}\n`;
    });
  } else {
    report += `- 감지된 종목이 없습니다.\n`;
  }

  report += `\n💡 /start 명령어로 알림 설정을 확인하세요.`;

  return report;
}

// 헬퍼: 섹터 섹션 포맷팅
function formatSectorSection(sector: any, stocks: any[]) {
  const sectorEmoji = getSectorEmoji(sector.name);
  let text = `\n${sectorEmoji} **${sector.name}** (모멘텀 ${
    sector.momentum_score?.toFixed(0) ?? 0
  }점)\n`;

  stocks.forEach((stock) => {
    const arrow =
      stock.change_rate > 0 ? "🔺" : stock.change_rate < 0 ? "🔹" : "-";
    const price = stock.close.toLocaleString();
    const rate =
      stock.change_rate > 0
        ? `+${stock.change_rate}%`
        : `${stock.change_rate}%`;

    text += `  └ ${stock.name}: ${price}원 (${arrow}${rate})\n`;
  });

  return text;
}

// 헬퍼: 섹터 이름에 따른 이모지 매핑 (단순화)
function getSectorEmoji(name: string): string {
  if (name.includes("반도체")) return "💾";
  if (name.includes("2차전지") || name.includes("배터리")) return "🔋";
  if (name.includes("바이오") || name.includes("제약")) return "💊";
  if (name.includes("자동차")) return "🚗";
  if (name.includes("로봇") || name.includes("AI")) return "🤖";
  return "📊";
}
