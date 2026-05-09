// src/utils/fetchCreditShortData.ts
// 신용비율(Naver Finance HTML) + 공매도 잔고비율(KRX API) 조회

import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 7000;

export interface CreditShortSnapshot {
  creditRatio: number | null;   // 신용비율 (%)
  shortRatio: number | null;    // 공매도 잔고비율 (%)
  shortBalance: number | null;  // 공매도 잔고 수량 (주)
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseNumStr(s: string): number | null {
  const cleaned = s.replace(/[,%]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function buildISIN(code6: string): string {
  return `KR7${code6.padStart(6, "0")}0003`;
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Naver Finance 종목 메인 페이지에서 신용비율 스크래핑 */
async function fetchCreditRatioFromNaver(code: string): Promise<number | null> {
  try {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    let creditRatio: number | null = null;

    // 투자정보 테이블에서 "신용비율" 레이블을 찾아 인접 td 값 파싱
    $("th, dt").each((_, el) => {
      const label = $(el).text().trim();
      if (label === "신용비율") {
        // th → 다음 td
        const td = $(el).next("td");
        if (td.length) {
          const raw = td.text().trim();
          creditRatio = parseNumStr(raw);
          return false;
        }
        // dt → 다음 dd
        const dd = $(el).next("dd");
        if (dd.length) {
          creditRatio = parseNumStr(dd.text().trim());
          return false;
        }
      }
    });

    // 대안: 정규식으로 "신용비율" 뒤 숫자 추출
    if (creditRatio === null) {
      const match = html.match(/신용비율[^0-9]*([0-9]+\.?[0-9]*)/);
      if (match) creditRatio = parseNumStr(match[1]);
    }

    return creditRatio;
  } catch {
    return null;
  }
}

/** KRX API에서 종목별 공매도 잔고 현황 조회 */
async function fetchShortDataFromKRX(code: string): Promise<{
  shortRatio: number | null;
  shortBalance: number | null;
} | null> {
  try {
    const isin = buildISIN(code);
    const today = new Date();
    const endDate = yyyymmdd(today);
    const startDate = (() => {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      return yyyymmdd(d);
    })();

    const form = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT10401",
      isuCd: isin,
      strtDd: startDate,
      endDd: endDate,
      money: "1",
      csvxls_isNo: "false",
    });

    const res = await fetchWithTimeout(
      "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
      {
        method: "POST",
        body: form,
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    // KRX 응답은 OutBlock_1 또는 outBlock_1
    const block = data?.OutBlock_1 ?? data?.outBlock_1;
    const rows = Array.isArray(block) ? block : block ? [block] : [];
    if (!rows.length) return null;

    // 최근 행 기준 (내림차순 정렬 가정)
    const row = rows[0] as Record<string, unknown>;

    // 공매도 잔고비율: STCK_BAL_RT 또는 SHRT_BAL_RT
    const shortRatioRaw =
      String(row?.STCK_BAL_RT ?? row?.SHRT_BAL_RT ?? "").replace(/,/g, "");
    const shortRatio = parseNumStr(shortRatioRaw);

    // 공매도 잔고 수량: END_SNTT_STKCNT 또는 BAL_STKCNT
    const shortBalanceRaw =
      String(row?.END_SNTT_STKCNT ?? row?.BAL_STKCNT ?? "").replace(/,/g, "");
    const shortBalance = parseNumStr(shortBalanceRaw);

    return {
      shortRatio: Number.isFinite(shortRatio ?? NaN) ? shortRatio : null,
      shortBalance: Number.isFinite(shortBalance ?? NaN) ? shortBalance : null,
    };
  } catch {
    return null;
  }
}

/** 신용비율 + 공매도 잔고비율을 병렬로 조회 */
export async function fetchCreditShortSnapshot(
  code: string,
): Promise<CreditShortSnapshot> {
  const [creditResult, shortResult] = await Promise.allSettled([
    fetchCreditRatioFromNaver(code),
    fetchShortDataFromKRX(code),
  ]);

  return {
    creditRatio:
      creditResult.status === "fulfilled" ? creditResult.value : null,
    shortRatio:
      shortResult.status === "fulfilled"
        ? (shortResult.value?.shortRatio ?? null)
        : null,
    shortBalance:
      shortResult.status === "fulfilled"
        ? (shortResult.value?.shortBalance ?? null)
        : null,
  };
}
