-- 공개 마켓 데이터 테이블 RLS 활성화
-- 시장 데이터는 공개 정보이므로 anon SELECT 허용, 쓰기는 service_role 전용

-- ─── stocks ───
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stocks_anon_read" ON public.stocks;
CREATE POLICY "stocks_anon_read" ON public.stocks FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "stocks_service_write" ON public.stocks;
CREATE POLICY "stocks_service_write" ON public.stocks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── sectors ───
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sectors_anon_read" ON public.sectors;
CREATE POLICY "sectors_anon_read" ON public.sectors FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "sectors_service_write" ON public.sectors;
CREATE POLICY "sectors_service_write" ON public.sectors FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── sector_daily ───
ALTER TABLE public.sector_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sector_daily_anon_read" ON public.sector_daily;
CREATE POLICY "sector_daily_anon_read" ON public.sector_daily FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "sector_daily_service_write" ON public.sector_daily;
CREATE POLICY "sector_daily_service_write" ON public.sector_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── scores ───
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scores_anon_read" ON public.scores;
CREATE POLICY "scores_anon_read" ON public.scores FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "scores_service_write" ON public.scores;
CREATE POLICY "scores_service_write" ON public.scores FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── daily_indicators ───
ALTER TABLE public.daily_indicators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_indicators_anon_read" ON public.daily_indicators;
CREATE POLICY "daily_indicators_anon_read" ON public.daily_indicators FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "daily_indicators_service_write" ON public.daily_indicators;
CREATE POLICY "daily_indicators_service_write" ON public.daily_indicators FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── investor_daily ───
ALTER TABLE public.investor_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "investor_daily_anon_read" ON public.investor_daily;
CREATE POLICY "investor_daily_anon_read" ON public.investor_daily FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "investor_daily_service_write" ON public.investor_daily;
CREATE POLICY "investor_daily_service_write" ON public.investor_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── stock_daily ───
ALTER TABLE public.stock_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_daily_anon_read" ON public.stock_daily;
CREATE POLICY "stock_daily_anon_read" ON public.stock_daily FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "stock_daily_service_write" ON public.stock_daily;
CREATE POLICY "stock_daily_service_write" ON public.stock_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── cache ───
ALTER TABLE public.cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cache_anon_read" ON public.cache;
CREATE POLICY "cache_anon_read" ON public.cache FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "cache_service_write" ON public.cache;
CREATE POLICY "cache_service_write" ON public.cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 참고: watchlist는 virtual_positions의 compatibility VIEW이므로 RLS 적용 불가
-- virtual_positions 테이블에는 이미 RLS가 적용되어 있음
