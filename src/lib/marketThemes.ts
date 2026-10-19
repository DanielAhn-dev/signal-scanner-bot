// src/lib/marketThemes.ts
// 네이버 모바일 테마 응답 파싱 + 테마 이름 → 뉴스 제목 언급 매칭 (수집 스크립트 scripts/collect_market_themes.ts)
// 흐름 점수·근거 판정은 src/lib/themeFlow.ts

import { analyzeNewsSentiment } from "./newsSentiment";

export type ThemeListRow = {
  themeNo: number;
  name: string;
  changeRate: number;
  riseCount: number;
  fallCount: number;
  totalCount: number;
};

export type ThemeMember = {
  code: string;
  name: string;
  changeRate: number;
  /** 원 */
  tradingValue: number;
  /** KST 'YYYY-MM-DD' — 이 종목 시세의 거래일 */
  tradedDate: string | null;
};

export type HeadlineTone = "pos" | "neg" | "neutral";

export type ThemeNewsItem = {
  title: string;
  link: string;
  office: string;
  /** yyyyMMddHHmm */
  at: string;
  tone: HeadlineTone;
};

export type Headline = Omit<ThemeNewsItem, "tone">;

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** GET m.stock.naver.com/api/stocks/theme?page=&pageSize= */
export function parseThemeList(body: unknown): { rows: ThemeListRow[]; totalCount: number; marketStatus: string | null } {
  const b = (body ?? {}) as { groups?: unknown[]; totalCount?: unknown; marketStatus?: unknown };
  const rows: ThemeListRow[] = [];
  for (const g of Array.isArray(b.groups) ? b.groups : []) {
    const x = g as Record<string, unknown>;
    const themeNo = Number(x.no);
    const name = String(x.name ?? "").trim();
    if (!Number.isInteger(themeNo) || !name) continue;
    rows.push({
      themeNo,
      name,
      changeRate: num(x.changeRate),
      riseCount: num(x.riseCount),
      fallCount: num(x.fallCount),
      totalCount: num(x.totalCount),
    });
  }
  return { rows, totalCount: num(b.totalCount), marketStatus: typeof b.marketStatus === "string" ? b.marketStatus : null };
}

/** GET m.stock.naver.com/api/stocks/theme/{no}?page=&pageSize= */
export function parseThemeMembers(body: unknown): { members: ThemeMember[]; totalCount: number } {
  const b = (body ?? {}) as { stocks?: unknown[]; totalCount?: unknown };
  const members: ThemeMember[] = [];
  for (const s of Array.isArray(b.stocks) ? b.stocks : []) {
    const x = s as Record<string, unknown>;
    const code = String(x.itemCode ?? "").trim();
    if (!/^[0-9A-Z]{6}$/.test(code)) continue;
    const traded = String(x.localTradedAt ?? "");
    members.push({
      code,
      name: String(x.stockName ?? "").trim(),
      changeRate: num(x.fluctuationsRatio),
      // accumulatedTradingValueRaw는 원 단위, 없으면 accumulatedTradingValue(백만원) × 1e6
      tradingValue: x.accumulatedTradingValueRaw != null ? num(x.accumulatedTradingValueRaw) : num(x.accumulatedTradingValue) * 1_000_000,
      tradedDate: /^\d{4}-\d{2}-\d{2}/.test(traded) ? traded.slice(0, 10) : null,
    });
  }
  return { members, totalCount: num(b.totalCount) };
}

/** GET m.stock.naver.com/api/news/list?category=mainnews 한 페이지 */
export function parseMainNewsList(body: unknown): Headline[] {
  const out: Headline[] = [];
  for (const r of Array.isArray(body) ? body : []) {
    const x = r as Record<string, unknown>;
    const title = String(x.tit ?? x.title ?? "").trim();
    const oid = String(x.oid ?? x.officeId ?? "");
    const aid = String(x.aid ?? x.articleId ?? "");
    const at = String(x.dt ?? x.datetime ?? "").slice(0, 12);
    if (!title || !oid || !aid) continue;
    out.push({ title, link: `https://n.news.naver.com/mnews/article/${oid}/${aid}`, office: String(x.ohnm ?? x.officeName ?? ""), at });
  }
  return out;
}

