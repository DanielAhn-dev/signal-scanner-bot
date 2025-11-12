import fs from "node:fs/promises";
import path from "node:path";

function getScriptDir() {
  const byArg = process.argv?.[1];
  if (byArg && path.isAbsolute(byArg)) return path.dirname(byArg);
  // @ts-ignore
  const mainFile = typeof require !== "undefined" && require?.main?.filename;
  if (typeof mainFile === "string" && mainFile.length > 0)
    return path.dirname(mainFile);
  return process.cwd();
}
const ROOT = path.resolve(getScriptDir(), "..");
const DATA_DIR = path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "sectors.kr.json");

const SECTORS = [
  { id: "KRX:IT", name: "정보기술", metrics: {} },
  { id: "KRX:COMM", name: "커뮤니케이션", metrics: {} },
  { id: "KRX:HLTH", name: "헬스케어", metrics: {} },
  { id: "KRX:ENRG", name: "에너지", metrics: {} },
  { id: "KRX:FIN", name: "금융", metrics: {} },
  { id: "KRX:IND", name: "산업재", metrics: {} },
  { id: "KRX:MATR", name: "소재", metrics: {} },
  { id: "KRX:CSTM", name: "필수소비재", metrics: {} },
  { id: "KRX:DSCR", name: "임의소비재", metrics: {} },
  { id: "KRX:UTIL", name: "유틸리티", metrics: {} },
];

async function main() {
  // 디렉터리 보장
  await fs.mkdir(DATA_DIR, { recursive: true });
  // 파일 쓰기
  await fs.writeFile(FILE, JSON.stringify(SECTORS, null, 2), "utf8");
  console.log(`[generate] wrote ${SECTORS.length} sectors to ${FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
