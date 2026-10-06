-- 부부가 서로의 지출 기록을 고치거나 지울 수 있게 하면서, 누가 했는지 남긴다.
--  - updated_by_client_id: 마지막으로 고친 사람. 기록한 사람과 다르면 화면에 "배우자가 고침"으로 보인다.
--  - 지우기는 표시만 한다(deleted_at). 합계에서는 빠지고 "지운 기록"에서 둘 다 되돌릴 수 있다.
alter table public.money_flow_entries
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by_client_id text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_client_id text;
