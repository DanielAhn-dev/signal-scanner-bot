import test from "node:test";
import assert from "node:assert/strict";
import { formatStockLabel, labelFromNameMap } from "../src/lib/stockLabel";
import { buildQualityAlert } from "../src/services/dataQualityTrend";
import { buildIntegrityReportMessage } from "../src/services/integrityAuditService";

test("formatStockLabel: 이름이 있으면 이름(코드), 없거나 코드와 같으면 코드만", () => {
  assert.equal(formatStockLabel("010950", "S-Oil"), "S-Oil(010950)");
  assert.equal(formatStockLabel("010950", null), "010950");
  assert.equal(formatStockLabel("010950", "  "), "010950");
  assert.equal(formatStockLabel("010950", "010950"), "010950");
});

test("labelFromNameMap: Map·객체·없음 모두 받는다", () => {
  assert.equal(labelFromNameMap("005930", new Map([["005930", "삼성전자"]])), "삼성전자(005930)");
  assert.equal(labelFromNameMap("005930", { "005930": "삼성전자" }), "삼성전자(005930)");
  assert.equal(labelFromNameMap("005930", undefined), "005930");
  assert.equal(labelFromNameMap("000660", new Map([["005930", "삼성전자"]])), "000660");
});

test("buildQualityAlert: 종목을 이름(코드)로 적고 HTML 특수문자는 이스케이프한다", () => {
  const text = buildQualityAlert({
    trend: { drops: [], chronic: [] } as never,
    limitBreaches: [{ ticker: "360750", ret: 0.45 }],
    newlyMissing: ["005930"],
    badNames: [],
    nameByCode: new Map([
      ["360750", "TIGER 미국S&P500"],
      ["005930", "삼성전자"],
    ]),
  });
  assert.ok(text?.includes("TIGER 미국S&amp;P500(360750) +45%"), text ?? "");
  assert.ok(text?.includes("삼성전자(005930)"), text ?? "");
});

test("buildIntegrityReportMessage: 시세 누락 보유종목을 이름(코드)로 적는다", () => {
  const text = buildIntegrityReportMessage({
    ymd: "2026-10-21",
    results: [],
    staleHoldingCodes: ["010950"],
    pendingHoldingCodes: ["449170"],
    nameByCode: new Map([["010950", "S-Oil"]]),
  });
  assert.ok(text.includes("S-Oil(010950)"), text);
  assert.ok(text.includes("449170"), text);
});
