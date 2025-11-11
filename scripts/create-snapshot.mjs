// scripts/create-snapshot.mjs
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchPage(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  const html = await r.text();
  return cheerio.load(html);
}

function parseTable($, marketLabel) {
  const out = [];
  $("table.type_2 tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const name = $(tds[1]).text().trim();
    const href = $(tds[1]).find("a").attr("href") || "";
    const m = href.match(/code=(\d{6})/);
    const code = m?.[1];
    if (code && name) out.push({ code, name, market: marketLabel });
  });
  return out;
}

async function crawlMarket(market, sosok, maxPages = 40) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://finance.naver.com/sise/sise_market_sum.nhn?sosok=${sosok}&page=${page}`;
    try {
      const $ = await fetchPage(url);
      const rows = parseTable($, market);
      if (!rows || rows.length === 0) break;
      all.push(...rows);
      await new Promise((r) => setTimeout(r, 300)); // rate limit
    } catch (e) {
      console.error("page error", market, page, e.message);
      break;
    }
  }
  return all;
}

async function main() {
  const kospi = await crawlMarket("KOSPI", 0, 40);
  const kosdaq = await crawlMarket("KOSDAQ", 1, 60);
  const map = new Map();
  for (const r of [...kospi, ...kosdaq]) map.set(r.code, r);
  const list = Array.from(map.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );

  const outDir = path.resolve("data");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "all_krx.json"),
    JSON.stringify(list, null, 2),
    "utf8"
  );
  console.log("saved:", list.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
