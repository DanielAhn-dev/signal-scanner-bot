export interface StockOHLCV {
  date: string; // YYYY-MM-DD
  code: string; // 종목코드
  name?: string; // 종목명
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 거래량
  amount: number; // 거래대금 (원)
  cached_at?: string; // 추가: 캐시 시간 (선택적)
}

export interface StockInfo {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX";
  marketCap?: number;
  sector?: string;
}

export interface TopStock {
  code: string;
  name: string;
  close: number;
  change: number; // 등락률 (%)
  volume: number;
  amount: number; // 거래대금
}
