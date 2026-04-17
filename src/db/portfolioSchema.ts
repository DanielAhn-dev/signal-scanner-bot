export const PORTFOLIO_TABLES = {
  // Legacy physical table name kept for backward compatibility.
  positionsLegacy: "watchlist",
  // Canonical logical name for gradual migration.
  positions: "virtual_positions",
  trades: "virtual_trades",
  lots: "virtual_trade_lots",
  lotMatches: "virtual_trade_lot_matches",
  lotView: "virtual_position_lots",
} as const;

export const PORTFOLIO_LOT_COLUMNS = {
  legacyPositionId: "watchlist_id",
  legacySeedPositionId: "seed_watchlist_id",
  nextPositionId: "position_id",
  nextSeedPositionId: "seed_position_id",
} as const;
