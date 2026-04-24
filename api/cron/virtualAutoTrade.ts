import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runVirtualAutoTradingCycle } from "../../src/services/virtualAutoTradeService";
import { firstQueryValue, parseBoolean, parsePositiveInt } from "./query";

const CRON_SECRET = process.env.CRON_SECRET;

export const config = {
  maxDuration: 60,
};

function parseMode(raw: string | string[] | undefined): "auto" | "monday" | "daily" {
  const value = firstQueryValue(raw) ?? "auto";
  if (value === "monday") return "monday";
  if (value === "daily") return "daily";
  return "auto";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const mode = parseMode(req.query.mode);
    const maxUsers = parsePositiveInt(req.query.maxUsers);
    const dryRun = parseBoolean(req.query.dryRun);
    const intradayOnly = parseBoolean(req.query.intradayOnly);
    const windowMinutes = parsePositiveInt(req.query.windowMinutes);

    const summary = await runVirtualAutoTradingCycle({
      mode,
      maxUsers,
      dryRun,
      intradayOnly,
      windowMinutes,
    });

    console.log(
      JSON.stringify({
        scope: "autocycle_cron",
        event: "cycle_done",
        ts: new Date().toISOString(),
        mode,
        dry_run: dryRun,
        intraday_only: intradayOnly,
        window_minutes: windowMinutes ?? 10,
        run_key: summary.runKey,
        total_users: summary.totalUsers,
        processed_users: summary.processedUsers,
        buy_count: summary.buyCount,
        sell_count: summary.sellCount,
        skipped_count: summary.skippedCount,
        error_count: summary.errorCount,
        skip_reason_stats: summary.skipReasonStats,
      })
    );

    return res.status(200).json({
      ok: true,
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        scope: "autocycle_cron",
        event: "cycle_failed",
        ts: new Date().toISOString(),
        error: message,
      })
    );
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
