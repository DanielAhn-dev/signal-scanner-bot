import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const FETCH_TIMEOUT_MS = 4000;

export type EtfHolding = {
  name: string;
  weight?: string;
};

export type EtfDistributionEvent = {
  noticeId: string;
  title: string;
  noticeDate: string;
  applyDate?: string;
  payoutDate?: string;
  basePrice?: number;
  amount?: number;
  taxBaseAmount?: number;
  yieldPct?: number;
};

export type EtfAnnualDistributionPoint = {
  year: number;
  amount?: number;
  yieldPct?: number;
};

export type EtfDistributionSummary = {
  events: EtfDistributionEvent[];
  cadence: "monthly" | "quarterly" | "irregular" | "unknown";
  cadenceLabel: string;
  monthList: number[];
  latestApplyDate?: string;
  latestPayoutDate?: string;
  latestBasePrice?: number;
  latestAmount?: number;
  annualAmount?: number;
  annualYieldPct?: number;
  annualAsOf?: string;
  annualYear?: number;
  annualHistory?: EtfAnnualDistributionPoint[];
  nextExpectedDate?: string;
  source: string;
};

type EtfAnnualDistribution = {
  year?: number;
  asOf?: string;
  amount?: number;
  yieldPct?: number;
  history: EtfAnnualDistributionPoint[];
};

type KodexDistributionRow = {
  fNm?: string;
  stkTicker?: string;
  fid?: string;
  gijunYMD?: string;
  basicD?: string;
  payD?: string;
  dividA?: string | number | null;
  taxDividA?: string | number | null;
  dividY?: string | number | null;
  monthlyDividendYn?: string | null;
};

type KodexDistributionResponse = {
  dividList?: KodexDistributionRow[];
  totalCnt?: number;
};

let tigerAnnualDistributionCache: Promise<Map<string, EtfAnnualDistribution>> | null = null;
let kodexDistributionCache: Promise<KodexDistributionRow[]> | null = null;

