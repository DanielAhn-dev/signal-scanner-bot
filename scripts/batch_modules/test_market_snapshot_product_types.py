"""
상품 유형·ETF 과세 분류 순수 함수 테스트.

  python -m unittest scripts/batch_modules/test_market_snapshot_product_types.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from batch_modules.market_snapshot import (  # noqa: E402
    build_product_type_rows,
    diff_product_types,
    etf_tax_class_for,
    normalize_product_type,
    parse_etf_categories,
)


class ProductTypeTest(unittest.TestCase):
    def test_normalize_product_type(self):
        self.assertEqual(normalize_product_type("stock"), "stock")
        self.assertEqual(normalize_product_type("ETF"), "etf")
        self.assertEqual(normalize_product_type("etn"), "etn")
        self.assertEqual(normalize_product_type("reit"), "other")
        # 빈 값은 모름 — 기존 값을 덮지 않는다
        self.assertIsNone(normalize_product_type(""))
        self.assertIsNone(normalize_product_type(None))

    def test_tax_class_by_category(self):
        self.assertEqual(etf_tax_class_for(1), "domestic_equity")  # KODEX 200
        self.assertEqual(etf_tax_class_for(2), "domestic_equity")  # 국내 업종/테마
        for category in (3, 4, 5, 6, 7):  # 레버리지·해외주식·금·채권·혼합
            self.assertEqual(etf_tax_class_for(category), "other", category)
        self.assertIsNone(etf_tax_class_for(None))
        self.assertIsNone(etf_tax_class_for(8))

    def test_parse_etf_categories(self):
        payload = {"result": {"etfItemList": [
            {"itemcode": "069500", "etfTabCode": 1},
            {"itemcode": "360750", "etfTabCode": "4"},
            {"itemcode": "0098N0", "etfTabCode": 2},  # 영문이 섞인 새 코드 체계
            {"itemcode": "BAD", "etfTabCode": 1},
            {"itemcode": "411060", "etfTabCode": None},
            {"itemcode": "148070", "etfTabCode": 9},
        ]}}
        self.assertEqual(parse_etf_categories(payload), {"069500": 1, "360750": 4, "0098N0": 2})
        self.assertEqual(parse_etf_categories(None), {})
        self.assertEqual(parse_etf_categories({"result": None}), {})

    def test_build_rows(self):
        snapshot = [
            {"code": "005930", "type": "stock"},
            {"code": "069500", "type": "etf"},
            {"code": "360750", "type": "etf"},
            {"code": "999990", "type": "etf"},  # 목록에 아직 없는 새 ETF
            {"code": "500001", "type": "etn"},
            {"code": "123450", "type": ""},
            {"code": "005930", "type": "stock"},  # 중복
        ]
        rows, skipped = build_product_type_rows(snapshot, {"069500": 1, "360750": 4})
        self.assertEqual(rows, [
            {"code": "005930", "product_type": "stock", "etf_category": None, "etf_tax_class": None},
            {"code": "069500", "product_type": "etf", "etf_category": 1, "etf_tax_class": "domestic_equity"},
            {"code": "360750", "product_type": "etf", "etf_category": 4, "etf_tax_class": "other"},
            {"code": "500001", "product_type": "etn", "etf_category": None, "etf_tax_class": None},
        ])
        self.assertEqual(skipped["etf_not_in_list"], 1)
        self.assertEqual(skipped["no_type"], 1)

    def test_etf_list_unavailable_keeps_existing_etf_rows(self):
        # 목록을 못 받은 날 ETF 행을 보내면 RPC가 분류를 null로 지운다 — 아예 빼야 한다
        rows, skipped = build_product_type_rows([{"code": "005930", "type": "stock"}, {"code": "069500", "type": "etf"}], None)
        self.assertEqual([r["code"] for r in rows], ["005930"])
        self.assertEqual(skipped["etf_list_unavailable"], 1)

    def test_diff(self):
        rows = [
            {"code": "069500", "product_type": "etf", "etf_category": 1, "etf_tax_class": "domestic_equity"},
            {"code": "005930", "product_type": "stock", "etf_category": None, "etf_tax_class": None},
            {"code": "777770", "product_type": "stock", "etf_category": None, "etf_tax_class": None},  # stocks에 없음
        ]
        current = {"069500": ("etf", 1, "domestic_equity"), "005930": (None, None, None)}
        self.assertEqual([r["code"] for r in diff_product_types(rows, current)], ["005930"])


if __name__ == "__main__":
    unittest.main()
