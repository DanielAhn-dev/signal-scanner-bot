-- ETF 분배금 이력 (운용사 분배금 엑셀을 관리자가 올리면 저장 → 가이드가 분배율·안정성·추세를 여기서 계산)
-- 업로드: 웹 관리자 화면 → /api/ui?route=distribution-upload (src/lib/distributionImport.ts가 파싱)
-- 읽기: 서버(service role)만. 공개 시장 데이터지만 anon 키로 직접 읽지 않고 가이드 API가 계산해서 내려준다.
--
-- 기준키 (code, record_date): 같은 파일을 다시 올려도 중복되지 않고 최신 값으로 갱신된다.
-- per_share는 세전 주당 분배금(원). rate_pct는 파일에 있을 때만(운용사 기준 분배율, 없으면 null).
-- source_file은 어느 파일에서 왔는지 기록용(잘못 올렸을 때 되돌릴 근거).

create table if not exists public.etf_distributions (
  code text not null check (char_length(code) between 4 and 10),
  record_date date not null,
  pay_date date,
  per_share numeric not null check (per_share > 0),
  rate_pct numeric,
  source_file text not null default '' check (char_length(source_file) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (code, record_date),
  check (pay_date is null or pay_date >= record_date)
);

create index if not exists etf_distributions_code_date_idx
  on public.etf_distributions (code, record_date desc);

-- 공개 정책 없음: anon 키로는 읽지도 쓰지도 못하고 서버(service role)만 다룬다
alter table public.etf_distributions enable row level security;
