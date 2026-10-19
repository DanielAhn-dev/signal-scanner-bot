import test from "node:test";
import assert from "node:assert/strict";
import { withPlanOverseas } from "../src/services/incomeGuideStore";
import { DEFAULT_INCOME_GUIDE_SETTINGS } from "../src/lib/incomeGuide";

test("가이드 해외 비중: 내 계획 구성이 있으면 그 값, 없으면 가이드에 적은 값 — 원본 설정은 바꾸지 않는다", () => {
  const saved = { ...DEFAULT_INCOME_GUIDE_SETTINGS, overseasPct: 30 };
  assert.equal(withPlanOverseas(saved, null), saved);
  const eff = withPlanOverseas(saved, 50);
  assert.equal(eff.overseasPct, 50);
  assert.equal(saved.overseasPct, 30);
});
