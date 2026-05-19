-- 백테스터 성능 최적화: 스코어/가격 조회 인덱스 추가

-- scores 테이블 인덱스: asof 기준 조회 (backtest-risers의 주요 병목)
CREATE INDEX IF NOT EXISTS idx_scores_asof_desc 
  ON scores(asof DESC);

-- scores 테이블 인덱스: code+asof 복합 (시계열 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_scores_code_asof 
  ON scores(code, asof DESC);

-- stock_daily 테이블 인덱스: date 조회 (가격 데이터 조회)
CREATE INDEX IF NOT EXISTS idx_stock_daily_date_desc 
  ON stock_daily(date DESC);

-- stock_daily 테이블 인덱스: ticker+date 복합 (가장 많이 사용되는 조합)
CREATE INDEX IF NOT EXISTS idx_stock_daily_ticker_date 
  ON stock_daily(ticker, date DESC);

-- 선택사항: 매우 큰 테이블인 경우 BRIN 인덱스 (더 효율적)
-- 주의: 이미 일반 B-tree 인덱스가 있으면 충돌할 수 있음
-- CREATE INDEX IF NOT EXISTS idx_scores_asof_brin 
--   ON scores USING BRIN (asof);

-- 통계 업데이트 (쿼리 플래너 최적화)
ANALYZE scores;
ANALYZE stock_daily;
ANALYZE stocks;
