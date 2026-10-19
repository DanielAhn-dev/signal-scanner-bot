-- stocks에 상품 유형과 ETF 과세 분류를 둔다.
-- 지금은 ETF 여부를 운용사 브랜드 이름 정규식(src/lib/securitiesTax.ts ETF_BRAND_PATTERN)으로,
-- 매매차익 과세 대상(기타 ETF)을 코드 4개 목록(OTHER_ETF_CODES)으로 판정한다. 그래서 해외주식·채권·금 ETF
-- (TIGER 미국S&P500·KIWOOM 국고채10년·ACE KRX금현물 등)는 가상매매·리포트에서 매매차익 15.4%가 빠진다.
-- 값은 일일 배치(scripts/batch_modules/market_snapshot.py)가 네이버에서 채운다:
--   product_type  ← 네이버 모바일 시세 stockEndType (stock | etf | etn, 그 밖은 other)
--   etf_category  ← 네이버 ETF 목록(finance.naver.com/api/sise/etfItemList.nhn) etfTabCode
--                   1 국내 시장지수 · 2 국내 업종/테마 · 3 국내 파생(레버리지·인버스) · 4 해외 주식 · 5 원자재 · 6 채권 · 7 기타(혼합 등)
--   etf_tax_class ← etf_category 1·2 → domestic_equity(매매차익 비과세), 3~7 → other(매매차익 배당소득세 15.4%)
--                   예외(운용사 공시 과세 유형과 다른 상품)는 코드 쪽 덮어쓰기 목록이 우선한다.
-- null은 "아직 모름" — 코드는 지금처럼 이름 규칙으로 대신 판정한다.

alter table public.stocks
  add column if not exists product_type text,
  add column if not exists etf_category smallint,
  add column if not exists etf_tax_class text,
  add column if not exists product_type_updated_at timestamptz;

alter table public.stocks drop constraint if exists stocks_product_type_check;
alter table public.stocks add constraint stocks_product_type_check
  check (product_type is null or product_type in ('stock', 'etf', 'etn', 'other'));

alter table public.stocks drop constraint if exists stocks_etf_category_check;
alter table public.stocks add constraint stocks_etf_category_check
  check (etf_category is null or etf_category between 1 and 7);

alter table public.stocks drop constraint if exists stocks_etf_tax_class_check;
alter table public.stocks add constraint stocks_etf_tax_class_check
  check (etf_tax_class is null or etf_tax_class in ('domestic_equity', 'other'));

-- ETF가 아닌 행에 ETF 분류가 붙지 않게
alter table public.stocks drop constraint if exists stocks_etf_fields_only_for_etf_check;
alter table public.stocks add constraint stocks_etf_fields_only_for_etf_check
  check ((etf_category is null and etf_tax_class is null) or product_type = 'etf');

comment on column public.stocks.product_type is '상품 유형 stock|etf|etn|other (네이버 stockEndType, 일일 배치). null=미확인';
comment on column public.stocks.etf_category is '네이버 ETF 분류 etfTabCode 1~7 (1 국내지수 2 국내업종 3 국내파생 4 해외주식 5 원자재 6 채권 7 기타)';
comment on column public.stocks.etf_tax_class is 'ETF 매매차익 과세: domestic_equity=비과세, other=배당소득세 15.4% (일반 계좌 기준)';
comment on column public.stocks.product_type_updated_at is 'product_type·etf_* 마지막 갱신 시각';

-- 첫 배치 전에도 쓰도록 지금 다루는 ETF를 미리 채운다 (2026-10-19 네이버 ETF 목록 etfTabCode 확인값).
-- stocks에 없는 코드는 건너뛴다(행을 새로 만들지 않음).
update public.stocks s
set product_type = 'etf',
    etf_category = v.category,
    etf_tax_class = case when v.category in (1, 2) then 'domestic_equity' else 'other' end,
    product_type_updated_at = now()
from (values
  ('069500', 1), -- KODEX 200
  ('102110', 1), -- TIGER 200
  ('148020', 1), -- RISE 200
  ('105190', 1), -- ACE 200
  ('152100', 1), -- PLUS 200
  ('069660', 1), -- KIWOOM 200
  ('293180', 1), -- HANARO 200
  ('278530', 1), -- KODEX 200TR
  ('294400', 1), -- KIWOOM 200TR
  ('295040', 1), -- SOL 200TR
  ('361580', 1), -- RISE 200TR
  ('310960', 1), -- TIGER 200TR
  ('332930', 1), -- HANARO 200TR
  ('332500', 1), -- ACE 200TR
  ('491220', 1), -- PLUS 200TR
  ('229200', 1), -- KODEX 코스닥150
  ('133690', 4), -- TIGER 미국나스닥100
  ('360750', 4), -- TIGER 미국S&P500
  ('411060', 5), -- ACE KRX금현물
  ('148070', 6), -- KIWOOM 국고채10년
  ('453850', 6), -- ACE 미국30년국채액티브(H)
  ('308620', 6), -- KODEX 미국10년국채선물
  ('459580', 6), -- KODEX CD금리액티브(합성)
  ('357870', 6), -- TIGER CD금리투자KIS(합성)
  ('423160', 6), -- KODEX KOFR금리액티브(합성)
  ('122630', 3)  -- KODEX 레버리지
) as v(code, category)
where s.code = v.code;

-- 일일 배치가 한 번의 호출로 바뀐 행만 고치게 하는 함수.
-- upsert는 없는 코드면 행을 만들고(name 등 필수값 없이) 다른 컬럼까지 건드릴 수 있어 쓰지 않는다.
-- 입력: [{"code":"069500","product_type":"etf","etf_category":1,"etf_tax_class":"domestic_equity"}, ...]
-- 반환: 실제로 바뀐 행 수. 값이 같으면 갱신 시각도 건드리지 않는다.
create or replace function public.apply_stock_product_types(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;

  update public.stocks s
  set product_type = r.product_type,
      etf_category = r.etf_category,
      etf_tax_class = r.etf_tax_class,
      product_type_updated_at = now()
  from jsonb_to_recordset(p_rows) as r(code text, product_type text, etf_category smallint, etf_tax_class text)
  where s.code = r.code
    and (s.product_type is distinct from r.product_type
      or s.etf_category is distinct from r.etf_category
      or s.etf_tax_class is distinct from r.etf_tax_class);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_stock_product_types(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stock_product_types(jsonb) to service_role;