export type EtfSnapshot = {
  marketCapText?: string;
  underlyingIndex?: string;
  etfType?: string;
  listingDate?: string;
  expenseRatio?: string;
  assetManager?: string;
  nav?: number;
  latestNav?: number;
  latestNavDate?: string;
  premiumRate?: number;
  holdings: EtfHolding[];
  source: string;
};

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMatchKey(value?: string): string {
  return normalizeSpace(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = /^\d{8}$/.test(trimmed)
    ? `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
    : trimmed.replace(/\./g, "-");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateText(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = parseDate(value);
  return parsed ? formatDate(parsed) : normalizeSpace(value);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function monthDiff(a: Date, b: Date): number {
  return Math.abs((a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth());
}

function parseNum(value?: string): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function findRowValue($: cheerio.CheerioAPI, label: string): string | undefined {
  let found: string | undefined;
  $("tr").each((_, tr) => {
    if (found) return false;
    const th = $(tr).find("th").first();
    const td = $(tr).find("td").first();
    if (!th.length || !td.length) return;
    const thText = normalizeSpace(th.text());
    if (thText === label) {
      const value = normalizeSpace(td.text());
      if (value) found = value;
    }
  });
  return found;
}

function parseNavHistory($: cheerio.CheerioAPI): {
  latestNav?: number;
  latestNavDate?: string;
  premiumRate?: number;
} {
  let latestNav: number | undefined;
  let latestNavDate: string | undefined;
  let premiumRate: number | undefined;

  $("table").each((_, table) => {
    if (latestNavDate) return false;
    const tableText = normalizeSpace($(table).text());
    if (!tableText.includes("NAV") || !tableText.includes("괴리율")) return;

    $(table)
      .find("tr")
      .each((__, tr) => {
        if (latestNavDate) return false;
        const cells = $(tr)
          .find("td")
          .map((___, td) => normalizeSpace($(td).text()))
          .get()
          .filter(Boolean);
        if (cells.length < 4) return;
        if (!/^\d{4}\.\d{2}\.\d{2}$/.test(cells[0])) return;

        latestNavDate = cells[0];
        latestNav = parseNum(cells[2]);
        premiumRate = parseNum(cells[3]);
        return false;
      });
  });

  return { latestNav, latestNavDate, premiumRate };
}

function parseHoldings($: cheerio.CheerioAPI): EtfHolding[] {
  const holdings: EtfHolding[] = [];

  $("table").each((_, table) => {
    if (holdings.length) return false;
    const tableText = normalizeSpace($(table).text());
    if (!tableText.includes("구성종목") || !tableText.includes("구성비중")) return;

    $(table)
      .find("tr")
      .each((__, tr) => {
        if (holdings.length >= 5) return false;
        const cells = $(tr)
          .find("td")
          .map((___, td) => normalizeSpace($(td).text()))
          .get()
          .filter(Boolean);
        if (cells.length < 3) return;
        const [name, , weight] = cells;
        if (!name || name === "구성종목(구성자산)") return;
        holdings.push({ name, weight });
      });
  });

  return holdings;
}

function isTigerEtf(name?: string): boolean {
  return Boolean(name && /^TIGER\b/i.test(name.trim()));
}

async function fetchTigerAnnualDistributionMap(): Promise<Map<string, EtfAnnualDistribution>> {
  const today = new Date().toLocaleDateString("sv-SE").replace(/-/g, ".");
  const response = await fetch("https://investments.miraeasset.com/tigeretf/ko/distribution/annual/excel.do", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: "https://investments.miraeasset.com/tigeretf/ko/distribution/annual/list.do",
    },
    body: new URLSearchParams({
      pageIndex: "1",
      listCnt: "10",
      orderType: "",
      orderB: "",
      orderC: "",
      q: "",
      cateNameYn: "Y",
      gubun: "",
      clsnPrcStrtDt: today,
      clsnPrcEndDt: today,
      fixDate: "",
    }),
  });

  if (!response.ok) {
    throw new Error(`TIGER 분배금 파일 조회 실패 (${response.status})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const map = new Map<string, EtfAnnualDistribution>();
  const headerCells = $("table thead th")
    .map((_, th) => normalizeSpace($(th).text()))
    .get();
  const yearColumns = headerCells
    .map((text, index) => {
      const match = text.match(/(\d{4})년\s*분배금/);
      if (!match) return null;
      return {
        year: Number(match[1]),
        amountIndex: index,
        yieldIndex: index + 1,
      };
    })
    .filter((entry): entry is { year: number; amountIndex: number; yieldIndex: number } => Boolean(entry));
  const asOf = $("h1")
    .map((_, node) => normalizeSpace($(node).text()))
    .get()
    .map((text) => text.match(/기준일\s*:?\s*(\d{4}\.\d{2}\.\d{2})/))
    .find(Boolean)?.[1];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => normalizeSpace($(td).text()))
      .get();
    if (cells.length < 4) return;

    const name = cells[0];
    if (!name) return;

    const history = yearColumns
      .map((column) => ({
        year: column.year,
        amount: parseNum(cells[column.amountIndex]),
        yieldPct: parseNum(cells[column.yieldIndex]),
      }))
      .filter((entry) => entry.amount !== undefined || entry.yieldPct !== undefined);

    const latest = history[0];

    map.set(name, {
      year: latest?.year,
      asOf,
      amount: latest?.amount,
      yieldPct: latest?.yieldPct,
      history,
    });
  });

  return map;
}

async function getTigerAnnualDistribution(name?: string): Promise<EtfAnnualDistribution | undefined> {
  if (!isTigerEtf(name)) return undefined;
  tigerAnnualDistributionCache ??= fetchTigerAnnualDistributionMap().catch((error) => {
    tigerAnnualDistributionCache = null;
    throw error;
  });
  const map = await tigerAnnualDistributionCache;
  return map.get(name!.trim());
}

