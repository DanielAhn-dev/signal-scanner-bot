export const PORTFOLIO_TABLES = {
  positions: "virtual_positions",
  trades: "virtual_trades",
  decisionLogs: "virtual_decision_logs",
  decisionOutcomes: "virtual_decision_outcomes",
  strategyVersions: "virtual_strategy_versions",
  strategyGateStates: "virtual_strategy_gate_states",
  lots: "virtual_trade_lots",
  lotMatches: "virtual_trade_lot_matches",
  lotView: "virtual_position_lots",
} as const;

export const PORTFOLIO_LOT_COLUMNS = {
  positionId: "position_id",
  seedPositionId: "seed_position_id",
} as const;
