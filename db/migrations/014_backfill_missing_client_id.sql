-- Backfill client_id for rows created after migration 012's one-time backfill ran.
-- appendVirtualDecisionLog/executeOrder did not set client_id until now, so any
-- auto-trade decision logs / trades written since then are invisible to the
-- client_id-scoped web UI even though chat_id is populated correctly.

do $$
begin
  if to_regclass('public.web_user_profiles') is not null then
    if to_regclass('public.virtual_decision_logs') is not null then
      execute '
        update public.virtual_decision_logs t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_trades') is not null then
      execute '
        update public.virtual_trades t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;

    if to_regclass('public.virtual_trade_lots') is not null then
      execute '
        update public.virtual_trade_lots t
           set client_id = p.client_id
          from public.web_user_profiles p
         where t.client_id is null
           and t.chat_id is not null
           and p.telegram_id is not null
           and p.telegram_id::bigint = t.chat_id';
    end if;
  end if;
end $$;
