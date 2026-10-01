-- 같은 종목을 계좌별로 따로 보유할 수 있게 UNIQUE(chat_id, code)를 UNIQUE(chat_id, code, account_name)로 바꾼다.
--
-- 지금까지는 종목봇 보유(account_name이 NULL)와 실계좌 입력(positions-maintenance.ts holdingrestore/holdingedit,
-- account_name이 있음)이 같은 (chat_id, code) 키를 다퉈서, 봇이 들고 있는 종목을 실계좌에 입력하면 409로 막혔다
-- (src/lib/positionAccountGuard.ts). 종목봇의 조회 경로(fetchLegacyVirtualPositionsForChat 등)는 이미
-- .is("broker_name", null).is("account_name", null)로 걸러 가상매매 행만 보고 있어서, 이 마이그레이션은
-- 그 조회 경로를 바꾸지 않고도 안전하다 — 실계좌 행(account_name 있음)은 원래부터 봇 로직에 안 보였다.
--
-- 주의: UNIQUE(chat_id, code, account_name)는 Postgres 표준 NULL 비교 규칙상 account_name이 NULL인 행끼리는
-- "다른 값"으로 취급돼 중복을 막지 못한다 — 종목봇이 같은 종목을 두 번 사는 레이스 보호가 이 제약 하나에서
-- virtual_positions_chat_code_account_uq(아래) + 매도/매수 쪽의 op_key 중복실행 방지(tryRegisterOperation)
-- 조합으로 약해진다. 가상매매(실제 주문 아님)이고 배치가 사용자별로 순차 실행돼 레이스 가능성이 낮아 감수한다.

BEGIN;

ALTER TABLE public.virtual_positions
  DROP CONSTRAINT IF EXISTS virtual_positions_chat_code_uq;

ALTER TABLE public.virtual_positions
  ADD CONSTRAINT virtual_positions_chat_code_account_uq UNIQUE (chat_id, code, account_name);

COMMIT;
