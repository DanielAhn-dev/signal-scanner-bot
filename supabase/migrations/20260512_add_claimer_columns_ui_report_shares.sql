BEGIN;

ALTER TABLE ui_report_shares
  ADD COLUMN IF NOT EXISTS claimer_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS ui_report_shares_claimer_idx
  ON ui_report_shares (claimer_token_hash)
  WHERE claimer_token_hash IS NOT NULL;

COMMIT;
