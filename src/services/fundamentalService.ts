import * as cheerio from "cheerio";
import { fetchRealtimeStockData } from "../utils/fetchRealtimePrice";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export type FundamentalSnapshot = {
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  sales?: number;
  opIncome?: number;
  netIncome?: number;
  salesGrowthPct?: number;
  opIncomeGrowthPct?: number;
  netIncomeGrowthPct?: number;
  qualityScore: number;
  commentary: string;
};

function parseNum(text: string): number | undefined {
  const t = (text || "").replace(/,/g, "").trim();
  if (!t || t === "-" || t === "N/A") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function findLatestValue(row: string[]): number | undefined {
  for (const cell of row) {
    const v = parseNum(cell);
    if (v !== undefined) return v;
  }
  return undefined;
}

function takeNumbers(row: string[]): number[] {
  return (row || [])
    .map((x) => parseNum(x))
    .filter((x): x is number => x !== undefined);
}

function growthPctFromRow(row: string[]): number | undefined {
  const nums = takeNumbers(row);
  if (nums.length < 2) return undefined;

  const latest = nums[0];
  const prev = nums[1];
  if (!Number.isFinite(prev) || prev === 0) return undefined;
  return ((latest - prev) / Math.abs(prev)) * 100;
}

function findFirstNumberInText(text: string): number | undefined {
  const m = (text || "").match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
  if (!m) return undefined;
  return parseNum(m[0]);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function evaluateFundamentalQuality(input: {
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  salesGrowthPct?: number;
  opIncomeGrowthPct?: number;
  netIncomeGrowthPct?: number;
}): { score: number; commentary: string } {
  let score = 50;
  const notes: string[] = [];

  if (input.per !== undefined) {
    if (input.per <= 12) {
      score += 10;
      notes.push("PER 저평가 구간");
    } else if (input.per <= 25) {
      score += 3;
      notes.push("PER 중립 구간");
    } else if (input.per >= 35) {
      score -= 10;
      notes.push("PER 고평가 부담");
    }
  }

  if (input.pbr !== undefined) {
    if (input.pbr <= 1.2) {
      score += 8;
      notes.push("PBR 밸류 매력");
    } else if (input.pbr <= 2.0) {
      score += 3;
    } else if (input.pbr >= 3.0) {
      score -= 8;
      notes.push("PBR 고평가 구간");
    }
  }

  if (input.roe !== undefined) {
    if (input.roe >= 15) {
      score += 15;
      notes.push("ROE 우수");
    } else if (input.roe >= 10) {
      score += 8;
    } else if (input.roe < 5) {
      score -= 10;
      notes.push("ROE 낮음");
    }
  }

  if (input.debtRatio !== undefined) {
    if (input.debtRatio < 80) {
      score += 10;
      notes.push("부채비율 안정");
    } else if (input.debtRatio <= 200) {
      score += 2;
    } else if (input.debtRatio > 250) {
      score -= 12;
      notes.push("부채비율 부담");
    }
  }

  const growthAvg = [
    input.salesGrowthPct,
    input.opIncomeGrowthPct,
    input.netIncomeGrowthPct,
  ]
    .filter((x): x is number => x !== undefined && Number.isFinite(x));

  if (growthAvg.length) {
    const g = growthAvg.reduce((s, x) => s + x, 0) / growthAvg.length;
    if (g >= 15) {
      score += 12;
      notes.push("실적 성장세 강함");
    } else if (g >= 5) {
      score += 6;
      notes.push("실적 개선 흐름");
    } else if (g <= -10) {
      score -= 12;
      notes.push("실적 역성장 구간");
    }
  }

  const final = clamp(Math.round(score), 0, 100);
  const commentary = notes.length
    ? notes.join(" · ")
    : "핵심 재무지표 데이터가 제한적이라 중립 판단";

  return { score: final, commentary };
}

async function fetchNaverFinanceRows(code: string): Promise<Record<string, string[]>> {
  try {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    const html = await fetch(url, { headers: { "User-Agent": UA } }).then((r) =>
      r.text()
    );

    const $ = cheerio.load(html);
    const rows = new Map<string, string[]>();

    // 기본 표 구조 우선 시도
    function parseTableRows(tableSel: cheerio.Cheerio) {
      tableSel.find("tbody tr").each((_, tr) => {
        const th = $(tr).find("th").first();
        let key = th.text() || "";
        key = key.replace(/\s+/g, "").trim();
        if (!key) return;

        const vals: string[] = [];
        $(tr)
          .find("td")
          .each((__, td) => {
            const txt = $(td).text().replace(/\s+/g, "").trim();
            if (txt) vals.push(txt);
          });

        if (vals.length) rows.set(key, vals);
      });
    }

    parseTableRows($("div.section.cop_analysis table"));

    // 페이지 구조 변경 시 전체 테이블을 스캔해서 필요한 행을 찾음
    if (rows.size === 0) {
      $("table").each((_, table) => {
        parseTableRows($(table));
      });
    }

    // 상세 텍스트(투자지표 요약)를 여러 위치에서 시도해 추출
    const detailText =
      $("dl.blind dd").text() || $(".wrap_company .blind").text() || $(".rate_info .blind").text() || "";
    const perFromBlind = findFirstNumberInText(
      (detailText.match(/PER[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );
    const pbrFromBlind = findFirstNumberInText(
      (detailText.match(/PBR[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );

    const out: Record<string, string[]> = Object.fromEntries(rows.entries());
    if (perFromBlind !== undefined) out.__PER_FALLBACK__ = [String(perFromBlind)];
    if (pbrFromBlind !== undefined) out.__PBR_FALLBACK__ = [String(pbrFromBlind)];
    return out;
  } catch (e) {
    console.error(`fetchNaverFinanceRows failed (${code}):`, e);
    return {};
  }
}

export async function getFundamentalSnapshot(code: string): Promise<FundamentalSnapshot> {
  const [rt, rows] = await Promise.all([
    fetchRealtimeStockData(code),
    fetchNaverFinanceRows(code),
  ]);

  const sales = findLatestValue(rows["매출액"] || []);
  const opIncome = findLatestValue(rows["영업이익"] || []);
  const netIncome = findLatestValue(rows["당기순이익"] || []);
  const salesGrowthPct = growthPctFromRow(rows["매출액"] || []);
  const opIncomeGrowthPct = growthPctFromRow(rows["영업이익"] || []);
  const netIncomeGrowthPct = growthPctFromRow(rows["당기순이익"] || []);
  const debtRatio = findLatestValue(
    rows["부채비율"] || rows["부채비율(%)"] || rows["부채비율연결"] || []
  );
  const roe = findLatestValue(
    rows["ROE(지배주주)"] || rows["ROE"] || rows["ROE(%)"] || []
  );

  const per = rt?.per ?? parseNum((rows.__PER_FALLBACK__ || [])[0] || "");
  const pbr = rt?.pbr ?? parseNum((rows.__PBR_FALLBACK__ || [])[0] || "");

  const quality = evaluateFundamentalQuality({
    per,
    pbr,
    roe,
    debtRatio,
    salesGrowthPct,
    opIncomeGrowthPct,
    netIncomeGrowthPct,
  });

  return {
    per,
    pbr,
    roe,
    debtRatio,
    sales,
    opIncome,
    netIncome,
    salesGrowthPct,
    opIncomeGrowthPct,
    netIncomeGrowthPct,
    qualityScore: quality.score,
    commentary: quality.commentary,
  };
}
