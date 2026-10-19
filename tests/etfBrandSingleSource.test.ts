import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ETF_BRANDS, isExchangeTradedProduct } from "../src/lib/securitiesTax";
import { isExcludedStockName } from "../src/lib/investableUniverse";

/**
 * ETF 판별·네이버 ETF 자료 읽기는 한 곳에만 둔다. 사본을 두면 갈라진다 — 2026-10-19 ETF 브랜드 정규식 사본 8개 중
 * 텔레그램 명령 4곳은 KIWOOM이 빠졌고, 웹 사본은 알려진 ETF 코드가 달랐다. 새 사본이 생기면 여기서 실패한다.
 * scripts/research/는 한 번씩 돌리는 독립 연구 스크립트라 검사하지 않는다.
 */
const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["src", "handlers", "api", "web/src", "scripts"];
const SKIP = [/node_modules/, /__pycache__/, /\.test\.tsx?$/, /[\\/]test_[^\\/]*\.py$/, /^scripts[\\/]research[\\/]/, /^web[\\/]src[\\/]data[\\/]/];

function sourceFiles(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(ROOT, full);
      if (SKIP.some((re) => re.test(rel))) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|py)$/.test(name)) out.push({ path: rel.split(sep).join("/"), text: readFileSync(full, "utf-8") });
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

const files = sourceFiles();
const holders = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.path).sort();

test("ETF 브랜드 목록은 securitiesTax.ts(서버·웹 공용)와 배치 파이썬 사본 하나뿐", () => {
  // 정규식 대안(KODEX|TIGER)이든 문자열 목록("KODEX", "TIGER")이든 브랜드를 나열하면 사본이다
  assert.deepEqual(holders(/KODEX["']?\s*[|,]\s*["']?TIGER/), ["scripts/refresh_universe_membership.py", "src/lib/securitiesTax.ts"]);
});

test("배치 파이썬 브랜드 목록이 서버 목록과 같다", () => {
  const py = readFileSync(join(ROOT, "scripts/refresh_universe_membership.py"), "utf-8");
  const block = py.match(/^ETF_BRANDS = \[([\s\S]*?)\]/m);
  assert.ok(block, "refresh_universe_membership.py에 ETF_BRANDS 목록이 없다");
  const pyBrands = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pyBrands, [...ETF_BRANDS]);
});

test("네이버 ETF 자료 엔드포인트는 서버에서 한 모듈만 부른다", () => {
  const ts = (paths: string[]) => paths.filter((p) => /\.tsx?$/.test(p));
  // ETF 전체 목록(순자산) → etfMarketList.ts, 종목별 지표(보수·수익률) → etfKeyIndicator.ts
  assert.deepEqual(ts(holders(/etfItemList/)), ["src/services/etfMarketList.ts"]);
  assert.deepEqual(ts(holders(/m\.stock\.naver\.com\/api\/stock\/[^\n]*\/integration/)), ["src/services/etfKeyIndicator.ts"]);
  // 배치(파이썬)는 TS 모듈을 못 쓰므로 언어당 한 곳까지만
  const py = holders(/etfItemList/).filter((p) => p.endsWith(".py"));
  assert.ok(py.length <= 1, `파이썬 배치에서 ETF 전체 목록을 읽는 곳이 여러 개: ${py.join(", ")} — 한 모듈로 합친다`);
});

test("브랜드 판별: 브랜드 뒤는 공백이나 끝 (한글 브랜드 포함, 기업명은 아님)", () => {
  for (const name of ["KODEX 200", "KIWOOM 200TR", "파워 200", "마이다스 코스피액티브", "에셋플러스 코리아플랫폼액티브", "SOL 코리아고배당"]) {
    assert.equal(isExchangeTradedProduct("", name), true, name);
    assert.equal(isExcludedStockName(name), true, `${name}은 개별 종목 후보에서 빠져야 한다`);
  }
  // BNK금융지주는 은행지주 — 예전 \b 판별은 ETF로 잡아 거래세 0·자동매매 후보 제외였다
  for (const name of ["BNK금융지주", "파워로직스", "파워넷", "삼성전자"]) {
    assert.equal(isExchangeTradedProduct("", name), false, name);
    assert.equal(isExcludedStockName(name), false, name);
  }
});
