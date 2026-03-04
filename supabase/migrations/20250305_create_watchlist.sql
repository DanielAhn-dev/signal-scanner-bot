-- 관심종목(watchlist) 테이블 생성
-- Supabase SQL Editor에서 실행

-- 테이블 생성
CREATE TABLE IF NOT EXISTS public.watchlist (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id     bigint NOT NULL,                     -- 텔레그램 chat_id
  code        text   NOT NULL REFERENCES public.stocks(code),
  buy_price   numeric,                             -- 매수가 (선택)
  buy_date    date DEFAULT CURRENT_DATE,            -- 매수일
  memo        text,                                -- 메모 (선택)
  created_at  timestamptz DEFAULT now()
);

-- 유니크 제약: 한 유저에 같은 종목 중복 불가
ALTER TABLE public.watchlist
  ADD CONSTRAINT watchlist_chat_code_uq UNIQUE (chat_id, code);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_watchlist_chat_id ON public.watchlist(chat_id);

-- updated_at 트리거 (선택)
-- ALTER TABLE public.watchlist ADD COLUMN updated_at timestamptz DEFAULT now();

-- RLS (Row Level Security)
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

-- anon 읽기 (chat_id 기반 필터는 앱에서 처리)
CREATE POLICY "watchlist_anon_read"
  ON public.watchlist FOR SELECT
  TO anon
  USING (true);

-- service_role 쓰기
CREATE POLICY "watchlist_service_write"
  ON public.watchlist FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 코멘트
COMMENT ON TABLE  public.watchlist IS '관심종목 포트폴리오 (가상 매매)';
COMMENT ON COLUMN public.watchlist.chat_id   IS '텔레그램 chat_id';
COMMENT ON COLUMN public.watchlist.code      IS '종목코드 (stocks FK)';
COMMENT ON COLUMN public.watchlist.buy_price IS '가상 매수가 (원)';
COMMENT ON COLUMN public.watchlist.buy_date  IS '매수 기록일';
COMMENT ON COLUMN public.watchlist.memo      IS '사용자 메모';