/**
 * 테마 이름에서 혼자 쓰이면 거의 모든 기사에 걸리는 낱말. 테마 이름을 '/'와 괄호로 나눈 조각이 이것뿐이면 버린다.
 * ("반도체 재료/부품" → "부품", "로봇(산업용/협동로봇 등)" → "산업용", 기사 꼬리표 "[분석+]" → "분석")
 */
const GENERIC_FRAGMENTS = new Set([
  "ai", "it", "등", "관련", "관련주", "수혜", "수혜주", "부품", "소재", "장비", "재료", "생산", "산업용", "대표주",
  "기타", "분석", "전망", "시장", "투자", "국내", "해외", "글로벌", "신규", "테마", "종목", "기업", "산업", "사업", "서비스", "제조", "유통",
]);

const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 테마 이름 → 제목 매칭 낱말 (공백 없앤 소문자). 바깥 이름·'/' 조각·괄호 안 조각 */
export function themeKeywords(name: string): string[] {
  const inner: string[] = [];
  const outer = name.replace(/\(([^)]*)\)/g, (_m, g: string) => {
    inner.push(g);
    return " ";
  });
  const pieces = [...outer.split("/"), ...inner.flatMap((g) => g.split(/[\/,]/))];
  const out = new Set<string>();
  for (const p of pieces) {
    const k = compact(p.replace(/\s등$/, "").replace(/등$/, ""));
    if (k.length < 2 || GENERIC_FRAGMENTS.has(k)) continue;
    out.add(k);
  }
  return [...out];
}

/**
 * 시장 기사 제목에 흔한 방향 낱말. newsSentiment는 개별 종목 공시·실적 위주라 "급락·지연·우려" 같은 시황 낱말을 못 잡는다.
 * 여기서는 기사 칸에 반대쪽 기사를 하나 남기는 데만 쓴다(점수·판정에는 안 씀).
 */
const MARKET_POS = ["급등", "강세", "신고가", "최고가", "호재", "수혜", "반등", "돌파", "훈풍", "기대감"];
const MARKET_NEG = ["급락", "폭락", "약세", "우려", "지연", "둔화", "쇼크", "의구심", "거품", "버블", "탈출", "이탈", "경고", "악재", "초토화"];

export function headlineTone(title: string): HeadlineTone {
  const pos = MARKET_POS.filter((k) => title.includes(k)).length;
  const neg = MARKET_NEG.filter((k) => title.includes(k)).length;
  const s = analyzeNewsSentiment([title]).score + (pos - neg) * 2;
  return s > 0 ? "pos" : s < 0 ? "neg" : "neutral";
}

/** 테마별 제목 언급 수와 대표 기사(부정 기사를 하나는 남겨 한쪽 기사만 보이지 않게) */
export function matchThemeNews(
  themes: Array<{ themeNo: number; name: string }>,
  headlines: Headline[],
  keep = 3
): Map<number, { count: number; items: ThemeNewsItem[] }> {
  const prepared = headlines.map((h) => ({ h, key: compact(h.title) }));
  const out = new Map<number, { count: number; items: ThemeNewsItem[] }>();
  for (const t of themes) {
    const kws = themeKeywords(t.name);
    if (!kws.length) {
      out.set(t.themeNo, { count: 0, items: [] });
      continue;
    }
    const hits = prepared.filter((p) => kws.some((k) => p.key.includes(k))).map((p) => ({ ...p.h, tone: headlineTone(p.h.title) }));
    hits.sort((a, b) => b.at.localeCompare(a.at));
    const items = hits.slice(0, keep);
    const firstNeg = hits.find((h) => h.tone === "neg");
    if (firstNeg && !items.some((h) => h.tone === "neg")) items[items.length - 1] = firstNeg;
    out.set(t.themeNo, { count: hits.length, items });
  }
  return out;
}
