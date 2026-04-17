import * as cheerio from "cheerio";
import { fetchRealtimeStockData } from "../utils/fetchRealtimePrice";
import {
  clamp,
  extractMetricValue,
  findFirstNumberInText,
  findLatestActualAnnualValue,
  growthPctFromRow,
  parseNum,
} from "./fundamentalParser";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type FetchLikeResponse = {
  text(): Promise<string>;
};

type NaverFinanceData = {
  rows: Record<string, string[]>;
  currentPer?: number;
  currentPbr?: number;
};

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

function extractCurrentValuationMetric(
  $: cheerio.CheerioAPI,
  labelPattern: RegExp,
  unit: string
): number | undefined {
  let found: number | undefined;

  $("table tr").each((_, tr) => {
    if (found !== undefined) return;

    const cells = $(tr)
      .find("th, td")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get();

    if (!cells.length) return;

    const label = (cells[0] || "").replace(/\s+/g, "");
    if (!labelPattern.test(label)) return;

    const value = extractMetricValue(cells.slice(1).join(" "), unit);
    if (value !== undefined) found = value;
  });

  return found;
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
    if (input.per < 0) {
      score -= 12;
      notes.push("적자 구간으로 PER 해석 제한");
    } else if (input.per <= 12) {
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
      if ((input.roe ?? 0) >= 15) {
        score -= 3;
        notes.push("PBR은 높지만 ROE가 이를 일부 상쇄");
      } else {
        score -= 8;
        notes.push("PBR 고평가 구간");
      }
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

  const growthSignals = [
    input.salesGrowthPct,
    input.opIncomeGrowthPct,
    input.netIncomeGrowthPct,
  ]
    .filter((x): x is number => x !== undefined && Number.isFinite(x));

  if (growthSignals.length) {
    const strongPositiveCount = growthSignals.filter((x) => x >= 15).length;
    const positiveCount = growthSignals.filter((x) => x >= 5).length;
    const negativeCount = growthSignals.filter((x) => x <= -10).length;

    if (strongPositiveCount >= 2) {
      score += 10;
      notes.push("실적 성장세 강함");
    } else if (positiveCount >= 2) {
      score += 6;
      notes.push("실적 개선 흐름");
    } else if (negativeCount >= 2) {
      score -= 12;
      notes.push("실적 역성장 구간");
    } else if (positiveCount >= 1 && negativeCount >= 1) {
      notes.push("실적 흐름 혼조");
    }
  }

  const final = clamp(Math.round(score), 0, 100);
  const commentary = notes.length
    ? notes.join(" · ")
    : "핵심 재무지표 데이터가 제한적이라 중립 판단";

  return { score: final, commentary };
}

async function fetchNaverFinanceRows(code: string): Promise<NaverFinanceData> {
  try {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    const res = (await fetch(url, {
      headers: { "User-Agent": UA },
    })) as FetchLikeResponse;
    const html = await res.text();

    const $ = cheerio.load(html);
    const rows = new Map<string, string[]>();

    // 기본 표 구조 우선 시도
    function parseTableRows(tableSel: any) {
      tableSel.find("tbody tr").each((_: any, tr: any) => {
        const th = $(tr).find("th").first();
        let key = th.text() || "";
        key = key.replace(/\s+/g, "").trim();
        if (!key) return;

        const vals: string[] = [];
        $(tr)
          .find("td")
          .each((__: any, td: any) => {
            const txt = $(td).text().replace(/\s+/g, "").trim();
            vals.push(txt);
          });

        if (vals.length) rows.set(key, vals);
      });
    }

    parseTableRows($("div.section.cop_analysis table"));

    // 페이지 구조 변경 시 전체 테이블을 스캔해서 필요한 행을 찾음
    if (rows.size === 0) {
      $("table").each((_: any, table: any) => {
        parseTableRows($(table));
      });
    }

    const currentPer = extractCurrentValuationMetric($, /^PERlEPS/i, "배");
    const currentPbr = extractCurrentValuationMetric($, /^PBRlBPS/i, "배");

    // 상세 텍스트(투자지표 요약)를 여러 위치에서 시도해 추출
    const detailText =
      $("dl.blind dd").text() || $(".wrap_company .blind").text() || $(".rate_info .blind").text() || "";
    const perFromBlind = findFirstNumberInText(
      (detailText.match(/PER[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );
    const pbrFromBlind = findFirstNumberInText(
      (detailText.match(/PBR[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );

    // 표(row)에서 명시적으로 PER/PBR 라벨을 찾아 추출 (우선순위: table > blind > html)
    let perFromTable: number | undefined;
    let pbrFromTable: number | undefined;
    for (const [k, vals] of rows.entries()) {
      try {
        const key = (k || "").toString();
        if (/PER/i.test(key)) {
          const v = parseNum((vals && vals[0]) || "");
          if (v !== undefined) perFromTable = v;
        }
        if (/PBR/i.test(key)) {
          const v = parseNum((vals && vals[0]) || "");
          if (v !== undefined) pbrFromTable = v;
        }
      } catch (e) {
        /* ignore */
      }
    }

    // 전체 HTML에서 PER/PBR을 추가 추출 (페이지 구조가 다른 경우 대비)
    const perFromHtml = findFirstNumberInText(
      (html.match(/PER[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );
    const pbrFromHtml = findFirstNumberInText(
      (html.match(/PBR[^\d-]*(-?\d+(?:,\d{3})*(?:\.\d+)?)/i) || [])[1] || ""
    );

    // 우선순위: 표(table) > blind text > 전체 HTML
    const perFallback = currentPer ?? perFromTable ?? perFromBlind ?? perFromHtml;
    const pbrFallback = currentPbr ?? pbrFromTable ?? pbrFromBlind ?? pbrFromHtml;

    if (perFromTable !== undefined) console.info(`fundamental: PER from table (${code}) -> ${perFromTable}`);
    if (pbrFromTable !== undefined) console.info(`fundamental: PBR from table (${code}) -> ${pbrFromTable}`);

    const out: Record<string, string[]> = Object.fromEntries(rows.entries());
    if (perFallback !== undefined) out.__PER_FALLBACK__ = [String(perFallback)];
    if (pbrFallback !== undefined) out.__PBR_FALLBACK__ = [String(pbrFallback)];

    if (perFallback === undefined && pbrFallback === undefined) {
      // 디버깅 용도: 둘 다 못 구하면 짧게 로그 남김
      try {
        const snippet = html.slice(0, 600).replace(/\s+/g, " ");
        console.info(`fundamental: PER/PBR 미발견 (${code}) snippet: ${snippet}`);
      } catch (e) {
        console.info(`fundamental: PER/PBR 미발견 (${code})`);
      }
    }

    return {
      rows: out,
      currentPer,
      currentPbr,
    };
  } catch (e) {
    console.error(`fetchNaverFinanceRows failed (${code}):`, e);
    return { rows: {} };
  }
}

export async function getFundamentalSnapshot(code: string): Promise<FundamentalSnapshot> {
  const [rt, financeData] = await Promise.all([
    fetchRealtimeStockData(code),
    fetchNaverFinanceRows(code),
  ]);

  const { rows, currentPer, currentPbr } = financeData;

  const sales = findLatestActualAnnualValue(rows["매출액"] || []);
  const opIncome = findLatestActualAnnualValue(rows["영업이익"] || []);
  const netIncome = findLatestActualAnnualValue(rows["당기순이익"] || []);
  const salesGrowthPct = growthPctFromRow(rows["매출액"] || []);
  const opIncomeGrowthPct = growthPctFromRow(rows["영업이익"] || []);
  const netIncomeGrowthPct = growthPctFromRow(rows["당기순이익"] || []);
  const debtRatio = findLatestActualAnnualValue(
    rows["부채비율"] || rows["부채비율(%)"] || rows["부채비율연결"] || []
  );
  const roe = findLatestActualAnnualValue(
    rows["ROE(지배주주)"] || rows["ROE"] || rows["ROE(%)"] || []
  );

  const perRaw = rt?.per ?? currentPer ?? parseNum((rows.__PER_FALLBACK__ || [])[0] || "");
  const pbrRaw = rt?.pbr ?? currentPbr ?? parseNum((rows.__PBR_FALLBACK__ || [])[0] || "");

  // Sanity checks: filter out clearly invalid parse results (e.g. very large integers or zero PBR)
  let per: number | undefined = perRaw;
  let pbr: number | undefined = pbrRaw;
  if (per !== undefined && (Math.abs(per) > 1000 || per === 0)) {
    console.info(`fundamental: sanitized PER for ${code} (raw=${per}) -> undefined`);
    per = undefined;
  }
  if (pbr !== undefined && (pbr <= 0 || pbr > 1000)) {
    console.info(`fundamental: sanitized PBR for ${code} (raw=${pbr}) -> undefined`);
    pbr = undefined;
  }

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
