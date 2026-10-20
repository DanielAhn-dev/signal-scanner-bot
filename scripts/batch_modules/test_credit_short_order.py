"""
신용/공매도 KRX 수집 순서·중단 판정 순수 함수 테스트.

  python -m unittest scripts/batch_modules/test_credit_short_order.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from batch_modules.credit_short import (  # noqa: E402
    order_codes_stalest_first,
    should_abort_after_cooldown,
)


class OrderTest(unittest.TestCase):
    def test_never_collected_first_then_oldest(self):
        codes = ["005930", "000660", "035420", "051910"]
        last_ok = {"005930": "2026-10-20", "000660": "2026-10-16", "051910": "2026-10-20"}
        self.assertEqual(order_codes_stalest_first(codes, last_ok), ["035420", "000660", "005930", "051910"])

    def test_rotation_moves_yesterdays_batch_to_back(self):
        codes = [f"{i:06d}" for i in range(6)]
        # 어제 앞쪽 3종목만 받았다면 오늘은 나머지 3종목이 먼저
        last_ok = {c: "2026-10-20" for c in codes[:3]}
        self.assertEqual(order_codes_stalest_first(codes, last_ok)[:3], codes[3:])


class AbortTest(unittest.TestCase):
    def test_first_block_takes_one_cooldown(self):
        self.assertFalse(should_abort_after_cooldown(0, 3, 0))

    def test_no_success_after_cooldown_aborts(self):
        self.assertTrue(should_abort_after_cooldown(1, 3, 0))

    def test_recovered_after_cooldown_may_rest_again(self):
        self.assertFalse(should_abort_after_cooldown(1, 3, 5))

    def test_limit_reached_aborts(self):
        self.assertTrue(should_abort_after_cooldown(3, 3, 5))


if __name__ == "__main__":
    unittest.main()
