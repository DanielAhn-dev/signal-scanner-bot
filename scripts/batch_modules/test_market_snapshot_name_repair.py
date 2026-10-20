"""
name이 코드로 저장된 stocks 행을 스냅샷 종목명으로 채우는 순수 함수 테스트.

  python -m unittest scripts/batch_modules/test_market_snapshot_name_repair.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from batch_modules.market_snapshot import build_name_repairs  # noqa: E402


class NameRepairTest(unittest.TestCase):
    def test_only_code_named_rows_get_snapshot_name(self):
        snapshot = [
            {"code": "069500", "name": "KODEX 200"},
            {"code": "005930", "name": "삼성전자"},
        ]
        current = {"069500": "069500", "005930": "삼성전자(옛)"}
        repairs, missing = build_name_repairs(snapshot, current)
        # 이름이 이미 있는 행은 스냅샷과 달라도 건드리지 않는다
        self.assertEqual(repairs, [{"code": "069500", "name": "KODEX 200"}])
        self.assertEqual(missing, [])

    def test_not_in_snapshot_is_kept(self):
        repairs, missing = build_name_repairs([{"code": "005930", "name": "삼성전자"}], {"012210": "012210"})
        self.assertEqual(repairs, [])
        self.assertEqual(missing, ["012210"])

    def test_snapshot_name_blank_or_code_is_not_used(self):
        snapshot = [{"code": "111111", "name": ""}, {"code": "222222", "name": "222222"}]
        repairs, missing = build_name_repairs(snapshot, {"111111": "111111", "222222": " 222222 "})
        self.assertEqual(repairs, [])
        self.assertEqual(missing, ["111111", "222222"])

    def test_first_snapshot_name_wins_on_duplicates(self):
        snapshot = [{"code": "069500", "name": "KODEX 200"}, {"code": "069500", "name": "다른 이름"}]
        repairs, _ = build_name_repairs(snapshot, {"069500": "069500"})
        self.assertEqual(repairs, [{"code": "069500", "name": "KODEX 200"}])


if __name__ == "__main__":
    unittest.main()
