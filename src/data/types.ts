// src/data/types.ts
export type Candle = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 거래량
  value?: number; // 선택: 거래대금(일부 소스 호환)
};

export type Series = Candle[];

// 전종목 메타(유니버스)
export type UniverseItem = {
  code: string; // 종목코드
  name: string; // 종목명
  market: "KOSPI" | "KOSDAQ" | "KONEX" | "ETC"; // 시장 구분
};

// 표준 일봉 OHLCV(코드·이름·거래대금 포함)
export interface StockOHLCV {
  date: string; // YYYY-MM-DD
  code: string; // 종목코드
  name?: string; // 종목명(선택)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 거래량
  amount: number; // 거래대금(원)
  value?: number; // 선택: 소스에 따라 value 필드 호환
  cached_at?: string; // 선택: 캐시 시각
}

// 당일 스냅샷(Quiet Spike 등에 사용)
export type DailyPrice = {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number;
};
