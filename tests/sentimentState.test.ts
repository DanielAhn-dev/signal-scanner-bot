import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSentimentState } from "../src/services/sentimentState";

// scripts/research/build_similar_times.py가 같은 정의로 만든 검증 사례(종가 800개와 기대값)
const cases = JSON.parse(readFileSync(new URL("./fixtures/sentiment_parity.json", import.meta.url), "utf-8")) as Array<{
  date: string;
  closes: number[];
  expected: { score: number; dd60: number; vol20: number };
}>;

test("서버 시장 상태 계산이 파이썬 정의와 같다 (심리 점수·60일 고점 대비·20일 변동성)", () => {
  assert.ok(cases.length >= 3);
  for (const c of cases) {
    const got = computeSentimentState(c.closes);
    assert.ok(got, c.date);
    assert.ok(Math.abs(got!.score - c.expected.score) < 1e-3, `${c.date} score ${got!.score} vs ${c.expected.score}`);
    assert.ok(Math.abs(got!.dd60 - Math.min(0, c.expected.dd60)) < 1e-3, `${c.date} dd60 ${got!.dd60} vs ${c.expected.dd60}`);
    assert.ok(Math.abs(got!.vol20 - c.expected.vol20) < 1e-3, `${c.date} vol20 ${got!.vol20} vs ${c.expected.vol20}`);
  }
});

test("자료가 모자라면 계산하지 않는다", () => {
  assert.equal(computeSentimentState([100, 101, 102]), null);
  assert.equal(computeSentimentState(new Array(300).fill(100)), null);
});
