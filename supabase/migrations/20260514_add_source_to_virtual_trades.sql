-- 20260514_add_source_to_virtual_trades.sql
-- 거래 출처 필드 추가: 자동매매(AUTO) vs 수동입력(MANUAL) 구분

BEGIN;

-- virtual_trades 테이블에 source 컬럼 추가
ALTER TABLE public.virtual_trades
  ADD COLUMN IF NOT EXISTS source TEXT CHECK (source IN ('MANUAL', 'AUTO', 'ADJUST')) DEFAULT 'MANUAL';

COMMENT ON COLUMN public.virtual_trades.source IS '거래 출처: MANUAL(사용자 수동 입력), AUTO(자동매매), ADJUST(포지션 수정)';

-- 인덱스 추가: source로 필터링할 때 성능 개선
CREATE INDEX IF NOT EXISTS idx_virtual_trades_source 
  ON public.virtual_trades(chat_id, source, traded_at DESC);

-- 기존 데이터 마이그레이션: memo 기반 source 판정
UPDATE public.virtual_trades
SET source = 'AUTO'
WHERE source = 'MANUAL'
  AND memo LIKE '%autotrade%'
  AND broker_name IS NULL
  AND account_name IS NULL;

UPDATE public.virtual_trades
SET source = 'ADJUST'
WHERE source = 'MANUAL'
  AND memo LIKE '%web-edit%';

COMMIT;
