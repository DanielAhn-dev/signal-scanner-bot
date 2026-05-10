-- 공매도 / 신용 일별 이력 테이블
-- 장 마감 후 Python ETL(update_credit_short.py)이 기록
CREATE TABLE IF NOT EXISTS stock_credit_short_daily (
  code         TEXT    NOT NULL,
  date         DATE    NOT NULL,
  credit_ratio NUMERIC,        -- 신용비율 (%) from Naver Finance
  short_ratio  NUMERIC,        -- 공매도 잔고비율 (%) from KRX
  short_balance BIGINT,        -- 공매도 잔고 수량 (주) from KRX
  short_volume  BIGINT,        -- 당일 공매도 거래량 (주) from KRX
  PRIMARY KEY (code, date)
);

CREATE INDEX IF NOT EXISTS idx_credit_short_daily_code_date
  ON stock_credit_short_daily (code, date DESC);

-- stocks 테이블에 최신 값 칼럼 추가 (ETL이 update 후 API가 바로 읽음)
ALTER TABLE stocks
  ADD COLUMN IF NOT EXISTS credit_ratio  NUMERIC,
  ADD COLUMN IF NOT EXISTS short_ratio   NUMERIC,
  ADD COLUMN IF NOT EXISTS short_balance BIGINT;

COMMENT ON COLUMN stocks.credit_ratio  IS '신용비율 (%) - 신용잔고/상장주식수';
COMMENT ON COLUMN stocks.short_ratio   IS '공매도 잔고비율 (%) - KRX 기준';
COMMENT ON COLUMN stocks.short_balance IS '공매도 잔고 수량 (주) - KRX 기준';
