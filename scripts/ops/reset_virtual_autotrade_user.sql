-- reset_virtual_autotrade_user.sql
-- Purpose: Hard-reset one user's virtual autotrade state for a clean restart.
-- Scope: user-scoped data only (chat_id), **실험(가상) 계좌만**.
--   2026-10-19 수정: 실계좌 입력 행(virtual_positions/virtual_trades의 broker_name 또는 account_name이 있는 행)과
--   그 매매에 연결된 lot은 지우지 않는다. 예전 판(2026-06-02)은 chat_id 전체를 지워 실계좌 기록까지 날렸다.
--
-- Usage:
-- 1) Update target_chat_id below.
-- 2) Run in Supabase SQL editor (service_role context).
-- 3) Verify NOTICE counts before/after in the execution log.
--    실계좌 입력 행 수가 실행 전후로 같은지 꼭 본다. 다르면 ROLLBACK.
-- 4) 결정 기록(virtual_decision_logs)도 지워지므로 11/23 관문 판정(C34 보류 종목 확인 등)을 끝낸 뒤에 실행한다.

BEGIN;

DO $$
DECLARE
  target_chat_id bigint := 0; -- TODO: set target Telegram chat_id (e.g. 8311154094)
  preserve_seed_capital boolean := true;
  new_seed_capital numeric := NULL; -- 새 시드로 다시 시작하려면 금액(예: 20000000). NULL이면 지금 시드 그대로
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
  RAISE NOTICE 'virtual_positions (실험 계좌, 지움): %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id AND broker_name IS NULL AND account_name IS NULL
  );
  RAISE NOTICE 'virtual_positions (실계좌 입력, 남김): %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id AND (broker_name IS NOT NULL OR account_name IS NOT NULL)
  );
  RAISE NOTICE 'virtual_trades (실험 계좌, 지움): %', (
    SELECT COUNT(*) FROM public.virtual_trades WHERE chat_id = target_chat_id AND broker_name IS NULL AND account_name IS NULL
  );
  RAISE NOTICE 'virtual_trades (실계좌 입력, 남김): %', (
    SELECT COUNT(*) FROM public.virtual_trades WHERE chat_id = target_chat_id AND (broker_name IS NOT NULL OR account_name IS NOT NULL)
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

  IF new_seed_capital IS NOT NULL AND new_seed_capital > 0 THEN
    seed_capital := new_seed_capital;
  ELSIF NOT preserve_seed_capital THEN
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

  -- 실험 계좌 매매·lot만 지운다. lot에는 계좌 칸이 없어 원래 매매(source_trade_id)로 가린다.
  -- 원래 매매가 없는 lot(source_trade_id NULL)은 어느 계좌 것인지 알 수 없어 남기고 개수만 알린다.
  RAISE NOTICE 'virtual_trade_lots (원래 매매 없음, 남김 — 직접 확인): %', (
    SELECT COUNT(*) FROM public.virtual_trade_lots WHERE chat_id = target_chat_id AND source_trade_id IS NULL
  );

  DELETE FROM public.virtual_trade_lot_matches m
  WHERE EXISTS (
      SELECT 1 FROM public.virtual_trades t
      WHERE t.id = m.trade_id
        AND t.chat_id = target_chat_id
        AND t.broker_name IS NULL AND t.account_name IS NULL
    )
     OR EXISTS (
      SELECT 1 FROM public.virtual_trade_lots l
      JOIN public.virtual_trades t ON t.id = l.source_trade_id
      WHERE l.id = m.lot_id
        AND l.chat_id = target_chat_id
        AND t.broker_name IS NULL AND t.account_name IS NULL
    );

  DELETE FROM public.virtual_trade_lots l
  USING public.virtual_trades t
  WHERE l.chat_id = target_chat_id
    AND t.id = l.source_trade_id
    AND t.broker_name IS NULL AND t.account_name IS NULL;

  DELETE FROM public.virtual_trades
  WHERE chat_id = target_chat_id
    AND broker_name IS NULL AND account_name IS NULL;

  DELETE FROM public.stop_loss_take_profit_executions
  WHERE chat_id = target_chat_id;

  DELETE FROM public.portfolio_snapshots
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_strategy_gate_states
  WHERE chat_id = target_chat_id;

  DELETE FROM public.virtual_positions
  WHERE chat_id = target_chat_id
    AND broker_name IS NULL AND account_name IS NULL;

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

  -- 새 시드로 시작하면 시드 값도 같이 바꾼다(수익률 기준이 새 시드가 되도록)
  IF new_seed_capital IS NOT NULL AND new_seed_capital > 0 THEN
    UPDATE public.users
    SET prefs = jsonb_set(COALESCE(prefs, '{}'::jsonb), '{virtual_seed_capital}', to_jsonb(new_seed_capital), true)
    WHERE tg_id = target_chat_id;
  END IF;

  RAISE NOTICE '=== POST-CHECK COUNTS (chat_id=%) ===', target_chat_id;
  RAISE NOTICE 'virtual_positions 남은 행(실계좌 입력만 남아야 함): %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id
  );
  RAISE NOTICE 'virtual_positions 실험 계좌 남은 행(0이어야 함): %', (
    SELECT COUNT(*) FROM public.virtual_positions WHERE chat_id = target_chat_id AND broker_name IS NULL AND account_name IS NULL
  );
  RAISE NOTICE 'virtual_trades 남은 행(실계좌 입력만 남아야 함): %', (
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
