-- 가상매매 v5: pnl_amount의 뜻을 하나로 통일한다(순손익 = 수수료·세금 반영).
-- 자동매매·텔레그램 매도는 원래 순손익(net - cost)을 pnl_amount로 저장했는데, 웹 수동매매 RPC만
-- 가격차 손익(수수료 전)을 저장해서 승률·누적 손익·초기화 재계산이 두 정의를 섞어 쓰고 있었다.
-- 화면의 "수수료 전 손익"은 pnl_amount + 수수료 + 세금 + 매수 수수료 몫으로 계산한다.

-- 과거 RPC 매도 행 보정: RPC는 pnl_amount를 로트 매칭 손익의 합과 같게 저장했다(수수료 전).
-- 수수료·세금이 있는 행 중 합이 같은 것만 순손익으로 바꾼다(한 번 바꾸면 합과 달라져 다시 바뀌지 않는다).
update public.virtual_trades t
   set pnl_amount = t.pnl_amount - coalesce(t.fee_amount, 0) - coalesce(t.tax_amount, 0) - coalesce(t.buy_fee_amount, 0)
 where t.side = 'SELL'
   and (coalesce(t.fee_amount, 0) + coalesce(t.tax_amount, 0)) > 0
   and exists (select 1 from public.virtual_trade_lot_matches m where m.trade_id = t.id)
   and t.pnl_amount = (select sum(m.pnl_amount) from public.virtual_trade_lot_matches m where m.trade_id = t.id);

