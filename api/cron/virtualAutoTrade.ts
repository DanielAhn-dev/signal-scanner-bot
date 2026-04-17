import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runVirtualAutoTradingCycle } from "../../src/services/virtualAutoTradeService";

const CRON_SECRET = process.env.CRON_SECRET;

export const config = {
  maxDuration: 60,
};

function parsePositiveInt(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMode(raw: string | string[] | undefined): "auto" | "monday" | "daily" {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "auto";
  if (value === "monday") return "monday";
  if (value === "daily") return "daily";
  return "auto";
}

function parseBoolean(raw: string | string[] | undefined): boolean {
  const value = ((Array.isArray(raw) ? raw[0] : raw) ?? "").toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "y";
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

    const summary = await runVirtualAutoTradingCycle({
      mode,
      maxUsers,
      dryRun,
    });

    return res.status(200).json({
      ok: true,
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      ok: false,
      error: message,
    });
  }
}
