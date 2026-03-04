-- =============================================
-- pullback_signals 테이블 생성
-- 눌림목 매집 시그널 전용 테이블
-- Supabase SQL Editor에서 실행
-- =============================================

-- 1) 테이블 생성
CREATE TABLE IF NOT EXISTS pullback_signals (
  code        TEXT        NOT NULL REFERENCES stocks(code) ON DELETE CASCADE,
  trade_date  DATE        NOT NULL,

  -- 진입 등급 (A/B/C)
  entry_grade TEXT        NOT NULL DEFAULT 'C',
  entry_score SMALLINT    NOT NULL DEFAULT 0,  -- 0~4

  -- 세부 진입 조건 등급 (A/B/C)
  trend_grade TEXT        NOT NULL DEFAULT 'C',
  dist_grade  TEXT        NOT NULL DEFAULT 'C',
  pivot_grade TEXT        NOT NULL DEFAULT 'C',
  vol_atr_grade TEXT      NOT NULL DEFAULT 'C',

  -- 이격도 (%)
  dist_pct    REAL        NOT NULL DEFAULT 0,

  -- 이동평균
  ma21        REAL,
  ma50        REAL,

  -- 매도 경고 등급 (SAFE/WATCH/WARN/SELL)
  warn_grade  TEXT        NOT NULL DEFAULT 'SAFE',
  warn_score  SMALLINT    NOT NULL DEFAULT 0,  -- 0~6

  -- 개별 경고 플래그
  warn_overheat   BOOLEAN NOT NULL DEFAULT FALSE,
  warn_vol_spike  BOOLEAN NOT NULL DEFAULT FALSE,
  warn_atr_spike  BOOLEAN NOT NULL DEFAULT FALSE,
  warn_rsi_ob     BOOLEAN NOT NULL DEFAULT FALSE,
  warn_ma_break   BOOLEAN NOT NULL DEFAULT FALSE,
  warn_dead_cross BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (code, trade_date)
);

-- 2) 인덱스: 진입 등급 + 날짜로 빠르게 필터
CREATE INDEX IF NOT EXISTS idx_pullback_entry_grade
  ON pullback_signals (trade_date, entry_grade);

-- 경고 등급 인덱스
CREATE INDEX IF NOT EXISTS idx_pullback_warn_grade
  ON pullback_signals (trade_date, warn_grade);

-- 복합 필터 (entry A/B + warn != SELL)
CREATE INDEX IF NOT EXISTS idx_pullback_candidates
  ON pullback_signals (trade_date, entry_grade, warn_grade);

-- 3) updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_pullback_signals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pullback_signals_updated_at ON pullback_signals;
CREATE TRIGGER trg_pullback_signals_updated_at
  BEFORE UPDATE ON pullback_signals
  FOR EACH ROW
  EXECUTE FUNCTION update_pullback_signals_updated_at();

-- 4) RLS 정책 (Supabase 기본)
ALTER TABLE pullback_signals ENABLE ROW LEVEL SECURITY;

-- anon/authenticated 읽기 허용
CREATE POLICY "pullback_signals_select"
  ON pullback_signals FOR SELECT
  USING (true);

-- service_role만 쓰기 허용
CREATE POLICY "pullback_signals_insert"
  ON pullback_signals FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "pullback_signals_update"
  ON pullback_signals FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "pullback_signals_delete"
  ON pullback_signals FOR DELETE
  USING (auth.role() = 'service_role');

-- 5) 코멘트
COMMENT ON TABLE pullback_signals IS '눌림목 매집 시그널 (PineScript v6 포팅)';
COMMENT ON COLUMN pullback_signals.entry_grade IS '진입 종합 등급 (A=3~4/4, B=2/4, C=0~1/4)';
COMMENT ON COLUMN pullback_signals.entry_score IS '진입 조건 충족 수 (0~4)';
COMMENT ON COLUMN pullback_signals.warn_grade IS '매도 경고 등급 (SAFE=0, WATCH=1, WARN=2, SELL=3+)';
COMMENT ON COLUMN pullback_signals.warn_score IS '매도 경고 충족 수 (0~6)';
COMMENT ON COLUMN pullback_signals.dist_pct IS 'MA21 이격도 (%)';