create or replace function public.execute_virtual_trade(
  p_client_id text,
  p_chat_id bigint,
  p_code text,
  p_side text,
  p_quantity integer,
  p_price numeric,
  p_gross numeric,
  p_net numeric,
  p_fee numeric,
  p_tax numeric,
  p_broker_name text,
  p_account_name text,
  p_buy_date text,
  p_memo text,
  p_is_bot_account boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade record;
  v_position record;
  v_lot record;
  v_remaining integer;
  v_realized numeric := 0;
  v_take integer;
  v_cost numeric;
  v_new_quantity integer;
  v_new_invested numeric;
  v_next_cash numeric;
  v_next_realized numeric;
  v_result jsonb;
  v_prefs jsonb;
  v_cash numeric;
  v_realized_before numeric;
  v_held integer;
  v_buyfee numeric := 0;
begin
  if p_side not in ('BUY', 'SELL') then
    raise exception 'side must be BUY or SELL';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;
  if p_client_id is null and (p_chat_id is null or p_chat_id <= 0) then
    raise exception 'identity required';
  end if;

  -- 신원+종목 단위 직렬화(트랜잭션 끝에서 자동 해제)
  perform pg_advisory_xact_lock(hashtext(coalesce(p_client_id, 'chat:' || p_chat_id::text) || '|' || upper(trim(p_code))));

  -- 봇 계좌는 users 행을 잠가 현금·실현손익 read-modify-write 경쟁을 막는다.
  if p_is_bot_account and p_chat_id is not null then
    select prefs into v_prefs from public.users where tg_id = p_chat_id for update;
    v_cash := coalesce((v_prefs->>'virtual_cash')::numeric, 0);
    v_realized_before := coalesce((v_prefs->>'virtual_realized_pnl')::numeric, 0);
    if p_side = 'BUY' and v_prefs ? 'virtual_cash' and v_cash < p_net then
      raise exception 'insufficient virtual cash';
    end if;
  end if;

  if p_side = 'SELL' then
    select coalesce(sum(quantity), 0) into v_held
      from public.virtual_positions
     where ((p_client_id is not null and client_id = p_client_id)
        or (p_client_id is null and chat_id = p_chat_id))
       and upper(code) = upper(trim(p_code))
       and broker_name is not distinct from nullif(trim(p_broker_name), '')
       and account_name is not distinct from nullif(trim(p_account_name), '');
    if v_held < p_quantity then
      raise exception 'insufficient holdings';
    end if;
  end if;

  insert into public.virtual_trades (
    chat_id,
    client_id,
    code,
    side,
    price,
    quantity,
    gross_amount,
    net_amount,
    fee_amount,
    tax_amount,
    broker_name,
    account_name,
    memo
  ) values (
    p_chat_id,
    p_client_id,
    upper(trim(p_code)),
    p_side,
    p_price,
    p_quantity,
    p_gross,
    p_net,
    p_fee,
    p_tax,
    nullif(trim(p_broker_name), ''),
    nullif(trim(p_account_name), ''),
    p_memo
  )
  returning * into v_trade;

  if p_side = 'BUY' then
    select *
      into v_position
      from public.virtual_positions
     where ((p_client_id is not null and client_id = p_client_id)
        or (p_client_id is null and chat_id = p_chat_id))
       and upper(code) = upper(trim(p_code))
       and broker_name is not distinct from nullif(trim(p_broker_name), '')
       and account_name is not distinct from nullif(trim(p_account_name), '')
     order by id desc
     limit 1
     for update;

    if found then
      v_new_quantity := greatest(0, coalesce(v_position.quantity, 0)) + p_quantity;
      v_new_invested := coalesce(v_position.invested_amount, coalesce(v_position.quantity, 0) * greatest(0, coalesce(v_position.buy_price, 0))) + p_gross;
      update public.virtual_positions
         set quantity = v_new_quantity,
             invested_amount = v_new_invested,
             buy_price = round(v_new_invested / v_new_quantity),
             status = 'holding',
             buy_date = coalesce(v_position.buy_date, p_buy_date),
             broker_name = coalesce(nullif(trim(p_broker_name), ''), v_position.broker_name),
             account_name = coalesce(nullif(trim(p_account_name), ''), v_position.account_name)
       where id = v_position.id;
    else
      insert into public.virtual_positions (
        chat_id, client_id, code, quantity, invested_amount, buy_price,
        status, buy_date, broker_name, account_name
      ) values (
        p_chat_id, p_client_id, upper(trim(p_code)), p_quantity, p_gross, p_price,
        'holding', p_buy_date,
        nullif(trim(p_broker_name), ''), nullif(trim(p_account_name), '')
      )
      returning * into v_position;
    end if;

    insert into public.virtual_trade_lots (
      chat_id, client_id, code, position_id, acquired_price,
      acquired_quantity, remaining_quantity, acquired_at, buy_fee_amount
    ) values (
      p_chat_id, p_client_id, upper(trim(p_code)), v_position.id, p_price,
      p_quantity, p_quantity, now(), coalesce(p_fee, 0)
    );

    if p_is_bot_account and p_chat_id is not null then
      v_next_cash := greatest(0, round(v_cash - p_net));
      update public.users
         set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('virtual_cash', v_next_cash)
       where tg_id = p_chat_id;
    end if;
  else
    v_remaining := p_quantity;

    for v_lot in
      select l.*
        from public.virtual_trade_lots l
       where ((p_client_id is not null and l.client_id = p_client_id)
          or (p_client_id is null and l.chat_id = p_chat_id))
         and upper(l.code) = upper(trim(p_code))
         and l.remaining_quantity > 0
         and l.position_id in (
           select vp.id
             from public.virtual_positions vp
            where ((p_client_id is not null and vp.client_id = p_client_id)
               or (p_client_id is null and vp.chat_id = p_chat_id))
              and upper(vp.code) = upper(trim(p_code))
              and vp.broker_name is not distinct from nullif(trim(p_broker_name), '')
              and vp.account_name is not distinct from nullif(trim(p_account_name), '')
         )
       order by l.acquired_at asc, l.id asc
       limit 200
       for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, greatest(0, v_lot.remaining_quantity));
      v_cost := coalesce(v_lot.acquired_price, 0) * v_take;
      v_realized := v_realized + (p_price - coalesce(v_lot.acquired_price, 0)) * v_take;
      -- 이 로트를 살 때 낸 수수료 중 이번에 판 수량 몫
      v_buyfee := v_buyfee + coalesce(v_lot.buy_fee_amount, 0) * v_take / greatest(1, v_lot.acquired_quantity);

      insert into public.virtual_trade_lot_matches (
        trade_id, lot_id, chat_id, client_id, code, quantity,
        unit_cost, cost_amount, pnl_amount
      ) values (
        v_trade.id, v_lot.id, p_chat_id, p_client_id, upper(trim(p_code)),
        v_take, v_lot.acquired_price, v_cost,
        (p_price - coalesce(v_lot.acquired_price, 0)) * v_take
      );

      update public.virtual_trade_lots
         set remaining_quantity = greatest(0, v_lot.remaining_quantity - v_take),
             closed_at = case when v_lot.remaining_quantity - v_take <= 0 then now() else closed_at end
       where id = v_lot.id;

      if v_lot.position_id is not null then
        select * into v_position
          from public.virtual_positions
         where id = v_lot.position_id
         for update;
        if found then
          v_new_quantity := greatest(0, coalesce(v_position.quantity, 0) - v_take);
          v_new_invested := case
            when v_position.invested_amount is null then null
            else v_position.invested_amount - v_cost
          end;
          update public.virtual_positions
             set quantity = v_new_quantity,
                 invested_amount = v_new_invested,
                 status = case when v_new_quantity > 0 then 'holding' else 'interest' end
           where id = v_position.id;
        end if;
      end if;

      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      select * into v_position
        from public.virtual_positions
       where ((p_client_id is not null and client_id = p_client_id)
          or (p_client_id is null and chat_id = p_chat_id))
         and upper(code) = upper(trim(p_code))
         and broker_name is not distinct from nullif(trim(p_broker_name), '')
         and account_name is not distinct from nullif(trim(p_account_name), '')
       order by id desc
       limit 1
       for update;

      if found then
        v_take := least(greatest(0, coalesce(v_position.quantity, 0)), v_remaining);
        if v_take > 0 then
          v_cost := (coalesce(v_position.invested_amount, 0) / greatest(1, v_position.quantity)) * v_take;
          v_realized := v_realized + (p_price - coalesce(v_position.buy_price, 0)) * v_take;
          v_new_quantity := greatest(0, v_position.quantity - v_take);
          v_new_invested := greatest(0, coalesce(v_position.invested_amount, 0) - v_cost);
          update public.virtual_positions
             set quantity = v_new_quantity,
                 invested_amount = v_new_invested,
                 status = case when v_new_quantity > 0 then 'holding' else 'interest' end
           where id = v_position.id;
        end if;
      end if;
    end if;

    -- pnl_amount는 자동매매·텔레그램 매도와 같은 정의(수수료·세금·매수 수수료 몫을 모두 뺀 순손익)로 저장한다
    update public.virtual_trades
       set pnl_amount = v_realized - round(v_buyfee) - p_fee - p_tax,
           buy_fee_amount = round(v_buyfee)
     where id = v_trade.id;

    if p_is_bot_account and p_chat_id is not null then
      v_next_cash := round(v_cash + p_net);
      v_next_realized := v_realized_before + (v_realized - round(v_buyfee) - p_fee - p_tax);
      update public.users
         set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object(
           'virtual_cash', v_next_cash,
           'virtual_realized_pnl', v_next_realized
         )
       where tg_id = p_chat_id;
    end if;
  end if;

  select to_jsonb(t) into v_result
    from public.virtual_trades t
   where t.id = v_trade.id;
  return v_result;
end;
$$;

revoke all on function public.execute_virtual_trade(text, bigint, text, text, integer, numeric, numeric, numeric, numeric, numeric, text, text, text, text, boolean) from public;
grant execute on function public.execute_virtual_trade(text, bigint, text, text, integer, numeric, numeric, numeric, numeric, numeric, text, text, text, text, boolean) to service_role;
