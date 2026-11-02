import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `.limit(N)` (N > 1000)은 PostgREST 응답 상한(1000행)에 조용히 잘린다 — 2000이라고 적어도 1000행만 온다.
 * 크기가 확실히 작은 표(사용자·설정 등)에만 남기고, 늘어날 수 있는 표는 selectPaged/selectAllSettled/.range()로 읽는다.
 * 이 테스트는 새로 늘어나는 것만 막는 기준선이다. 줄었으면 숫자를 낮추고, 늘리려면 왜 1000행을 못 넘는지 주석을 남긴다.
 */
const BASELINE: Record<string, number> = {
  "handlers/cron/integrityAudit.ts": 2, // 활성 자동매매 설정(사용자 수), 14일 매도 행동 로그
  "handlers/cron/strategyGateRefresh.ts": 1, // 활성 자동매매 설정(사용자 수)
  "handlers/ui/access-users.ts": 3, // 접근 허용·차단 사용자 목록
  "handlers/ui/invites.ts": 1, // 웹 사용자 프로필(초대 트리)
  "src/bot/accessControl.ts": 1, // 접근 허용 목록
  "src/bot/commands/discoveryProfile.ts": 2, // 매도 로트 매칭(거래 1000건 미만일 때만 정확)
  "src/bot/commands/preMarketPlan.ts": 2, // 자동매매 행동 로그·거래(진단 통계)
  "src/services/dataQualityService.ts": 2, // 점수 행(유니버스 약 230개)·종목 40개 × 일봉
  "src/services/virtualAutoTradeService.ts": 3, // 매도 로트 매칭, 행동 로그 7일(진단 통계)
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function oversizedLimits(source: string): number {
  let n = 0;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    for (const m of line.matchAll(/\.limit\(\s*(\d+)\s*\)/g)) if (Number(m[1]) > 1000) n += 1;
  }
  return n;
}

test(".limit(1000 초과)는 기준선보다 늘지 않는다", () => {
  const found: Record<string, number> = {};
  for (const root of ["api", "handlers", "src"]) {
    for (const file of sourceFiles(root)) {
      const n = oversizedLimits(readFileSync(file, "utf8"));
      if (n > 0) found[file.split("\\").join("/")] = n;
    }
  }
  const over = Object.entries(found).filter(([f, n]) => n > (BASELINE[f] ?? 0));
  assert.deepEqual(over, [], "1000행 상한을 넘는 .limit()이 늘었습니다 — selectPaged/selectAllSettled/.range()로 읽으세요");
  const stale = Object.entries(BASELINE).filter(([f, n]) => (found[f] ?? 0) < n);
  assert.deepEqual(stale, [], "기준선이 실제보다 큽니다 — 고친 곳이 있으면 BASELINE 숫자를 낮추세요");
});

test("탐지 규칙: 주석은 세지 않고 1000 이하는 허용한다", () => {
  assert.equal(oversizedLimits("q.limit(2000)\nq.limit(1000)\nq.limit(5)\n// q.limit(9000)\n * .limit(9000)"), 1);
});
