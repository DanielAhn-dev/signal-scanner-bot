import type { ChatContext } from "../router";
import { supabase } from "../../db/client";
import { searchByNameOrCode } from "../../search/normalize";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { getEtfDistributionSummary, getEtfSnapshot } from "../../services/etfService";
import {
  handleEtfCommand,
  handleEtfCoreCommand,
  handleEtfThemeCommand,
} from "./marketPicks";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import { actionButtons, ACTIONS, buildMessage, bullets, divider, header, section } from "../messages/layout";

type EtfHit = {
  code: string;
  name: string;
  market?: string | null;
};

const ETF_NAME_HINT = /^(ETF|KODEX|TIGER|KOSEF|KBSTAR|ACE|RISE|SOL|HANARO|ARIRANG|PLUS|TIMEFOLIO|WOORI|WON)\b/i;

function isEtfLike(row: Pick<EtfHit, "name" | "market">): boolean {
  return row.market === "ETF" || ETF_NAME_HINT.test(row.name || "");
}

async function resolveEtfHits(query: string, limit = 5): Promise<EtfHit[]> {
  const hits = await searchByNameOrCode(query, Math.max(limit, 8));
  const uniqueCodes = [...new Set(hits.map((hit) => hit.code))];

  if (uniqueCodes.length) {
    const { data } = await supabase
      .from("stocks")
      .select("code,name,market")
      .in("code", uniqueCodes);

    const hitMap = new Map((data ?? []).map((row: any) => [row.code, row]));
    const filtered = uniqueCodes
      .map((code) => hitMap.get(code))
      .filter((row: any): row is EtfHit => Boolean(row && isEtfLike(row)))
      .slice(0, limit);
    if (filtered.length) return filtered;
  }

  const { data: directRows } = await supabase
    .from("stocks")
    .select("code,name,market")
    .ilike("name", `%${query}%`)
    .limit(limit * 3);

  return ((directRows ?? []) as EtfHit[])
    .filter((row) => isEtfLike(row))
    .slice(0, limit);
}

function buildHubMessage(): string {
  return buildMessage([
    header("ETF 허브", "적립형·테마형·NAV/괴리율 중심 1차 ETF 도구"),
    section(
      "무엇을 할 수 있나",
      bullets([
        "/etf — ETF 보수형 추천 TOP5",
        "/etfcore — 장기 분할매수용 안정형 ETF 후보",
        "/etftheme — 반도체·AI·전력 등 테마형 ETF 후보",
        "/etfinfo 종목명 — NAV·괴리율·기초지수·보수 요약",
        "/etfdiv 종목명 — 배당락 주기·최근 기준가격 히스토리",
      ])
    ),
    divider(),
    section(
      "분배금",
      bullets([
        "배당락 공시 기준으로 월/분기 패턴과 최근 기준가격 히스토리를 보여줍니다.",
        "분배금 금액은 운용사 상세 페이지 연동이 필요한 후속 항목입니다.",
      ])
    ),
  ]);
}

function formatPremiumComment(premiumRate?: number): string {
  if (premiumRate === undefined) return "괴리율 데이터 없음";
  if (premiumRate >= 1) return "NAV 대비 고평가 구간이라 추격매수는 보수적으로 보는 편이 좋습니다.";
  if (premiumRate <= -1) return "NAV 대비 저평가 구간입니다. 유동성·스프레드 확인 후 분할 접근이 유리합니다.";
  return "괴리율이 크지 않아 NAV 대비 가격 괴리는 안정적인 편입니다.";
}

function formatMonthList(months: number[]): string {
  if (!months.length) return "확인 필요";
  return months.map((month) => `${month}월`).join(", ");
}

function formatDistributionAmount(amount?: number): string {
  if (amount === undefined) return "확인중";
  return `${fmtInt(amount)}원`;
}

