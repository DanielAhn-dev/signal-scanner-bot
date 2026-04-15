-- jobs 테이블: Telegram 업데이트 비동기 처리 큐
CREATE TABLE IF NOT EXISTS jobs (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     JSONB,
  status      TEXT NOT NULL DEFAULT 'queued',
  dedup_key   TEXT,
  ok          BOOLEAN,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- 중복 방지용 unique 인덱스 (dedup_key가 NULL이 아닐 때만 적용)
CREATE UNIQUE INDEX IF NOT EXISTS jobs_type_dedup_key_idx
  ON jobs (type, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 처리 대기 잡 조회 최적화
CREATE INDEX IF NOT EXISTS jobs_status_created_idx
  ON jobs (status, created_at ASC);

-- RLS 비활성화 (내부 큐 테이블, anon key INSERT / service role SELECT·UPDATE 사용)
ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;
