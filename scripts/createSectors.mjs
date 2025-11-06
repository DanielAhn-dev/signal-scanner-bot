// scripts/createSectors.mjs
import "dotenv/config";
import fetch from "node-fetch";
import iconv from "iconv-lite";
import * as cheerio from "cheerio";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error("SUPABASE_URL & SUPABASE_ANON_KEY required");
const HDR = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const METRIC_KEYS = ["roi_1m", "roi_3m", "roi_6m"];
function defaultMetrics() {
  return { roi_1m: 0, roi_3m: 0, roi_6m: 0 };
}
function needsMetricInit(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return true;
  return METRIC_KEYS.some((k) => !(k in m) || typeof m[k] !== "number");
}
function classifyCategory(name) {
  if (!name) return null;
  if (/(반도체|it|전자|디스플레이|소프트웨어|ai|칩)/i.test(name)) return "IT";
  if (/(2차전지|배터리|태양광|풍력|수소|정유|석유)/i.test(name))
    return "Energy";
  if (/(바이오|제약|의료|헬스케어|진단)/i.test(name)) return "Healthcare";
  if (/(자동차|조선|기계|운송장비|철도|항공|물류)/i.test(name))
    return "Industrial";
  if (/(은행|증권|보험|금융|카드)/i.test(name)) return "Financial";
  if (/(원자재|철강|비철|화학|소재|시멘트|광물)/i.test(name))
    return "Materials";
  if (/(엔터|미디어|게임|유통|소비|음식료|의류|리테일)/i.test(name))
    return "Consumer";
  if (/(통신|telecom)/i.test(name)) return "Telecom";
  if (/(전력|가스|수도|utility)/i.test(name)) return "Utilities";
  if (/(리츠|부동산|real estate)/i.test(name)) return "Real Estate";
  return null;
}

// 엄격한 업종명 검증: 숫자/지표/동일업종/등락률 키워드 배제
function isValidSectorName(s) {
  if (!s || s.length < 2 || s.length > 60) return false;
  // 금칙 키워드: PER, PBR, ROE, 배당, 동일업종, 등락률, 시가총액, 외국인, 거래량, 매출, 영업이익 등
  const forbidden =
    /PER|PBR|ROE|배당|동일업종|등락률|시가총액|외국인|거래량|매출|영업이익|수익률|전일대비/i;
  if (forbidden.test(s)) return false;
  // 숫자+단위(배/원/%)는 업종명 아님
  if (/^[\d\-+,.\s]*(배|원|억원|천원|%|％|x|X)$/i.test(s)) return false;
  if (/^\d[\d,.\s]*$/.test(s)) return false; // 순수 숫자
  // 한글 또는 영문이 40% 이상 포함되어야 업종명
  const hangul = (s.match(/[\p{sc=Hangul}]/gu) || []).length;
  const alpha = (s.match(/[a-zA-Z]/g) || []).length;
  if (hangul + alpha < s.length * 0.4) return false;
  return true;
}
function sanitizeSectorName(raw) {
  if (!raw) return null;
  let s = String(raw)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  // 토큰 매핑
  const tokenMap = {
    __TYPE__REIT: "리츠",
    __TYPE__ETF: "ETF",
    __TYPE__ETN: "ETN",
    __TYPE__SPAC: null,
    __TYPE__NAVERPAY: null,
  };
  if (Object.prototype.hasOwnProperty.call(tokenMap, s)) return tokenMap[s];
  // 쉼표/슬래시로 분할된 경우 첫 유효 토큰 선택
  const tokens = s
    .split(/[,\/·•]/g)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const t of tokens) {
    if (isValidSectorName(t)) return t;
  }
  return null;
}

function normalizeForKey(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\s\-,./()[\]·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAllSectors(batch = 1000) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(
      `${URL}/rest/v1/sectors?select=id,name,category,metrics&limit=${batch}&offset=${offset}`,
      { headers: HDR }
    );
    if (!r.ok)
      throw new Error(`fetch sectors failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < batch) break;
    offset += rows.length;
  }
  return out;
}

async function findOrCreateSector(cleanedName, sectorMap) {
  const key = normalizeForKey(cleanedName);
  const wantCat = classifyCategory(cleanedName);

  // 1) 기존 매핑
  const existing = sectorMap.get(key);
  if (existing) {
    const needCat = !existing.category && !!wantCat;
    const needMet = needsMetricInit(existing.metrics);
    if (needCat || needMet) {
      const patch = {
        ...(needCat ? { category: wantCat } : {}),
        ...(needMet ? { metrics: defaultMetrics() } : {}),
      };
      const pr = await fetch(`${URL}/rest/v1/sectors?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: {
          ...HDR,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      });
      if (pr.ok) {
        if (needCat) existing.category = wantCat;
        if (needMet) existing.metrics = defaultMetrics();
      }
    }
    return existing.id;
  }

  // 2) 신규 생성 시도
  const cr = await fetch(`${URL}/rest/v1/sectors?on_conflict=name`, {
    method: "POST",
    headers: {
      ...HDR,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify([
      { name: cleanedName, category: wantCat, metrics: defaultMetrics() },
    ]),
  });

  // 409 중복 시 기존 ID 재조회
  if (cr.status === 409) {
    const rq = await fetch(
      `${URL}/rest/v1/sectors?select=id,name,category,metrics&name=eq.${encodeURIComponent(
        cleanedName
      )}&limit=1`,
      { headers: HDR }
    );
    if (rq.ok) {
      const rows = await rq.json();
      if (rows.length) {
        sectorMap.set(normalizeForKey(rows[0].name), rows[0]);
        return rows[0].id;
      }
    }
    return null;
  }

  if (!cr.ok) {
    console.error(`create sector failed: ${cr.status} ${await cr.text()}`);
    return null;
  }
  const created = await cr.json();
  if (Array.isArray(created) && created.length) {
    sectorMap.set(normalizeForKey(created[0].name), created[0]);
    return created[0].id;
  }
  return null;
}