export async function handleEtfInfoCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /etfinfo ETF명 또는 코드\n예) /etfinfo KODEX 200",
    });
  }

  const hits = await resolveEtfHits(query, 5);
  if (!hits.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "ETF를 찾지 못했습니다. ETF명 또는 코드를 확인해주세요.",
    });
  }

  if (hits.length > 1 && !/^\d{6}$/.test(query)) {
    const btns = hits.map((hit) => ({
      text: `${hit.name} (${hit.code})`,
      callback_data: `etfinfo:${hit.code}`,
    }));

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(query)}' 검색 결과 ${hits.length}건 — ETF를 선택하세요`,
      parse_mode: "HTML",
      reply_markup: actionButtons(btns, 2),
    });
  }

  const target = hits[0];
  const [realtime, snapshot] = await Promise.all([
    fetchRealtimeStockData(target.code),
    getEtfSnapshot(target.code).catch(() => null),
  ]);

  const price = realtime?.price;
  const nav = snapshot?.nav ?? snapshot?.latestNav;
  const premiumRate = snapshot?.premiumRate;
  const premiumLine = premiumRate !== undefined ? fmtPct(premiumRate) : "-";

  const lines: string[] = [];
  if (price) {
    lines.push(`현재가 <code>${fmtInt(price)}원</code> · 등락률 <code>${fmtPct(realtime?.changeRate ?? 0)}</code>`);
  }
  if (nav !== undefined) {
    lines.push(`NAV <code>${fmtInt(nav)}</code> · 괴리율 <code>${premiumLine}</code>`);
  }
  if (snapshot?.latestNavDate) {
    lines.push(`최근 NAV 기준일 <code>${esc(snapshot.latestNavDate)}</code>`);
  }
  if (snapshot?.underlyingIndex) {
    lines.push(`기초지수 <code>${esc(snapshot.underlyingIndex)}</code>`);
  }
  if (snapshot?.etfType) {
    lines.push(`유형 <code>${esc(snapshot.etfType)}</code>`);
  }
  if (snapshot?.expenseRatio) {
    lines.push(`펀드보수 <code>${esc(snapshot.expenseRatio)}</code>`);
  }
  if (snapshot?.assetManager) {
    lines.push(`운용사 <code>${esc(snapshot.assetManager)}</code>`);
  }
  if (snapshot?.marketCapText) {
    lines.push(`시가총액 <code>${esc(snapshot.marketCapText)}</code>`);
  }

  const holdings = (snapshot?.holdings ?? [])
    .slice(0, 4)
    .map((item) => `${item.name}${item.weight ? ` ${item.weight}` : ""}`);

  const text = buildMessage([
    header(`${target.name}`, `${target.code} ETF 정보`),
    section("ETF 핵심 지표", lines.length ? lines : ["ETF 투자 정보를 가져오지 못했습니다."]),
    holdings.length ? section("상위 구성자산", bullets(holdings)) : undefined,
    divider(),
    section("해석", [formatPremiumComment(premiumRate)]),
    snapshot?.source ? `<i>출처: ${esc(snapshot.source)}</i>` : undefined,
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.analyzeEtf(target.code), 2),
  });
}

