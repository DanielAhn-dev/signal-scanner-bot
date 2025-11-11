// src/types/db.ts
export type StockRow = {
  code: string;
  name: string;
  market?: string;
  liquidity?: number;
  sector_id?: string | null;
  updated_at?: string;
};

export type SectorRow = {
  id: string; // e.g., "KRX:IT"
  name: string;
  metrics?: any;
  updated_at?: string;
};
