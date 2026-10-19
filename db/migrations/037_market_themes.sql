-- 오늘 시장 브리핑의 테마 흐름 (웹 '오늘 시장', 계산 src/lib/themeFlow.ts)
-- 네이버 모바일 테마(약 260개, 네이버가 언론에 뜨는 테마를 새로 추가한다)를 장 마감 뒤 하루 한 번 저장한다.
-- 수집: scripts/collect_market_themes.ts (GitHub Actions market_themes.yml). 서버만 service role로 읽고 쓴다.
--
-- market_themes — 테마별 최신 구성 종목. first_seen은 처음 본 거래일(첫 수집 뒤에 생긴 테마에 '새로 등장' 표시).
-- theme_daily   — 거래일별 테마 등락·상승 종목 수·거래대금 합계·주요 뉴스 제목 언급 수(제목·링크 최대 3건).
--                 하루 약 260행, 400일 지난 행은 수집 스크립트가 지운다.

create table if not exists public.market_themes (
  theme_no integer primary key,
  name text not null,
  member_codes text[] not null default '{}',
  first_seen date not null,
  last_seen date not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.theme_daily (
  trade_date date not null,
  theme_no integer not null,
  change_rate numeric not null,
  rise_count integer not null default 0,
  fall_count integer not null default 0,
  total_count integer not null default 0,
  trading_value bigint not null default 0,
  news_count integer not null default 0,
  news jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (trade_date, theme_no)
);

create index if not exists theme_daily_trade_date_idx on public.theme_daily (trade_date desc);

-- 공개 정책 없음: anon 키로는 읽지 못하고 서버(service role)만 쓴다
alter table public.market_themes enable row level security;
alter table public.theme_daily enable row level security;
