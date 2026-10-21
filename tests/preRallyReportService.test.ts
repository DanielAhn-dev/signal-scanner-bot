import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLatestPreRallyReport } from "../src/services/preRallyReportService";

test("tmp 폴더가 없는 배포 환경에서는 예외 대신 null", () => {
  const prev = process.cwd();
  const empty = mkdtempSync(join(tmpdir(), "prerally-"));
  process.chdir(empty);
  try {
    assert.equal(getLatestPreRallyReport(40), null);
  } finally {
    process.chdir(prev);
  }
});