export async function handleEtfDistributionCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /etfdiv ETF명 또는 코드\n예) /etfdiv KODEX 200",
    });
  }

  const hits = await resolveEtfHits(query, 5);
  if (!hits.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "ETF를 찾지 못했습니다. ETF명 또는 코드를 확인해주세요.",
    });
  }

  if (hits.length > 1 && !/^\d{6}$/.test(query)) {
    const btns = hits.map((hit) => ({
      text: `${hit.name} (${hit.code})`,
      callback_data: `etfdiv:${hit.code}`,
    }));

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(query)}' 검색 결과 ${hits.length}건 — ETF를 선택하세요`,
      parse_mode: "HTML",
      reply_markup: actionButtons(btns, 2),
    });
  }

  const target = hits[0];
  const summary = await getEtfDistributionSummary(target.code, target.name).catch(() => null);

  if (!summary || !summary.events.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: buildMessage([
        header(`${target.name}`, `${target.code} 분배금/배당락 정보`),
        section("현재 상태", bullets([
          "최근 분배락 공시를 찾지 못했습니다.",
          "신규 ETF이거나 공시 이력이 짧은 경우일 수 있습니다.",
        ])),
      ]),
      parse_mode: "HTML",
      reply_markup: actionButtons(ACTIONS.analyzeEtf(target.code), 2),
    });
  }

  const latest = summary.events[0];
  const historyLines = summary.events.slice(0, 4).map((event) => {
    const apply = event.applyDate ?? event.noticeDate;
    const base = event.basePrice ? ` · 기준가격 ${fmtInt(event.basePrice)}원` : "";
    const amount = event.amount !== undefined ? ` · 분배금 ${fmtInt(event.amount)}원` : "";
    return `${apply}${base}${amount}`;
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: buildMessage([
      header(`${target.name}`, `${target.code} 분배금/배당락 요약`),
      section("분배 패턴", bullets([
        `주기: ${summary.cadenceLabel}`,
        `주로 받는 월: ${formatMonthList(summary.monthList)}`,
        `최근 배당락 적용일: ${latest.applyDate ?? latest.noticeDate}`,
        summary.latestPayoutDate ? `최근 실지급일: ${summary.latestPayoutDate}` : "실지급일: 공시 확인 필요",
        summary.nextExpectedDate ? `다음 예상 배당락: ${summary.nextExpectedDate}` : "다음 배당락: 공시 확인 필요",
      ])),
      section("최근 공시", bullets(historyLines)),
      divider(),
      section("안내", bullets([
        latest.basePrice ? `최근 분배락 기준가격은 ${fmtInt(latest.basePrice)}원입니다.` : "최근 기준가격 데이터는 일부 공시에서만 확인됩니다.",
        summary.annualAmount !== undefined
          ? `${summary.annualYear ?? "올해"} 누적 분배금: ${fmtInt(summary.annualAmount)}원${summary.annualYieldPct != null ? ` · 분배율 ${fmtPct(summary.annualYieldPct)}` : ""}`
          : `최근 확인된 주당 분배금: ${formatDistributionAmount(summary.latestAmount)}`,
        summary.annualAmount !== undefined
          ? `TIGER 연간 분배금 공시 기준 ${summary.annualAsOf ?? "최신 기준일"} 누적값입니다.`
          : summary.latestAmount === undefined
            ? "운용사 분배금 현황 연동이 아직 제한적이라 일부 ETF는 금액이 공시만으로는 비어 있을 수 있습니다."
            : "분배금 금액은 확보된 운용사 소스가 있을 때 우선 표시합니다.",
      ])),
      `<i>출처: ${esc(summary.source)}</i>`,
    ]),
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.analyzeEtf(target.code), 2),
  });
}

export async function handleEtfHubCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: buildHubMessage(),
      parse_mode: "HTML",
      reply_markup: actionButtons(ACTIONS.etfHub, 2),
    });
  }

  if (/^(추천|top|top5|랭킹|기본)$/i.test(query)) {
    return handleEtfCommand(ctx, tgSend);
  }
  if (/^(적립|안정|코어|장기|모아가기|모으기)$/i.test(query)) {
    return handleEtfCoreCommand(ctx, tgSend);
  }
  if (/^(테마|스윙|모멘텀|단타|회전)$/i.test(query)) {
    return handleEtfThemeCommand(ctx, tgSend);
  }

  const infoMatch = query.match(/^(?:정보|nav|괴리율|괴리|상세)\s+(.+)$/i);
  if (infoMatch) {
    return handleEtfInfoCommand(infoMatch[1], ctx, tgSend);
  }

  const divMatch = query.match(/^(?:분배금|배당|분배)\s*(.*)$/i);
  if (divMatch) {
    return handleEtfDistributionCommand(divMatch[1] ?? "", ctx, tgSend);
  }

  return handleEtfInfoCommand(query, ctx, tgSend);
}