// ---- scraper (Naver) ----
async function fetchSectorFromNaver(code) {
  const url = `https://finance.naver.com/item/main.naver?code=${code}`;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://finance.naver.com",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return "";
    const buf = Buffer.from(await resp.arrayBuffer());
    let html = buf.toString("utf8");
    if ((html.match(/�/g) || []).length > 5) html = iconv.decode(buf, "EUC-KR");
    const $ = cheerio.load(html);

    // 1) 업종 링크 추출 (가장 신뢰도 높음)
    const aUpjong = $('a[href*="sise_group_detail.naver"][href*="type=upjong"]')
      .first()
      .text()
      .trim();
    if (aUpjong && isValidSectorName(aUpjong))
      return aUpjong.replace(/\s+/g, " ");

    // 2) 대체 위치들 (링크 우선, 텍스트는 보조)
    const thSector = $('th:contains("업종")').first().next("td");
    const thLink = thSector
      .find('a[href*="sise_group_detail"]')
      .first()
      .text()
      .trim();
    if (thLink && isValidSectorName(thLink)) return thLink.replace(/\s+/g, " ");

    const thText = thSector.text().trim();
    if (thText && isValidSectorName(thText)) return thText.replace(/\s+/g, " ");

    const cands = [
      $('th:contains("소속업종")').first().next("td").text().trim(),
      $('dt:contains("업종")').first().next("dd").text().trim(),
    ].filter(Boolean);
    for (const c of cands) {
      const t = c.replace(/\s+/g, " ");
      if (isValidSectorName(t)) return t;
    }

    // 3) OG description
    const og =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      "";
    if (og) {
      const m = og.match(/업종[:\s\-–：]*([^\.\,，\n]+)/i);
      const t = m?.[1]?.trim();
      if (t && isValidSectorName(t)) return t;
    }

    // 4) 토큰
    const title = ($("title").text() || "").toLowerCase();
    const body = $.root().text().replace(/\s+/g, " ").toLowerCase();
    if (title.includes("리츠") || body.includes("리츠")) return "__TYPE__REIT";
    if (title.includes("etf") || body.includes("etf")) return "__TYPE__ETF";
    if (title.includes("etn") || body.includes("etn")) return "__TYPE__ETN";
    if (
      title.includes("스팩") ||
      body.includes("스팩") ||
      body.includes("spac")
    )
      return "__TYPE__SPAC";
    if (body.includes("네이버페이 증권") || body.includes("네이버페이"))
      return "__TYPE__NAVERPAY";

    return "";
  } catch {
    return "";
  }
}

async function patchSectorId(code, sector_id) {
  const resp = await fetch(
    `${URL}/rest/v1/stocks?code=eq.${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      headers: {
        ...HDR,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ sector_id }),
    }
  );
  if (!resp.ok) return false;
  const body = await resp.json().catch(() => []);
  return Array.isArray(body) && body.length > 0;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchCodesWithNullSectorId(batch = 1000) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(
      `${URL}/rest/v1/stocks?select=code&sector_id=is.null&order=code.asc&limit=${batch}&offset=${offset}`,
      { headers: HDR }
    );
    if (!r.ok) throw new Error(`select failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows.map((x) => x.code));
    if (rows.length < batch) break;
    offset += rows.length;
  }
  return out;
}

// ---- main ----
(async function main() {
  console.log("Scanning stocks with NULL sector_id...");
  const codes = await fetchCodesWithNullSectorId(1000);
  console.log("NULL sector_id targets:", codes.length);

  const sectors = await fetchAllSectors();
  const sectorMap = new Map();
  for (const s of sectors) sectorMap.set(normalizeForKey(s.name), s);

  const stats = {
    fetched: codes.length,
    scrapedOk: 0,
    sanitizedOk: 0,
    sectorCreated: 0,
    sectorPatched: 0,
    stockPatched: 0,
    skippedNoSector: 0,
    skippedCreateFail: 0,
    patchFail: 0,
  };

  const concurrency = 8;
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= codes.length) break;
        const code = codes[idx];
        try {
          const raw = await fetchSectorFromNaver(code);
          if (raw) stats.scrapedOk++;

          const cleaned = sanitizeSectorName(raw);
          if (!cleaned) {
            stats.skippedNoSector++;
            await sleep(60);
            continue;
          }
          stats.sanitizedOk++;

          const sid = await findOrCreateSector(cleaned, sectorMap);
          if (!sid) {
            stats.skippedCreateFail++;
            await sleep(60);
            continue;
          }

          const ok = await patchSectorId(code, sid);
          if (ok) stats.stockPatched++;
          else stats.patchFail++;
          await sleep(80);
        } catch (err) {
          console.error(`Worker error code=${code}:`, err?.message || err);
          await sleep(200);
        }
      }
    })
  );

  console.log("Summary:", stats);
  console.log("✓ sector_id backfill finished");
})();
