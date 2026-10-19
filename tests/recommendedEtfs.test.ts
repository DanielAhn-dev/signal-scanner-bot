import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_ETFS } from "../src/services/coreProfiles";
import { INDEX_ETF_CANDIDATES } from "../web/src/data/accumulateData";
import { CHILD_ETF_DEFAULTS } from "../web/src/lib/childEtf";

// 배치가 보유와 무관하게 일봉·지표를 쌓는 ETF 목록 (scripts/recommended_etfs.py가 읽는다)
const listed: Array<{ code: string; name: string }> = JSON.parse(
  readFileSync(join(__dirname, "..", "scripts", "recommended_etfs.json"), "utf-8"),
).etfs;
const codes = new Set(listed.map((e) => e.code));

test("추천 ETF 목록: 6자리 코드, 중복 없음", () => {
  for (const e of listed) assert.match(e.code, /^[0-9A-Z]{6}$/, e.name);
  assert.equal(codes.size, listed.length);
});

test("추천 ETF 목록: 화면이 추천·비교하는 ETF가 모두 들어 있다", () => {
  const missing = [
    ...INDEX_ETF_CANDIDATES.map((c) => `${c.code} ${c.name} (모아가기 후보)`).filter((s) => !codes.has(s.slice(0, 6))),
    ...Object.entries(PROFILE_ETFS).map(([c, n]) => `${c} ${n} (코어 프로필)`).filter((s) => !codes.has(s.slice(0, 6))),
    ...CHILD_ETF_DEFAULTS.map((c) => `${c.code} ${c.name} (자녀 계좌)`).filter((s) => !codes.has(s.slice(0, 6))),
  ];
  assert.deepEqual(missing, [], "scripts/recommended_etfs.json에 추가하세요");
});
