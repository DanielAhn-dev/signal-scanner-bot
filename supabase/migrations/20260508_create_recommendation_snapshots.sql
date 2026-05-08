BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  id TEXT PRIMARY KEY,
  recommendation_date TEXT NOT NULL,
  action_code TEXT NOT NULL,
  code TEXT NOT NULL,
  stock_name TEXT,
  reason TEXT,
  entry_score NUMERIC(5,2),
  recommendation_signal TEXT,
  snapshot_metadata JSONB DEFAULT '{}',
  forward_return_1d NUMERIC(6,2),
  forward_return_3d NUMERIC(6,2),
  forward_return_5d NUMERIC(6,2),
  forward_return_10d NUMERIC(6,2),
  evaluated_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_snapshots_date_code_idx
  ON recommendation_snapshots (recommendation_date, code);

CREATE INDEX IF NOT EXISTS recommendation_snapshots_created_idx
  ON recommendation_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS recommendation_snapshots_evaluated_count_idx
  ON recommendation_snapshots (evaluated_count);

COMMIT;
