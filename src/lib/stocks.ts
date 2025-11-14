// src/lib/stocks.ts
import { fetchStockPriceSeries, StockPriceRow } from "./source"; // source.ts에서 시세 조회 함수 가져오기

export type StockScore = {
  code: string;
  name: string;
  score: number;
  // 필요하면 다른 필드도 추가
};

function calculateScore(series: StockPriceRow[]): number {
  if (series.length < 20) return 0;
  const last = series[series.length - 1];
  if (!last || !last.sma20) return 0;

  // 20일 이평선 위에 있고, 거래량이 터졌고... 등등의 복잡한 로직 추가
  let score = 0;
  if (last.close > last.sma20) {
    score += 50;
  }
  return score;
}

// 특정 섹터의 종목 점수를 계산하는 메인 함수
export async function scoreStocksInSector(
  sectorId: string
): Promise<StockScore[]> {
  const today = new Date().toISOString().slice(0, 10);
  const seriesByStock = await fetchStockPriceSeries(today, sectorId);

  const scores: StockScore[] = [];
  for (const stock of seriesByStock) {
    scores.push({
      code: stock.code,
      name: stock.name,
      score: calculateScore(stock.series),
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}
