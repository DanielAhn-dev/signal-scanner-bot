"""
유니버스 갱신이 모르는 종가(0·빈 값)를 stocks.close에 0으로 쓰지 않는지, OHLCV 종가 동기화가 0을 거르는지.

  python -m unittest scripts/test_refresh_universe_close.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from refresh_universe_membership import build_stock_upsert_row, group_rows_by_keys, known_close  # noqa: E402
from batch_modules.ohlcv import build_close_updates  # noqa: E402


class KnownCloseTest(unittest.TestCase):
    def test_zero_and_blank_are_unknown(self):
        for raw in (0, "0", None, "", -5, "abc"):
            self.assertIsNone(known_close(raw), raw)
        self.assertEqual(known_close("14825"), 14825)
        self.assertEqual(known_close(112205.0), 112205)


class UpsertRowTest(unittest.TestCase):
    def test_unknown_close_is_omitted_not_zero(self):
        # DB 폴백: stocks.close가 비어 있던 보유 ETF — 0으로 저장되면 평가액 0(−100%)이 된다
        row = build_stock_upsert_row({"code": "091170", "name": "KODEX 은행", "close": 0}, 0)
        self.assertNotIn("close", row)
        self.assertEqual(row["code"], "091170")

    def test_known_close_is_kept(self):
        row = build_stock_upsert_row({"code": "005930", "name": "삼성전자"}, 61000)
        self.assertEqual(row["close"], 61000)

    def test_rows_with_different_keys_go_to_separate_batches(self):
        # 한 upsert 묶음에 close 없는 행이 섞이면 그 행의 close가 NULL로 덮인다
        rows = [
            build_stock_upsert_row({"code": "005930"}, 61000),
            build_stock_upsert_row({"code": "091170"}, 0),
            build_stock_upsert_row({"code": "000660"}, 200000),
        ]
        groups = group_rows_by_keys(rows)
        self.assertEqual(len(groups), 2)
        for g in groups:
            self.assertEqual(len({tuple(sorted(r.keys())) for r in g}), 1)
        self.assertEqual(sorted(r["code"] for r in groups[0]), ["000660", "005930"])


class CloseUpdatesTest(unittest.TestCase):
    def test_zero_close_rows_are_skipped(self):
        daily = [
            {"ticker": "091170", "close": 14825},
            {"ticker": "449170", "close": 0},
            {"ticker": "999999", "close": 1000},  # stocks에 없음
        ]
        valid = {"091170": "KODEX 은행", "449170": "TIGER KOFR금리액티브(합성)"}
        out = build_close_updates(daily, valid, "2026-10-21T00:00:00+09:00")
        self.assertEqual([r["code"] for r in out], ["091170"])
        self.assertEqual(out[0]["close"], 14825)
        self.assertEqual(out[0]["name"], "KODEX 은행")


if __name__ == "__main__":
    unittest.main()
