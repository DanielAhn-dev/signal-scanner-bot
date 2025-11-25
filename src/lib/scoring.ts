interface StockData {
  code: string;
  universe_level: string;
  per: number | null;
  pbr: number | null;
  rsi: number;
  roc_14: number;
  above_sma20: boolean;
  above_sma50: boolean;
  above_sma200: boolean;
  close: number;
  low_52w: number;
}

export function calculateScore(stock: StockData) {
  let valueScore = 0;
  let momentumScore = 0;
  let universeBonus = 0;

  // 1. 유니버스 보너스 (안정성 점수)
  if (stock.universe_level === "core") universeBonus = 20;
  else if (stock.universe_level === "extended") universeBonus = 10;
  else universeBonus = -10; // 소형주는 페널티

  // 2. 가치 점수 (40점 만점)
  // PER가 10 이하이고 유효한 값이면 고득점
  if (stock.per && stock.per > 0 && stock.per <= 10) valueScore += 20;
  else if (stock.per && stock.per <= 15) valueScore += 10;

  // 저점 대비 위치: 52주 최저가 대비 10~15% 이내면 저평가 매력
  const lowPremium = ((stock.close - stock.low_52w) / stock.low_52w) * 100;
  if (lowPremium < 10) valueScore += 20;
  else if (lowPremium < 20) valueScore += 10;

  // 3. 모멘텀 점수 (40점 만점)
  // RSI 중립~강세 구간 (40~70)
  if (stock.rsi >= 40 && stock.rsi <= 60) momentumScore += 15;
  else if (stock.rsi > 60 && stock.rsi <= 75) momentumScore += 10; // 과열 주의

  // 이평선 정배열/지지
  if (stock.above_sma20) momentumScore += 10;
  if (stock.above_sma50) momentumScore += 5;
  if (stock.above_sma200) momentumScore += 5;

  // ROC 상승 추세
  if (stock.roc_14 > 0) momentumScore += 5;

  // 최종 합산 (100점 만점 + 알파)
  const totalScore = valueScore + momentumScore + universeBonus;

  return {
    totalScore,
    valueScore,
    momentumScore,
    universeBonus,
  };
}
