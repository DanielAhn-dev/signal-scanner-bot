// 테스트 실행기 — "tsx --test tests/**/*.test.ts"는 Windows 명령창이 글롭을 펼치지 않아
// 파일을 못 찾고 실패했다(테스트가 한 번도 안 돌았다). 목록을 직접 모아 node 테스트 러너에 넘긴다.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => `tests/${f}`);
if (files.length === 0) {
  console.error("tests/*.test.ts 없음");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
