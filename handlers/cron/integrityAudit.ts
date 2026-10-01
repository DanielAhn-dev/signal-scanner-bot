import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  reconcileChatLedger,
  reconstructCashBaseline,
  buildIntegrityReportMessage,
  countIntegrityIssues,
  type AuditTradeRow,
  type AuditPositionRow,
  type ChatLedgerResult,
} from "../../src/services/integrityAuditService";
import {
  checkDataFreshness,
  buildFreshnessDigest,
} from "../../src/services/dataFreshnessMonitorService";
import { checkDataQuality } from "../../src/services/dataQualityService";
import { fetchNegativeDisclosures, formatDisclosureFilterNote } from "../../src/services/dartDisclosureFilter";
import { sendMessage } from "../../src/telegram/api";
import { economicCalendarCoverage } from "../../src/utils/fetchEconomicCalendar";
import { krxCalendarStatus, toKstDateKey } from "../../src/lib/krxCalendar";
import { findMislabeledSells, type SellActionRow } from "../../src/lib/sellLabelAudit";

/** 매도 사유 기록 수정(섹터 정리·비중 축소 사유 분리) 배포 뒤부터 검산한다 */
const SELL_LABEL_AUDIT_SINCE = "2026-10-01T15:00:00+09:00";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTO_TRADE_ALERT_CHAT_ID = Number(process.env.AUTO_TRADE_ALERT_CHAT_ID || "0");
/** 정상이어도 매일 ✅ 한 줄을 보낼지 (false면 이상 발견 시에만 발송) */
/**
 * 이상이 없어도 매일 알림을 보낼지. 기본은 보내지 않는다 — 문제(❌)나 경고(⚠️)가 있을 때만 보낸다.
 * 결과는 매번 integrity_audit_results에 저장된다. 매일 받고 싶으면 INTEGRITY_NOTIFY_ALWAYS=true.
 */
const INTEGRITY_NOTIFY_ALWAYS =
  String(process.env.INTEGRITY_NOTIFY_ALWAYS ?? "false").toLowerCase() === "true";

export const config = {
  maxDuration: 60,
};

type SettingRow = { chat_id: number };
type UserPrefsRow = {
  id: number;
  virtual_seed_capital: number | null;
  virtual_cash: number | null;
  capital_krw: number | null;
  /** 원장 검산 기준선 — 없으면(예전 계정) 현재 원장으로 역산해 한 번만 채운다 */
  virtual_cash_baseline: number | null;
  dividendIncome: number;
};
type UserRow = { tg_id: number; prefs: Record<string, unknown> | null };
type TradeRow = AuditTradeRow & { chat_id: number };
type PositionRow = AuditPositionRow & { chat_id: number; broker_name?: string | null; account_name?: string | null };

