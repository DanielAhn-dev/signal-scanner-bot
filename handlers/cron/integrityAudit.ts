import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  reconcileChatLedger,
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
import { sendMessage } from "../../src/telegram/api";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTO_TRADE_ALERT_CHAT_ID = Number(process.env.AUTO_TRADE_ALERT_CHAT_ID || "0");
/** 정상이어도 매일 ✅ 한 줄을 보낼지 (false면 이상 발견 시에만 발송) */
const INTEGRITY_NOTIFY_ALWAYS =
  String(process.env.INTEGRITY_NOTIFY_ALWAYS ?? "true").toLowerCase() !== "false";

export const config = {
  maxDuration: 60,
};

type SettingRow = { chat_id: number };
type UserPrefsRow = {
  id: number;
  virtual_seed_capital: number | null;
  virtual_cash: number | null;
  capital_krw: number | null;
};
type TradeRow = AuditTradeRow & { chat_id: number };
type PositionRow = AuditPositionRow & { chat_id: number };

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
        .from("users")
        .select("id, virtual_seed_capital, virtual_cash, capital_krw")
        .in("id", chatIds)
        .returns<UserPrefsRow[]>(),
      supabase
        .from("virtual_trades")
        .select("chat_id, code, side, quantity, net_amount")
        .in("chat_id", chatIds)
        .limit(50000)
        .returns<TradeRow[]>(),
      supabase
        .from("virtual_positions")
        .select("chat_id, code, quantity, status")
        .in("chat_id", chatIds)
        .returns<PositionRow[]>(),
    ]);

    if (usersResult.error) throw new Error(`users fetch failed: ${usersResult.error.message}`);
    if (tradesResult.error) throw new Error(`trades fetch failed: ${tradesResult.error.message}`);
    if (positionsResult.error) {
      throw new Error(`positions fetch failed: ${positionsResult.error.message}`);
    }

    const prefsByChat = new Map<number, UserPrefsRow>();
    for (const row of usersResult.data ?? []) prefsByChat.set(Number(row.id), row);

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
      if (!positionsByChat.has(chatId)) positionsByChat.set(chatId, []);
      positionsByChat.get(chatId)!.push(row);
      const status = String(row.status ?? "holding").toLowerCase();
      if (status === "holding" && Number(row.quantity) > 0) {
        heldCodes.add(String(row.code).trim());
      }
    }

    const results: ChatLedgerResult[] = [];
    for (const chatId of chatIds) {
      const prefs = prefsByChat.get(chatId);
      const seedCapital = Number(prefs?.virtual_seed_capital ?? prefs?.capital_krw ?? 0);
      const virtualCash = Number(prefs?.virtual_cash ?? seedCapital);
      results.push(
        reconcileChatLedger({
          chatId,
          seedCapital,
          virtualCash,
          trades: tradesByChat.get(chatId) ?? [],
          positions: positionsByChat.get(chatId) ?? [],
        })
      );
    }

    // 보유 종목 시세 가용성: 최근 7일 내 stock_daily 행이 없는 종목 적발
    let staleHoldingCodes: string[] = [];
    if (heldCodes.size > 0) {
      const codes = [...heldCodes];
      const { data: priceRows, error: priceError } = await supabase
        .from("stock_daily")
        .select("code")
        .in("code", codes)
        .gte("date", priceCutoffYmd())
        .limit(20000);
      if (priceError) throw new Error(`stock_daily fetch failed: ${priceError.message}`);
      const available = new Set((priceRows ?? []).map((row) => String(row.code).trim()));
      staleHoldingCodes = codes.filter((code) => !available.has(code)).sort();
    }

    const freshness = await checkDataFreshness(supabase);
    const ymd = kstYmd();
    const message = buildIntegrityReportMessage({
      ymd,
      results,
      staleHoldingCodes,
      freshnessDigest: buildFreshnessDigest(freshness),
    });
    const issueCount = countIntegrityIssues({ results, staleHoldingCodes });
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
      },
    });
    if (insertError) {
      // 저장 실패는 보고 자체를 막지 않는다
      console.error(`integrity audit insert failed: ${insertError.message}`);
    }

    if (AUTO_TRADE_ALERT_CHAT_ID > 0 && (INTEGRITY_NOTIFY_ALWAYS || !isHealthy)) {
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
