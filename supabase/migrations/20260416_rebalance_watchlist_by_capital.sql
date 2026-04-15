-- 20260416_rebalance_watchlist_by_capital.sql
-- 목적:
-- 기존 1주 기반 관심종목을 사용자 투자금 기준 균등 배분 수량으로 재산정합니다.
-- - 대상: watchlist 보유 행 (quantity > 0 또는 status='holding'/NULL)
-- - 기준 투자금: users.prefs.capital_krw, 없으면 users.prefs.virtual_seed_capital
-- - 거래기록(virtual_trades)은 수정하지 않습니다.
--
-- 주의:
-- 이 마이그레이션은 일회성 데이터 보정입니다.

WITH user_capital AS (
  SELECT
    u.tg_id AS chat_id,
    COALESCE(
      NULLIF((u.prefs ->> 'capital_krw')::numeric, 0),
      NULLIF((u.prefs ->> 'virtual_seed_capital')::numeric, 0),
      0
    ) AS capital
  FROM public.users u
  WHERE u.tg_id IS NOT NULL
),
holdings AS (
  SELECT
    w.id,
    w.chat_id,
    w.code,
    COALESCE(NULLIF(w.buy_price::numeric, 0), NULLIF(s.close::numeric, 0)) AS ref_price,
    uc.capital,
    COUNT(*) OVER (PARTITION BY w.chat_id) AS holding_count
  FROM public.watchlist w
  LEFT JOIN public.stocks s ON s.code = w.code
  LEFT JOIN user_capital uc ON uc.chat_id = w.chat_id
  WHERE COALESCE(w.status, 'holding') = 'holding'
),
rebalanced AS (
  SELECT
    h.id,
    h.chat_id,
    h.code,
    h.ref_price,
    h.capital,
    h.holding_count,
    CASE
      WHEN h.capital > 0 AND h.holding_count > 0 AND h.ref_price > 0
        THEN GREATEST(1, FLOOR((h.capital / h.holding_count) / h.ref_price))::integer
      ELSE COALESCE(NULLIF((SELECT w2.quantity FROM public.watchlist w2 WHERE w2.id = h.id), 0), 1)
    END AS new_qty
  FROM holdings h
),
updated_watchlist AS (
  UPDATE public.watchlist w
  SET
    quantity = r.new_qty,
    buy_price = COALESCE(w.buy_price, r.ref_price),
    invested_amount = CASE
      WHEN COALESCE(w.buy_price, r.ref_price) > 0
        THEN (r.new_qty * COALESCE(w.buy_price, r.ref_price))::bigint
      ELSE w.invested_amount
    END,
    status = 'holding',
    updated_at = now()
  FROM rebalanced r
  WHERE w.id = r.id
  RETURNING
    w.chat_id,
    w.id,
    w.invested_amount
),
invested_by_user AS (
  SELECT
    uw.chat_id,
    SUM(COALESCE(uw.invested_amount, 0)::numeric) AS invested_total
  FROM updated_watchlist uw
  GROUP BY uw.chat_id
)
UPDATE public.users u
SET prefs = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(u.prefs, '{}'::jsonb),
        '{virtual_seed_capital}',
        to_jsonb(uc.capital)
      ),
      '{virtual_cash}',
      to_jsonb(GREATEST(0, uc.capital - COALESCE(ibu.invested_total, 0)))
    ),
    '{virtual_rebalanced_at}',
    to_jsonb(now()::text)
  )
FROM user_capital uc
LEFT JOIN invested_by_user ibu ON ibu.chat_id = uc.chat_id
WHERE u.tg_id = uc.chat_id
  AND uc.capital > 0;

-- 검증용 예시:
-- 1) 사용자별 투자금 대비 보유원금/잔액
-- SELECT
--   u.tg_id,
--   (u.prefs ->> 'capital_krw')::numeric AS capital,
--   (u.prefs ->> 'virtual_cash')::numeric AS cash,
--   SUM(COALESCE(w.invested_amount, 0)) AS invested
-- FROM public.users u
-- LEFT JOIN public.watchlist w ON w.chat_id = u.tg_id
-- WHERE COALESCE(w.status, 'holding') = 'holding'
-- GROUP BY u.tg_id, u.prefs
-- ORDER BY u.tg_id;
