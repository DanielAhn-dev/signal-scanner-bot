// 루트 테스트는 node:test로 돌지만 일부 파일은 vitest 문법(describe/it/expect)으로 작성돼 있다.
// vitest를 루트에 설치하지 않고 같은 문법을 node:test + assert로 흉내 낸다(쓰는 매처만 구현).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

export { describe, it };

export function expect(actual: any) {
  return {
    toBe: (e: unknown) => assert.strictEqual(actual, e),
    toEqual: (e: unknown) => assert.deepStrictEqual(actual, e),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toBeGreaterThan: (e: number) => assert.ok(actual > e, `${actual} > ${e}`),
    toBeLessThan: (e: number) => assert.ok(actual < e, `${actual} < ${e}`),
    toBeCloseTo: (e: number, digits = 2) => assert.ok(Math.abs(actual - e) < Math.pow(10, -digits) / 2, `${actual} ≈ ${e}`),
    toHaveLength: (n: number) => assert.strictEqual(actual.length, n),
    toMatch: (re: RegExp | string) => assert.match(String(actual), re instanceof RegExp ? re : new RegExp(re)),
    toContain: (x: unknown) => assert.ok(actual.includes(x)),
    toMatchObject: (e: Record<string, unknown>) => {
      for (const k of Object.keys(e)) assert.deepStrictEqual(actual[k], e[k]);
    },
  };
}