function kstYmd(base = new Date()): string {
  const utcMs = base.getTime() + base.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 주말·공휴일을 감안해 최근 7일 내 시세가 있으면 가용한 것으로 본다 */
function priceCutoffYmd(base = new Date()): string {
  const cutoff = new Date(base.getTime() - 7 * 24 * 60 * 60 * 1000);
  return kstYmd(cutoff);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Supabase credentials" });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const { data: settings, error: settingsError } = await supabase
      .from("virtual_autotrade_settings")
      .select("chat_id")
      .eq("is_enabled", true)
      .limit(2000)
      .returns<SettingRow[]>();
    if (settingsError) throw new Error(`settings fetch failed: ${settingsError.message}`);

    const chatIds = (settings ?? [])
      .map((row) => Number(row.chat_id))
      .filter((id) => Number.isFinite(id));

    if (!chatIds.length) {
      return res.status(200).json({ ok: true, accounts: 0, skipped: "no-enabled-accounts" });
    }

    const [usersResult, tradesResult, positionsResult] = await Promise.all([
      supabase
        // 시드·현금은 users 컬럼이 아니라 prefs JSON 안에 있다 (예전엔 컬럼으로 조회해 매일 500 에러)
        .from("users")
        .select("tg_id, prefs")
        .in("tg_id", chatIds)
        .returns<UserRow[]>(),
      supabase
        .from("virtual_trades")
        .select("chat_id, code, side, quantity, net_amount")
        .in("chat_id", chatIds)
        // 현금·수량 원장은 가상매매(종목봇)만 — 실계좌 입력 거래는 가상 현금과 무관하다
        .is("broker_name", null)
        .limit(50000)
        .returns<TradeRow[]>(),
      supabase
        .from("virtual_positions")
        .select("chat_id, code, quantity, status, broker_name, account_name")
        .in("chat_id", chatIds)
        .returns<PositionRow[]>(),
    ]);

    if (usersResult.error) throw new Error(`users fetch failed: ${usersResult.error.message}`);
    if (tradesResult.error) throw new Error(`trades fetch failed: ${tradesResult.error.message}`);
    if (positionsResult.error) {
      throw new Error(`positions fetch failed: ${positionsResult.error.message}`);
    }

    const prefsByChat = new Map<number, UserPrefsRow>();
    const rawPrefsByChat = new Map<number, Record<string, unknown>>();
    for (const row of usersResult.data ?? []) {
      const prefs = (row.prefs ?? {}) as Record<string, unknown>;
      rawPrefsByChat.set(Number(row.tg_id), prefs);
      const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
      // ETF 분배금·종목 배당금은 virtual_trades에 남지 않고 virtual_cash에 바로 더해진다 —
      // 원장 검산에서 빼먹으면 배당 받은 계좌마다 매번 오탐(cash-mismatch)이 뜬다.
      const distributionLog = Array.isArray(prefs.virtual_distribution_log) ? prefs.virtual_distribution_log : [];
      const dividendIncome = distributionLog.reduce(
        (sum: number, r: { net?: unknown }) => sum + (Number.isFinite(Number(r?.net)) ? Number(r.net) : 0),
        0
      );
      prefsByChat.set(Number(row.tg_id), {
        id: Number(row.tg_id),
        virtual_seed_capital: num(prefs.virtual_seed_capital),
        virtual_cash: num(prefs.virtual_cash),
        capital_krw: num(prefs.capital_krw),
        virtual_cash_baseline: num(prefs.virtual_cash_baseline),
        dividendIncome,
      });
    }

    const tradesByChat = new Map<number, AuditTradeRow[]>();
    for (const row of tradesResult.data ?? []) {
      const chatId = Number(row.chat_id);
      if (!tradesByChat.has(chatId)) tradesByChat.set(chatId, []);
      tradesByChat.get(chatId)!.push(row);
    }

    const positionsByChat = new Map<number, AuditPositionRow[]>();
    const heldCodes = new Set<string>();
    for (const row of positionsResult.data ?? []) {
      const chatId = Number(row.chat_id);
      // 실계좌 보유(증권사·계좌명 있음)는 가상 원장과 비교하지 않는다 — 거래 기록이 없어 매번 오탐이 된다.
      // 시세 누락 점검(heldCodes)에는 실계좌 종목도 포함한다.
      const isRealAccount = row.broker_name != null || row.account_name != null;
      if (!isRealAccount) {
        if (!positionsByChat.has(chatId)) positionsByChat.set(chatId, []);
        positionsByChat.get(chatId)!.push(row);
      }
      const status = String(row.status ?? "holding").toLowerCase();
      if (status === "holding" && Number(row.quantity) > 0) {
        heldCodes.add(String(row.code).trim());
      }
    }

    const results: ChatLedgerResult[] = [];
    // virtual_seed_capital은 매주 시드 재계산에서 실현손익만큼 흔들리는 값이라 검산 기준으로 못 쓴다 —
    // virtual_cash_baseline(재계산에 물들지 않는 기준선)이 없는 계좌는 현재 원장으로 역산해 한 번만 채운다.
    const baselineBackfills: Array<{ chatId: number; baseline: number }> = [];
    for (const chatId of chatIds) {
      const prefs = prefsByChat.get(chatId);
      const fallbackSeed = Number(prefs?.virtual_seed_capital ?? prefs?.capital_krw ?? 0);
      const virtualCash = Number(prefs?.virtual_cash ?? fallbackSeed);
      const trades = tradesByChat.get(chatId) ?? [];
      const dividendIncome = prefs?.dividendIncome ?? 0;
      let seedCapital = prefs?.virtual_cash_baseline;
      if (seedCapital == null || !Number.isFinite(seedCapital) || seedCapital <= 0) {
        seedCapital = reconstructCashBaseline({ actualCash: virtualCash, trades, dividendIncome });
        baselineBackfills.push({ chatId, baseline: seedCapital });
      }
      results.push(
        reconcileChatLedger({
          chatId,
          seedCapital,
          virtualCash,
          trades,
          positions: positionsByChat.get(chatId) ?? [],
          dividendIncome,
        })
      );
    }

    if (baselineBackfills.length) {
      await Promise.all(
        baselineBackfills.map(({ chatId, baseline }) => {
          const rawPrefs = rawPrefsByChat.get(chatId) ?? {};
          return supabase
            .from("users")
            .update({ prefs: { ...rawPrefs, virtual_cash_baseline: baseline } })
            .eq("tg_id", chatId)
            .then(({ error }) => {
              if (error) console.error(`baseline backfill failed for chat ${chatId}: ${error.message}`);
            });
        })
      );
    }

    // 보유 종목 시세 가용성: 최근 7일 내 stock_daily 행이 없는 종목 적발
    let staleHoldingCodes: string[] = [];
    if (heldCodes.size > 0) {
      const codes = [...heldCodes];
      const { data: priceRows, error: priceError } = await supabase
        // stock_daily의 종목 컬럼은 ticker (예전엔 code로 조회해 이 단계에서 실패했다)
        .from("stock_daily")
        .select("ticker")
        .in("ticker", codes)
        .gte("date", priceCutoffYmd())
        .limit(20000);
      if (priceError) throw new Error(`stock_daily fetch failed: ${priceError.message}`);
      const available = new Set((priceRows ?? []).map((row: { ticker: string }) => String(row.ticker).trim()));
      staleHoldingCodes = codes.filter((code) => !available.has(code)).sort();
    }

    // 매도 사유 검산: 최근 14일 익절로 기록됐는데 실제 손익이 마이너스인 매도 (금액이 맞아도 사유가 틀릴 수 있다)
    const { data: sellRows, error: sellRowsError } = await supabase
      .from("virtual_autotrade_actions")
      .select("chat_id, code, reason, created_at, detail")
      .in("chat_id", chatIds)
      .eq("action_type", "SELL")
      // 10/01 한미약품 건은 원인을 고친 알려진 기록이라 그 뒤부터만 센다 (매일 같은 ❌ 알림 방지)
      .gte("created_at", new Date(Math.max(Date.now() - 14 * 86_400_000, Date.parse(SELL_LABEL_AUDIT_SINCE))).toISOString())
      .limit(5000);
    const mislabeled = sellRowsError ? [] : findMislabeledSells((sellRows ?? []) as SellActionRow[]);
    const labelIssue = sellRowsError || mislabeled.length > 0 ? 1 : 0;
    const labelNote = sellRowsError
      ? `❌ 매도 사유 검산 실패: ${sellRowsError.message}`
      : mislabeled.length
        ? `❌ 익절로 기록됐지만 손실인 매도 ${mislabeled.length}건: ${mislabeled.slice(0, 5).map((m) => `${m.code} ${m.at} ${m.pnl.toLocaleString("ko-KR")}원`).join(", ")}`
        : "✅ 매도 사유 기록 일치 (최근 14일)";

    const freshness = await checkDataFreshness(supabase);
    const dataQuality = await checkDataQuality(supabase).catch((e: unknown) => ({
      issues: [`데이터 품질 검사 실패: ${e instanceof Error ? e.message : String(e)}`],
      summary: "❌ 데이터 품질 검사 실패",
    }));
    // 공시 필터가 키 누락·오류로 조용히 꺼져 있지 않은지 (키가 없으면 요청하지 않음)
    const disclosureFilter = await fetchNegativeDisclosures();
    const disclosureIssue = disclosureFilter.status === "ok" ? 0 : 1;
    const ymd = kstYmd();
    // 경제 일정은 하드코딩이라 끝나면 경고가 조용히 사라진다 — 60일 안에 끝나는 항목을 알린다
    const calendarLimit = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const calendarEnding = economicCalendarCoverage().filter((c) => c.lastDate < calendarLimit);
    const calendarIssue = calendarEnding.some((c) => /FOMC 금리|CPI/.test(c.name)) ? 1 : 0;
    const calendarNote = calendarEnding.length
      ? `${calendarIssue ? "❌" : "⚠️"} 경제 일정 갱신 필요(src/utils/fetchEconomicCalendar.ts): ${calendarEnding.map((c) => `${c.name} ~${c.lastDate}`).join(", ")}`
      : "✅ 경제 일정 60일 이상 채워짐";
    // 휴장일 목록도 하드코딩 — 빠지면 휴장일에 매매한다 (장중 실행은 krxLiveSession이 한 번 더 막는다)
    const krxCal = krxCalendarStatus(toKstDateKey());
    const krxCalIssue = krxCal.level === "error" ? 1 : 0;
    const krxCalNote = `${krxCal.level === "error" ? "❌" : krxCal.level === "warn" ? "⚠️" : "✅"} ${krxCal.note}`;
    const message = [
      buildIntegrityReportMessage({
        ymd,
        results,
        staleHoldingCodes,
        freshnessDigest: buildFreshnessDigest(freshness),
      }),
      dataQuality.summary,
      `${disclosureIssue ? "❌" : "✅"} ${formatDisclosureFilterNote(disclosureFilter)}`,
      calendarNote,
      krxCalNote,
      labelNote,
    ].join("\n");
    const issueCount =
      countIntegrityIssues({ results, staleHoldingCodes }) +
      dataQuality.issues.length +
      disclosureIssue +
      calendarIssue +
      krxCalIssue +
      labelIssue;
    const isHealthy = issueCount === 0 && freshness.isHealthy;

    const { error: insertError } = await supabase.from("integrity_audit_results").insert({
      audit_date: ymd,
      is_healthy: isHealthy,
      issue_count: issueCount,
      account_count: results.length,
      summary: message,
      detail: {
        results,
        staleHoldingCodes,
        freshness: { isHealthy: freshness.isHealthy, staleItems: freshness.staleItems },
        dataQuality: dataQuality.issues,
        disclosureFilter: { status: disclosureFilter.status, error: disclosureFilter.error ?? null },
      },
    });
    if (insertError) {
      // 저장 실패는 보고 자체를 막지 않는다
      console.error(`integrity audit insert failed: ${insertError.message}`);
    }

    // 경고(⚠️)는 이상 건수에 들어가지 않지만 미리 손봐야 하는 항목이라 알린다 (경제 일정·휴장일 목록 만료 임박)
    const hasWarning = (calendarEnding.length > 0 && !calendarIssue) || krxCal.level === "warn";
    if (AUTO_TRADE_ALERT_CHAT_ID > 0 && (INTEGRITY_NOTIFY_ALWAYS || !isHealthy || hasWarning)) {
      await sendMessage(AUTO_TRADE_ALERT_CHAT_ID, message);
    }

    return res.status(200).json({
      ok: true,
      accounts: results.length,
      issueCount,
      isHealthy,
      staleHoldingCodes,
      freshnessHealthy: freshness.isHealthy,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message ?? String(error) });
  }
}
