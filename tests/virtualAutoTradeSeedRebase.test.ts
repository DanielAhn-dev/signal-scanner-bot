import test from "node:test";
import assert from "node:assert/strict";
import { resolveSeedRebase } from "../src/services/virtualAutoTradeSeedRebase";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-23T00:00:00+09:00");

test("resolveSeedRebase: 마지막 재계산이 없으면(신규) 즉시 재계산한다", () => {
  const result = resolveSeedRebase({
    seedCapital: 20_000_000,
    realizedPnl: 500_000,
    lastRebaseAt: null,
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, true);
  assert.equal(result.nextSeedCapital, 20_500_000);
  assert.equal(result.deltaApplied, 500_000);
});

test("resolveSeedRebase: 7일이 안 지났으면 재계산하지 않는다", () => {
  const result = resolveSeedRebase({
    seedCapital: 20_000_000,
    realizedPnl: 500_000,
    lastRebaseAt: new Date(NOW - 3 * DAY_MS).toISOString(),
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, false);
  assert.equal(result.nextSeedCapital, 20_000_000);
});

test("resolveSeedRebase: 7일이 지나고 손익이 있으면 양방향으로 반영한다(손실 케이스)", () => {
  const result = resolveSeedRebase({
    seedCapital: 20_000_000,
    realizedPnl: -1_200_000,
    lastRebaseAt: new Date(NOW - 8 * DAY_MS).toISOString(),
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, true);
  assert.equal(result.nextSeedCapital, 18_800_000);
  assert.equal(result.deltaApplied, -1_200_000);
});

test("resolveSeedRebase: 손실이 시드보다 크면 0 밑으로 내려가지 않는다", () => {
  const result = resolveSeedRebase({
    seedCapital: 1_000_000,
    realizedPnl: -5_000_000,
    lastRebaseAt: new Date(NOW - 30 * DAY_MS).toISOString(),
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, true);
  assert.equal(result.nextSeedCapital, 0);
});

test("resolveSeedRebase: 손익이 0이면 재계산 주기가 지나도 재계산하지 않는다", () => {
  const result = resolveSeedRebase({
    seedCapital: 20_000_000,
    realizedPnl: 0,
    lastRebaseAt: new Date(NOW - 10 * DAY_MS).toISOString(),
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, false);
});

test("resolveSeedRebase: 시드가 0/미설정이면 재계산하지 않는다", () => {
  const result = resolveSeedRebase({
    seedCapital: 0,
    realizedPnl: 500_000,
    lastRebaseAt: null,
    nowMs: NOW,
  });
  assert.equal(result.shouldRebase, false);
});
