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

export type EtfDistributionSummary = {
  events: EtfDistributionEvent[];
  cadence: "monthly" | "quarterly" | "irregular" | "unknown";
  cadenceLabel: string;
  monthList: number[];
  latestApplyDate?: string;
  latestPayoutDate?: string;
  latestBasePrice?: number;
  latestAmount?: number;
  nextExpectedDate?: string;
  source: string;
};

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

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(/\./g, "-").trim();
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
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
    const noticeDate = normalizeSpace($(anchor).closest("tr").find("td.date").text());
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
    payoutDate: findRowValue($, "5. 지급일") ?? findRowValue($, "실지급일") ?? findRowValue($, "지급일"),
    applyDate: findRowValue($, "4. 적용일") ?? findRowValue($, "적용일"),
  };
}

export async function getEtfDistributionSummary(code: string): Promise<EtfDistributionSummary> {
  const notices = await fetchDistributionNoticeList(code);
  const recent = notices.slice(0, 6);
  const events = await Promise.all(recent.map((event) => enrichDistributionEvent(code, event)));
  const sorted = events.sort((a, b) => {
    const da = parseDate(a.applyDate ?? a.noticeDate)?.getTime() ?? 0;
    const db = parseDate(b.applyDate ?? b.noticeDate)?.getTime() ?? 0;
    return db - da;
  });

  return {
    events: sorted,
    ...deriveCadence(sorted),
    source: "Naver Finance KOSCOM notice",
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