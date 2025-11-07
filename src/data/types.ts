// src/data/types.ts
export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value?: number;
};
export type Series = Candle[];
export type UniverseItem = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX" | "ETC";
};
export interface StockOHLCV {
  date: string;
  code: string;
  name?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  value?: number;
  cached_at?: string;
}
export type DailyPrice = { date: string; close: number; volume: number };
