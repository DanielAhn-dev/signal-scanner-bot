-- 2026-04-30: Add executed_operations and virtual_autotrade_locks

BEGIN;

CREATE TABLE IF NOT EXISTS executed_operations (
  op_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  strategy TEXT,
  meta JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS executed_operations_user_id_idx ON executed_operations(user_id);

CREATE TABLE IF NOT EXISTS virtual_autotrade_locks (
  op_key TEXT PRIMARY KEY,
  acquired_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMIT;
