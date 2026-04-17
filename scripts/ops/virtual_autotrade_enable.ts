import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type RiskProfile = "safe" | "balanced" | "active";

type SettingPatch = {
  is_enabled: boolean;
  monday_buy_slots?: number;
  max_positions?: number;
  min_buy_score?: number;
  take_profit_pct?: number;
  stop_loss_pct?: number;
};

function parsePositiveInt(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveNum(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBool(raw?: string, fallback = true): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "y", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "n", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseTgIds(raw?: string): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((x) => Number.isFinite(x) && x > 0);
}

function buildDefaults(riskProfile?: RiskProfile | null): Omit<Required<SettingPatch>, "is_enabled"> {
  switch (riskProfile) {
    case "active":
      return {
        monday_buy_slots: 3,
        max_positions: 12,
        min_buy_score: 74,
        take_profit_pct: 10,
        stop_loss_pct: 5,
      };
    case "balanced":
      return {
        monday_buy_slots: 2,
        max_positions: 10,
        min_buy_score: 72,
        take_profit_pct: 9,
        stop_loss_pct: 4,
      };
    case "safe":
    default:
      return {
        monday_buy_slots: 2,
        max_positions: 8,
        min_buy_score: 70,
        take_profit_pct: 8,
        stop_loss_pct: 4,
      };
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const args = process.argv.slice(2);
  const allActive = args.includes("--all-active");
  const tgIds = parseTgIds(args.find((arg) => arg.startsWith("--tgIds="))?.split("=")[1]);
  const isEnabled = parseBool(args.find((arg) => arg.startsWith("--enable="))?.split("=")[1], true);

  const overridePatch: SettingPatch = {
    is_enabled: isEnabled,
    monday_buy_slots: parsePositiveInt(args.find((arg) => arg.startsWith("--buySlots="))?.split("=")[1]),
    max_positions: parsePositiveInt(args.find((arg) => arg.startsWith("--maxPositions="))?.split("=")[1]),
    min_buy_score: parsePositiveInt(args.find((arg) => arg.startsWith("--minScore="))?.split("=")[1]),
    take_profit_pct: parsePositiveNum(args.find((arg) => arg.startsWith("--takeProfitPct="))?.split("=")[1]),
    stop_loss_pct: parsePositiveNum(args.find((arg) => arg.startsWith("--stopLossPct="))?.split("=")[1]),
  };

  if (!allActive && tgIds.length === 0) {
    throw new Error("Specify --all-active or --tgIds=123,456");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let targetUserIds: number[] = tgIds;

  if (allActive) {
    const { data, error } = await supabase
      .from("users")
      .select("tg_id")
      .eq("is_active", true);

    if (error) {
      throw error;
    }

    targetUserIds = (data ?? [])
      .map((row: Record<string, unknown>) => Number(row.tg_id ?? 0))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  if (!targetUserIds.length) {
    console.log("[virtual-autotrade] no target users");
    return;
  }

  const { data: userRows, error: userError } = await supabase
    .from("users")
    .select("tg_id, prefs")
    .in("tg_id", targetUserIds);

  if (userError) {
    throw userError;
  }

  const rows = (userRows ?? []).map((row: Record<string, unknown>) => {
    const tgId = Number(row.tg_id ?? 0);
    const prefs = (row.prefs ?? {}) as Record<string, unknown>;
    const risk = (prefs.risk_profile ?? "safe") as RiskProfile;
    const defaults = buildDefaults(risk);

    return {
      chat_id: tgId,
      is_enabled: overridePatch.is_enabled,
      monday_buy_slots: overridePatch.monday_buy_slots ?? defaults.monday_buy_slots,
      max_positions: overridePatch.max_positions ?? defaults.max_positions,
      min_buy_score: overridePatch.min_buy_score ?? defaults.min_buy_score,
      take_profit_pct: overridePatch.take_profit_pct ?? defaults.take_profit_pct,
      stop_loss_pct: overridePatch.stop_loss_pct ?? defaults.stop_loss_pct,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabase
    .from("virtual_autotrade_settings")
    .upsert(rows, { onConflict: "chat_id" });

  if (upsertError) {
    throw upsertError;
  }

  console.log(
    `[virtual-autotrade] settings updated users=${rows.length} enabled=${overridePatch.is_enabled}`
  );
}

main().catch((error) => {
  console.error("[virtual-autotrade] enable failed:", error);
  process.exit(1);
});
