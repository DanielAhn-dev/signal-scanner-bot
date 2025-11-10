// src/types/db.ts
export type SectorRow = {
  id: string; // 업종/테마 식별자 (예: "KRX:화학")
  name: string; // 섹터명
  metrics?: any; // JSONB: 수익률, 20SMA 상회비중, ROC 등
  updated_at?: string;
};
