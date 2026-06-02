-- reset_virtual_autotrade_user.sql
-- Purpose: Hard-reset one user's virtual autotrade state for a clean restart.
-- Scope: user-scoped data only (chat_id).
--
-- Usage:
-- 1) Update target_chat_id below.
-- 2) Run in Supabase SQL editor (service_role context).
-- 3) Verify NOTICE counts before/after in the execution log.

BEGIN;

DO $$
DECLARE
  target_chat_id bigint := 0; -- TODO: set target Telegram chat_id (e.g. 8311154094)
  preserve_seed_capital boolean := true;
  user_exists boolean := false;
  seed_capital numeric := 0;
BEGIN
  IF target_chat_id <= 0 THEN
    RAISE EXCEPTION 'Set target_chat_id to a positive bigint before running this script.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE tg_id = target_chat_id
  ) INTO user_exists;

  IF NOT user_exists THEN
    RAISE EXCEPTION 'users.tg_id=% not found. Aborting.', target_chat_id;
  END IF;

  RAISE NOTICE '=== PRE-CHECK COUNTS (chat_id=%) ===', target_chat_id;
  RAISE NOTICE 'virtual_positions: %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_trades: %', (
    SELECT COUNT(*) FROM public.virtual_trades WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_trade_lots: %', (
    SELECT COUNT(*) FROM public.virtual_trade_lots WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_trade_lot_matches(by trade): %', (
    SELECT COUNT(*)
    FROM public.virtual_trade_lot_matches m
    WHERE EXISTS (
      SELECT 1 FROM public.virtual_trades t
      WHERE t.id = m.trade_id
        AND t.chat_id = target_chat_id
    )
  );
  RAISE NOTICE 'virtual_decision_logs: %', (
    SELECT COUNT(*) FROM public.virtual_decision_logs WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_autotrade_runs: %', (
    SELECT COUNT(*) FROM public.virtual_autotrade_runs WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_autotrade_actions: %', (
    SELECT COUNT(*) FROM public.virtual_autotrade_actions WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_strategy_gate_states: %', (
    SELECT COUNT(*) FROM public.virtual_strategy_gate_states WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'portfolio_snapshots: %', (
    SELECT COUNT(*) FROM public.portfolio_snapshots WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'stop_loss_take_profit_executions: %', (
    SELECT COUNT(*) FROM public.stop_loss_take_profit_executions WHERE chat_id = target_chat_id
  );

  -- Derive restart seed capital (used for resetting virtual_cash).
  SELECT COALESCE(
           NULLIF((prefs->>'virtual_seed_capital')::numeric, NULL),
           NULLIF((prefs->>'capital_krw')::numeric, NULL),
           0
         )
  INTO seed_capital
  FROM public.users
  WHERE tg_id = target_chat_id;

  IF NOT preserve_seed_capital THEN
    seed_capital := COALESCE(
      (
        SELECT NULLIF((prefs->>'capital_krw')::numeric, NULL)
        FROM public.users
        WHERE tg_id = target_chat_id
      ),
      seed_capital,
      0
    );
  END IF;

  -- Delete user-scoped logs first.
  DELETE FROM public.virtual_autotrade_actions
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_autotrade_runs
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_decision_logs
  WHERE chat_id = target_chat_id;
  -- virtual_decision_outcomes are removed by ON DELETE CASCADE.

  -- Remove lot matches related to this user (trade-linked and lot-linked safety).
  DELETE FROM public.virtual_trade_lot_matches m
  WHERE EXISTS (
      SELECT 1 FROM public.virtual_trades t
      WHERE t.id = m.trade_id
        AND t.chat_id = target_chat_id
    )
     OR EXISTS (
      SELECT 1 FROM public.virtual_trade_lots l
      WHERE l.id = m.lot_id
        AND l.chat_id = target_chat_id
    );

  DELETE FROM public.virtual_trade_lots
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_trades
  WHERE chat_id = target_chat_id;

  DELETE FROM public.stop_loss_take_profit_executions
  WHERE chat_id = target_chat_id;

  DELETE FROM public.portfolio_snapshots
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_strategy_gate_states
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_positions
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_autotrade_settings
  WHERE chat_id = target_chat_id;

  -- Reset only virtual-trading related user prefs.
  UPDATE public.users
  SET prefs = jsonb_strip_nulls(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(prefs, '{}'::jsonb)
            - 'trade_freeze_reason'
            - 'pacing_state'
            - 'pacing_last_updated_at'
            - 'weekly_copilot_last_run_at'
            - 'weekly_copilot_last_mode'
            - 'weekly_copilot_last_status'
            - 'last_auto_cycle_key'
            - 'last_manual_cycle_key'
            - 'last_cycle_summary',
          '{virtual_realized_pnl}',
          to_jsonb(0),
          true
        ),
        '{virtual_cash}',
        to_jsonb(seed_capital),
        true
      ),
      '{virtual_shadow_mode}',
      to_jsonb(false),
      true
    )
  )
  WHERE tg_id = target_chat_id;

  RAISE NOTICE '=== POST-CHECK COUNTS (chat_id=%) ===', target_chat_id;
  RAISE NOTICE 'virtual_positions: %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_trades: %', (
    SELECT COUNT(*) FROM public.virtual_trades WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_trade_lots: %', (
    SELECT COUNT(*) FROM public.virtual_trade_lots WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_decision_logs: %', (
    SELECT COUNT(*) FROM public.virtual_decision_logs WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_autotrade_runs: %', (
    SELECT COUNT(*) FROM public.virtual_autotrade_runs WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_autotrade_actions: %', (
    SELECT COUNT(*) FROM public.virtual_autotrade_actions WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_strategy_gate_states: %', (
    SELECT COUNT(*) FROM public.virtual_strategy_gate_states WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'portfolio_snapshots: %', (
    SELECT COUNT(*) FROM public.portfolio_snapshots WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'stop_loss_take_profit_executions: %', (
    SELECT COUNT(*) FROM public.stop_loss_take_profit_executions WHERE chat_id = target_chat_id
  );

  RAISE NOTICE 'Reset complete. seed_capital used for virtual_cash=%', seed_capital;
END $$;

COMMIT;

-- After reset (recommended order):
-- 1) Re-enable autotrade settings with defaults:
--    pnpm autotrade:enable -- --tgIds=<chat_id> --enable=true
-- 2) Dry-run verification:
--    pnpm autotrade:dry-run -- --mode=auto --maxUsers=1
-- 3) Real run:
--    pnpm autotrade:run -- --mode=auto --maxUsers=1
