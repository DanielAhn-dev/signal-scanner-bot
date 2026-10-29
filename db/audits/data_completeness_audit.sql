-- 데이터 채움 현황 조사 (조회 전용 — 아무것도 바꾸지 않는다)
-- Supabase SQL Editor에서 쿼리를 하나씩 실행해 결과를 보낸다.
-- stocks는 환경마다 컬럼이 달라(eps·bps 없음 확인됨) to_jsonb로 읽어, 없는 컬럼이 있어도 쿼리가 실패하지 않게 했다.

-- ── Q0. stocks에 실제로 있는 컬럼 ──────────────────────────────────────
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'stocks'
order by ordinal_position;

-- ── Q1. 활성 종목의 핵심 값 공백 (stocks) ───────────────────────────────
-- 없는 컬럼은 전부 공백으로 센다. 분모는 활성 종목 수.
select
  count(*)                                                                         as active_stocks,
  count(*) filter (where nullif(to_jsonb(s)->>'market_cap', '') is null)           as no_market_cap,
  count(*) filter (where nullif(to_jsonb(s)->>'per', '') is null)                  as no_per,
  count(*) filter (where nullif(to_jsonb(s)->>'pbr', '') is null)                  as no_pbr,
  count(*) filter (where nullif(to_jsonb(s)->>'sector_id', '') is null)            as no_sector,
  count(*) filter (where coalesce((to_jsonb(s)->>'close')::numeric, 0) <= 0)       as no_close,
  count(*) filter (where name is null or btrim(name) = '' or btrim(name) = code)   as bad_name,
  count(*) filter (where nullif(to_jsonb(s)->>'product_type', '') is null)         as no_product_type
from stocks s
where coalesce((to_jsonb(s)->>'is_active')::boolean, true);

-- ── Q2. 재무(fundamentals): 날짜별 채움 (최근 21일) ─────────────────────
select as_of::date as d, count(*) as rows,
       count(per) as per_filled, count(pbr) as pbr_filled,
       count(roe) as roe_filled, count(debt_ratio) as debt_filled,
       min(source) as source
from fundamentals
where as_of >= now() - interval '21 days'
group by 1 order by 1 desc;

-- ── Q3. 재무: 종목별로 '값이 채워진 가장 최근 행'이 언제인가 ─────────────
-- 활성 종목 중 값이 있는 행이 한 번도 없는 종목 / 오래된 종목이 몇 개인지.
with last_valued as (
  select code, max(as_of) as last_as_of
  from fundamentals
  where per is not null or pbr is not null or roe is not null or debt_ratio is not null
  group by code
)
select
  count(*)                                                       as active_stocks,
  count(*) filter (where lv.last_as_of is null)                  as never_valued,
  count(*) filter (where lv.last_as_of < now() - interval '30 days') as older_than_30d,
  count(*) filter (where lv.last_as_of >= now() - interval '14 days') as fresh_14d
from stocks s
left join last_valued lv on lv.code = s.code
where coalesce((to_jsonb(s)->>'is_active')::boolean, true)
  and coalesce(to_jsonb(s)->>'product_type', 'stock') = 'stock';

-- ── Q4. 시가총액 상위 300에서 재무 공백 (봇 후보에 가까운 종목들) ─────────
with top300 as (
  select code
  from stocks s
  where coalesce((to_jsonb(s)->>'is_active')::boolean, true)
    and coalesce(to_jsonb(s)->>'product_type', 'stock') = 'stock'
    and nullif(to_jsonb(s)->>'market_cap', '') is not null
  order by (to_jsonb(s)->>'market_cap')::numeric desc
  limit 300
),
last_valued as (
  select code, max(as_of) as last_as_of
  from fundamentals
  where per is not null or roe is not null
  group by code
)
select count(*) as top300,
       count(*) filter (where lv.last_as_of is null) as never_valued,
       count(*) filter (where lv.last_as_of < now() - interval '30 days') as older_than_30d
from top300 t left join last_valued lv on lv.code = t.code;

-- ── Q5. 일봉·지표·점수: 최신 날짜의 유니버스 대비 채움 ───────────────────
with u as (
  select code from stocks
  where universe_level in ('core', 'extended') and is_active
)
select
  (select count(*) from u)                                                       as universe,
  (select max(date) from stock_daily)                                            as daily_latest,
  (select count(*) from stock_daily d where d.date = (select max(date) from stock_daily)
     and d.ticker in (select code from u))                                       as daily_in_universe,
  (select max(trade_date) from daily_indicators)                                 as ind_latest,
  (select count(*) from daily_indicators i where i.trade_date = (select max(trade_date) from daily_indicators)
     and i.code in (select code from u))                                         as ind_in_universe,
  (select max(asof) from scores)                                                 as score_latest;

-- ── Q6. 일봉에 가격·거래량이 비정상인 종목 (최신일) ──────────────────────
select count(*) as rows,
       count(*) filter (where coalesce(close, 0) <= 0)  as bad_close,
       count(*) filter (where coalesce(volume, 0) = 0)  as zero_volume
from stock_daily
where date = (select max(date) from stock_daily);

-- ── Q7. 공매도·신용: 최신일 상태 분포 ───────────────────────────────────
select date, volume_status, balance_status, count(*)
from stock_credit_short_daily
where date = (select max(date) from stock_credit_short_daily)
group by 1, 2, 3 order by 4 desc;
