"""
유니버스 후보 자격: 상품 유형(stocks.product_type)이 ETF·ETN이면 이름과 무관하게 제외.

  python -m unittest scripts/test_refresh_universe_product_type.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from refresh_universe_membership import UniverseConfig, is_eligible_candidate  # noqa: E402

CFG = UniverseConfig(
    core_top_n=200, extended_top_n=500, min_price=1000, min_market_cap=300_000_000_000, min_liquidity=5_000_000_000,
    allowed_markets={"KOSPI", "KOSDAQ"}, mark_missing_inactive=False, missing_grace_runs=3, min_listed_count_guard=1000,
    notify_always=False,
)
BIG = dict(market="KOSPI", close_price=50_000, market_cap=10_000_000_000_000, liquidity=100_000_000_000, cfg=CFG)


class EligibleTest(unittest.TestCase):
    def test_product_type_etf_excluded_even_when_name_is_code(self):
        # 이름이 종목코드로만 저장된 ETF — 이름 규칙으로는 못 거른다
        self.assertTrue(is_eligible_candidate(code="105010", name="105010", **BIG))
        self.assertFalse(is_eligible_candidate(code="105010", name="105010", product_type="etf", **BIG))
        self.assertFalse(is_eligible_candidate(code="500001", name="500001", product_type="ETN", **BIG))

    def test_stock_keeps_name_rule(self):
        self.assertTrue(is_eligible_candidate(code="005930", name="삼성전자", product_type="stock", **BIG))
        # 상품 유형이 stock이어도 우선주·스팩은 이름 규칙으로 뺀다
        self.assertFalse(is_eligible_candidate(code="005935", name="삼성전자우", product_type="stock", **BIG))
        self.assertFalse(is_eligible_candidate(code="472840", name="ITF 200", **BIG))

    def test_whitelisted_index_etf_stays(self):
        self.assertTrue(is_eligible_candidate(code="069500", name="KODEX 200", product_type="etf", **BIG))


if __name__ == "__main__":
    unittest.main()
