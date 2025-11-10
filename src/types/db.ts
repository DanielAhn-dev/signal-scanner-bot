// src/types/db.ts
export type StockRow = {
  code: string; // 예: '005930'
  name: string; // 예: '삼성전자'
  market?: string; // KOSPI | KOSDAQ | KONEX 등
  liquidity?: number; // 선택: 최근 20D 평균 거래대금
  updated_at?: string;
};

export type SectorRow = {
  id: string; // 예: 'KRX:IT'
  name: string; // 섹터명
  metrics?: any; // JSONB
  updated_at?: string;
};
