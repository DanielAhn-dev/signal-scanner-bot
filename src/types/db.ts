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

export type UserRow = {
  id: string;
  tg_id: number;
  username?: string | null;
  first_name?: string | null;
  language_code?: string;
  prefs?: any;
  last_active_at?: string;
  is_active?: boolean;
  created_at?: string;
};

export type UserActivityRow = {
  id: number;
  tg_id: number;
  command: string;
  args?: string | null;
  created_at?: string;
};

export type FollowRow = {
  id: number;
  follower_tg_id: number;
  following_tg_id: number;
  created_at?: string;
};

export type PullbackSignalRow = {
  code: string;
  trade_date: string;
  entry_grade: "A" | "B" | "C";
  entry_score: number; // 0~4
  trend_grade: "A" | "B" | "C";
  dist_grade: "A" | "B" | "C";
  pivot_grade: "A" | "B" | "C";
  vol_atr_grade: "A" | "B" | "C";
  dist_pct: number;
  ma21: number | null;
  ma50: number | null;
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL";
  warn_score: number; // 0~6
  warn_overheat: boolean;
  warn_vol_spike: boolean;
  warn_atr_spike: boolean;
  warn_rsi_ob: boolean;
  warn_ma_break: boolean;
  warn_dead_cross: boolean;
  created_at?: string;
  updated_at?: string;
};