function deriveCadence(events: EtfDistributionEvent[]): Omit<EtfDistributionSummary, "events" | "source"> {
  const applied = events
    .map((event) => parseDate(event.applyDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime());

  const monthList = [...new Set(applied.map((date) => date.getMonth() + 1))].sort((a, b) => a - b);
  const diffs = applied.slice(1).map((date, idx) => monthDiff(date, applied[idx]));

  let cadence: EtfDistributionSummary["cadence"] = "unknown";
  if (diffs.length >= 2 && diffs.slice(0, 3).every((diff) => diff === 1)) {
    cadence = "monthly";
  } else if (diffs.length >= 2 && diffs.slice(0, 3).every((diff) => diff === 3)) {
    cadence = "quarterly";
  } else if (applied.length > 0) {
    cadence = "irregular";
  }

  const cadenceLabel = cadence === "monthly"
    ? "월분배"
    : cadence === "quarterly"
      ? "분기분배"
      : cadence === "irregular"
        ? "비정기/확인필요"
        : "판별불가";

  const latestApplyDate = applied[0] ? formatDate(applied[0]) : undefined;
  const nextExpectedDate = applied[0]
    ? cadence === "monthly"
      ? formatDate(addMonths(applied[0], 1))
      : cadence === "quarterly"
        ? formatDate(addMonths(applied[0], 3))
        : undefined
    : undefined;

  return {
    cadence,
    cadenceLabel,
    monthList,
    latestApplyDate,
    latestPayoutDate: events[0]?.payoutDate,
    latestBasePrice: events[0]?.basePrice,
    latestAmount: events[0]?.amount,
    nextExpectedDate,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ETF 페이지 조회 실패 (${response.status})`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ETF JSON 조회 실패 (${response.status})`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDistributionNoticeList(code: string): Promise<EtfDistributionEvent[]> {
  const html = await fetchHtml(
    `https://finance.naver.com/item/news_notice.naver?code=${encodeURIComponent(code)}`
  );
  const $ = cheerio.load(html);
  const events: EtfDistributionEvent[] = [];

  $("td.title a").each((_, anchor) => {
    const title = normalizeSpace($(anchor).text());
    if (!title.includes("분배락 기준가격")) return;

    const href = $(anchor).attr("href") ?? "";
    const noticeId = href.match(/no=(\d+)/)?.[1];
    const noticeDate = normalizeDateText($(anchor).closest("tr").find("td.date").text());
    if (!noticeId || !noticeDate) return;

    events.push({
      noticeId,
      title,
      noticeDate,
    });
  });

  return events;
}

async function enrichDistributionEvent(code: string, event: EtfDistributionEvent): Promise<EtfDistributionEvent> {
  const html = await fetchHtml(
    `https://finance.naver.com/item/news_notice_read.naver?no=${encodeURIComponent(event.noticeId)}&code=${encodeURIComponent(code)}&page_notice=`
  );
  const $ = cheerio.load(html);

  return {
    ...event,
    basePrice: parseNum(findRowValue($, "2. 기준가격(원)") ?? findRowValue($, "기준가격(원)")),
    payoutDate: normalizeDateText(
      findRowValue($, "5. 지급일") ?? findRowValue($, "실지급일") ?? findRowValue($, "지급일")
    ),
    applyDate: normalizeDateText(findRowValue($, "4. 적용일") ?? findRowValue($, "적용일")),
  };
}

async function fetchKodexDistributionRows(): Promise<KodexDistributionRow[]> {
  const firstPage = await fetchJson<KodexDistributionResponse>(
    "https://www.samsungfund.com/api/v1/kodex/distribution.do"
  );
  const firstRows = firstPage.dividList ?? [];
  const totalCnt = firstPage.totalCnt ?? firstRows.length;
  const pageSize = firstRows.length || 12;
  const totalPages = Math.max(1, Math.ceil(totalCnt / pageSize));

  if (totalPages <= 1) return firstRows;

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchJson<KodexDistributionResponse>(
        `https://www.samsungfund.com/api/v1/kodex/distribution.do?pageNo=${index + 2}`
      )
    )
  );

  return [
    ...firstRows,
    ...restPages.flatMap((page) => page.dividList ?? []),
  ];
}

async function getKodexDistributionRows(): Promise<KodexDistributionRow[]> {
  kodexDistributionCache ??= fetchKodexDistributionRows().catch((error) => {
    kodexDistributionCache = null;
    throw error;
  });
  return kodexDistributionCache;
}

async function getKodexLatestDistribution(code: string, etfName?: string): Promise<EtfDistributionEvent | undefined> {
  const rows = await getKodexDistributionRows();
  const normalizedName = normalizeMatchKey(etfName);

  const matched = rows.find((row) => row.stkTicker === code)
    ?? rows.find((row) => {
      const rowName = normalizeMatchKey(row.fNm);
      return Boolean(
        normalizedName
        && rowName
        && (rowName === normalizedName || rowName.includes(normalizedName) || normalizedName.includes(rowName))
      );
    });

  if (!matched) return undefined;

  const applyDate = normalizeDateText(matched.basicD);
  return {
    noticeId: matched.fid ?? `kodex:${matched.stkTicker ?? code}`,
    title: "KODEX 분배금 현황",
    noticeDate: applyDate ?? normalizeDateText(matched.gijunYMD) ?? formatDate(new Date()),
    applyDate,
    payoutDate: normalizeDateText(matched.payD),
    amount: parseNum(String(matched.dividA ?? "")),
    taxBaseAmount: parseNum(String(matched.taxDividA ?? "")),
    yieldPct: parseNum(String(matched.dividY ?? "")),
  };
}

function mergeIssuerEvent(
  events: EtfDistributionEvent[],
  issuerEvent?: EtfDistributionEvent
): EtfDistributionEvent[] {
  if (!issuerEvent) return events;

  const merged = [...events];
  const matchIndex = merged.findIndex((event) =>
    Boolean(
      event.applyDate
      && issuerEvent.applyDate
      && event.applyDate === issuerEvent.applyDate
    )
  );

  if (matchIndex >= 0) {
    merged[matchIndex] = {
      ...merged[matchIndex],
      ...issuerEvent,
      noticeId: merged[matchIndex].noticeId,
      title: merged[matchIndex].title,
      noticeDate: merged[matchIndex].noticeDate,
    };
    return merged;
  }

  merged.push(issuerEvent);
  return merged;
}

export async function getEtfDistributionSummary(code: string, etfName?: string): Promise<EtfDistributionSummary> {
  const notices = await fetchDistributionNoticeList(code).catch(() => []);
  const recent = notices.slice(0, 6);
  const enrichedEvents = await Promise.all(recent.map((event) => enrichDistributionEvent(code, event)));
  const kodexEvent = /^KODEX\b/i.test(etfName?.trim() ?? "")
    ? await getKodexLatestDistribution(code, etfName).catch(() => undefined)
    : undefined;
  const mergedEvents = mergeIssuerEvent(enrichedEvents, kodexEvent);
  const sorted = mergedEvents.sort((a, b) => {
    const da = parseDate(a.applyDate ?? a.noticeDate)?.getTime() ?? 0;
    const db = parseDate(b.applyDate ?? b.noticeDate)?.getTime() ?? 0;
    return db - da;
  });
  const annual = await getTigerAnnualDistribution(etfName).catch(() => undefined);
  const sourceParts = [
    notices.length ? "Naver Finance KOSCOM notice" : undefined,
    kodexEvent ? "KODEX distribution API" : undefined,
    annual ? "TIGER annual distribution export" : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    events: sorted,
    ...deriveCadence(sorted),
    annualAmount: annual?.amount,
    annualYieldPct: annual?.yieldPct,
    annualAsOf: annual?.asOf,
    annualYear: annual?.year,
    annualHistory: annual?.history,
    source: sourceParts.join(" + ") || "ETF issuer page",
  };
}

export async function getEtfSnapshot(code: string): Promise<EtfSnapshot> {
  const html = await fetchHtml(
    `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`
  );
    const $ = cheerio.load(html);

    const nav = parseNum(findRowValue($, "NAV"));
    const { latestNav, latestNavDate, premiumRate } = parseNavHistory($);

    return {
      marketCapText: findRowValue($, "시가총액"),
      underlyingIndex: findRowValue($, "기초지수"),
      etfType: findRowValue($, "유형"),
      listingDate: findRowValue($, "상장일"),
      expenseRatio: findRowValue($, "펀드보수"),
      assetManager: findRowValue($, "자산운용사"),
      nav,
      latestNav,
      latestNavDate,
      premiumRate,
      holdings: parseHoldings($),
      source: "Naver Finance",
    };
}