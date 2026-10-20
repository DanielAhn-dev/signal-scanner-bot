"""
유니버스 갱신의 종목명: 이름 조회 실패(예외·빈 값·코드와 같은 이름)를 값으로 써서 기존 이름을 덮지 않는다.

  python -m unittest scripts/test_refresh_universe_name.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from refresh_universe_membership import known_stock_name, resolve_stock_name  # noqa: E402


class KnownStockNameTest(unittest.TestCase):
    def test_real_name(self):
        self.assertEqual(known_stock_name("005930", " 삼성전자 "), "삼성전자")

    def test_failures_are_unknown(self):
        self.assertIsNone(known_stock_name("005930", "005930"))
        self.assertIsNone(known_stock_name("005930", ""))
        self.assertIsNone(known_stock_name("005930", None))
        self.assertIsNone(known_stock_name("005930", object()))  # pykrx가 빈 DataFrame을 줄 때


class ResolveStockNameTest(unittest.TestCase):
    def test_fetched_wins(self):
        self.assertEqual(resolve_stock_name("005930", "삼성전자", "옛이름"), "삼성전자")

    def test_unknown_keeps_prev(self):
        self.assertEqual(resolve_stock_name("005930", None, "삼성전자"), "삼성전자")
        self.assertEqual(resolve_stock_name("005930", "005930", "삼성전자"), "삼성전자")

    def test_new_row_without_name_falls_back_to_code(self):
        # name은 NOT NULL — 처음 보는 종목은 코드라도 넣는다(복구 스크립트·일일 자가복구가 나중에 채움)
        self.assertEqual(resolve_stock_name("005930", None, None), "005930")
        self.assertEqual(resolve_stock_name("005930", None, "005930"), "005930")


if __name__ == "__main__":
    unittest.main()
