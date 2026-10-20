-- virtual_positions 고유키에 증권사를 넣는다: (chat_id, code, account_name) → (chat_id, code, broker_name, account_name)
-- 계좌명이 같고 증권사만 다른 계좌(예: 'NH / 일반'과 '토스 / 일반')에 같은 종목을 둘 수 없었다.
-- 웹 보유 추가·수정·삭제와 가상매매 RPC(027 v7)는 이미 증권사+계좌명으로 행을 찾는다.
--
-- 순서가 중요하다. 자동매매 upsert의 onConflict가 고유키 컬럼과 정확히 맞아야 해서 한 번에 바꾸면 그 사이 매수가 실패한다.
--   1단계(아래 STEP 1)를 먼저 실행 → 코드 배포(onConflict "chat_id,code,broker_name,account_name") → STEP 2 실행.
-- 새 키는 옛 키보다 느슨해(컬럼이 하나 더 많다) 기존 데이터로 STEP 1이 실패할 일은 없다.
-- NULL 비교 규칙은 옛 키와 같다(봇 가상 계좌 행은 둘 다 NULL이라 이 제약으로 중복이 막히지 않음 — 20261001 주석 참고).

-- ===== STEP 1: 새 고유키 추가 (코드 배포 전) =====
ALTER TABLE public.virtual_positions
  ADD CONSTRAINT virtual_positions_chat_code_broker_account_uq UNIQUE (chat_id, code, broker_name, account_name);

-- ===== STEP 2: 옛 고유키 제거 (코드 배포 후) =====
-- ALTER TABLE public.virtual_positions
--   DROP CONSTRAINT IF EXISTS virtual_positions_chat_code_account_uq;
