/**
 * 종목코드 → DART 회사 코드 표(src/data/dartCorpCodes.json)를 DART corpCode.xml로 다시 만든다.
 * 배당금 반영(stockDividend.ts)이 쓴다. 표에 없는 새 상장 종목은 실행 중에 DART에서 받아 채우므로
 * 이 스크립트는 가끔(분기 1회 정도) 돌려 표를 최신으로 두는 용도다.
 *   pnpm gen:dart-corps
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { downloadCorpCodes } from "../../src/services/stockDividend";

(async () => {
  const key = process.env.DART_API_KEY;
  if (!key) throw new Error("DART_API_KEY 없음");
  const map = await downloadCorpCodes(key, fetch, 120_000);
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync("src/data/dartCorpCodes.json", JSON.stringify(sorted));
  console.log(`상장사 ${Object.keys(sorted).length}개 저장`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
