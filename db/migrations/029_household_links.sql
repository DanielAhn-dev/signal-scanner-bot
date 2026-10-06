-- 부부(배우자) 연결. 한 사람은 동시에 한 명과만 연결된다.
--  - household_links: 연결 요청(코드)과 연결 이력. 코드는 1회용, 기간이 지나면 못 쓴다.
--  - household_members: 지금 연결된 사람 → 연결 id. client_id가 기본키라 두 사람과 동시에 연결될 수 없다.
--  - 무엇을 보여 줄지(지출·투자·자녀)는 각자 자기 것만 정한다(inviter_shares / invitee_shares).
--  - 연결을 끊어도 각자 기록은 각자 계정에 그대로 남는다. 서로의 데이터를 복사하지 않고, 연결된 동안 읽기만 한다.
-- 수락·해제는 아래 함수로만 한다(여러 표를 한 번에 바꿔야 해서). service_role만 실행할 수 있다.

create table if not exists public.household_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  inviter_client_id text not null,
  invitee_client_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'ended', 'cancelled')),
  inviter_shares jsonb not null default '{"spending": true, "investing": true, "children": true}'::jsonb,
  invitee_shares jsonb not null default '{"spending": true, "investing": true, "children": true}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  ended_at timestamptz,
  ended_by_client_id text,
  check (invitee_client_id is null or invitee_client_id <> inviter_client_id)
);

create index if not exists household_links_inviter_idx on public.household_links (inviter_client_id, status);
create index if not exists household_links_invitee_idx on public.household_links (invitee_client_id, status);

create table if not exists public.household_members (
  client_id text primary key,
  link_id uuid not null references public.household_links (id) on delete cascade,
  joined_at timestamptz not null default now()
);

create index if not exists household_members_link_idx on public.household_members (link_id);

alter table public.household_links enable row level security;
alter table public.household_members enable row level security;

create policy household_links_service_role_all on public.household_links for all to service_role using (true) with check (true);
create policy household_members_service_role_all on public.household_members for all to service_role using (true) with check (true);

-- 코드로 연결 수락. 결과: {ok, reason?, link_id?}
create or replace function public.accept_household_link(p_code text, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.household_links%rowtype;
begin
  select * into l from public.household_links where code = p_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if l.inviter_client_id = p_client_id then
    return jsonb_build_object('ok', false, 'reason', 'own_code');
  end if;
  if l.status <> 'pending' or l.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'used_or_expired');
  end if;
  if exists (select 1 from public.household_members where client_id in (l.inviter_client_id, p_client_id)) then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;

  begin
    insert into public.household_members (client_id, link_id) values (l.inviter_client_id, l.id), (p_client_id, l.id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end;

  update public.household_links
     set status = 'active', invitee_client_id = p_client_id, accepted_at = now()
   where id = l.id;

  -- 두 사람이 따로 만들어 둔 다른 요청은 무효로
  update public.household_links
     set status = 'cancelled', ended_at = now()
   where status = 'pending' and id <> l.id and inviter_client_id in (l.inviter_client_id, p_client_id);

  return jsonb_build_object('ok', true, 'link_id', l.id);
end;
$$;

-- 연결 끊기. 둘 중 누구나 할 수 있다. 결과: {ok, reason?}
create or replace function public.end_household_link(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link uuid;
begin
  select link_id into v_link from public.household_members where client_id = p_client_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;
  delete from public.household_members where link_id = v_link;
  update public.household_links
     set status = 'ended', ended_at = now(), ended_by_client_id = p_client_id
   where id = v_link and status = 'active';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.accept_household_link(text, text) from public, anon, authenticated;
revoke all on function public.end_household_link(text) from public, anon, authenticated;
grant execute on function public.accept_household_link(text, text) to service_role;
grant execute on function public.end_household_link(text) to service_role;
