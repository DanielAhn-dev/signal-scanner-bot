BEGIN;

CREATE TABLE IF NOT EXISTS ui_report_shares (
  id TEXT PRIMARY KEY,
  public_token TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  report_date TEXT NOT NULL,
  audience_key TEXT NOT NULL,
  invite_code_hash TEXT NOT NULL,
  body_text TEXT NOT NULL,
  source_label TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_accessed_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ui_report_shares_topic_created_idx
  ON ui_report_shares (topic, created_at DESC);

CREATE INDEX IF NOT EXISTS ui_report_shares_public_token_idx
  ON ui_report_shares (public_token);

CREATE INDEX IF NOT EXISTS ui_report_shares_active_idx
  ON ui_report_shares (expires_at, revoked_at);

COMMIT;
