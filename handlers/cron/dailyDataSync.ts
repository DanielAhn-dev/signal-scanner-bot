import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { fetchCreditShortSnapshot } from "../../src/utils/fetchCreditShortData";

export const config = {
  maxDuration: 120,
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface DataSyncOptions {
  date?: string; // YYYY-MM-DD, defaults to today
  dryRun?: boolean;
  concurrency?: number;
  universeFilter?: string; // 'core' | 'extended' | 'all'
}

/** 수집 대상 종목 로드 (활성 core/extended 종목만) */
async function loadTargetCodes(universeFilter = "core,extended"): Promise<string[]> {
  const universes = universeFilter
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  let query = supabase
    .from("stocks")
    .select("code")
    .eq("is_active", true);

  if (universes.length > 0) {
    query = query.in("universe_level", universes);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load target codes: ${error.message}`);
  }

  const codes = (data || [])
    .map((row: any) => {
      const code = String(row.code || "").trim().replace(/^A/i, "").padStart(6, "0");
      return /^\d{6}$/.test(code) ? code : null;
    })
    .filter((code): code is string => code !== null);

  return codes;
}

/** 코드별 공매도/신용 데이터 수집 및 저장 */
async function syncCreditShortForCode(
  code: string,
  date: string,
  dryRun: boolean
): Promise<{
  code: string;
  success: boolean;
  saved: boolean;
  creditRatio: number | null;
  shortRatio: number | null;
  shortBalance: number | null;
  error?: string;
}> {
  try {
    const snapshot = await fetchCreditShortSnapshot(code);
    if (!snapshot || (!snapshot.creditRatio && !snapshot.shortRatio && !snapshot.shortBalance)) {
      return {
        code,
        success: true,
        saved: false,
        creditRatio: null,
        shortRatio: null,
        shortBalance: null,
      };
    }

    if (dryRun) {
      return {
        code,
        success: true,
        saved: false,
        creditRatio: snapshot.creditRatio,
        shortRatio: snapshot.shortRatio,
        shortBalance: snapshot.shortBalance,
      };
    }

    // Upsert to stock_credit_short_daily
    const record = {
      code,
      date,
      credit_ratio: snapshot.creditRatio,
      short_ratio: snapshot.shortRatio,
      short_balance:
        snapshot.shortBalance != null ? Math.trunc(snapshot.shortBalance) : null,
      short_volume: null,
    };

    const { error: upsertError } = await supabase
      .from("stock_credit_short_daily")
      .upsert(record, { onConflict: "code,date" });

    if (upsertError) {
      console.error(`Upsert error for ${code}:`, upsertError);
      return {
        code,
        success: false,
        saved: false,
        creditRatio: snapshot.creditRatio,
        shortRatio: snapshot.shortRatio,
        shortBalance: snapshot.shortBalance,
        error: upsertError.message,
      };
    }

    // Update stocks table with latest
    const updates: Record<string, any> = {};
    if (snapshot.creditRatio !== null) updates.credit_ratio = snapshot.creditRatio;
    if (snapshot.shortRatio !== null) updates.short_ratio = snapshot.shortRatio;
    if (snapshot.shortBalance !== null)
      updates.short_balance = Math.trunc(snapshot.shortBalance);

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from("stocks")
        .update(updates)
        .eq("code", code);

      if (updateError) {
        console.warn(`stocks update error for ${code}:`, updateError);
      }
    }

    return {
      code,
      success: true,
      saved: true,
      creditRatio: snapshot.creditRatio,
      shortRatio: snapshot.shortRatio,
      shortBalance: snapshot.shortBalance,
    };
  } catch (err) {
    return {
      code,
      success: false,
      saved: false,
      creditRatio: null,
      shortRatio: null,
      shortBalance: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** 병렬 처리로 코드 목록 처리 */
async function processCodes(
  codes: string[],
  date: string,
  dryRun: boolean,
  concurrency = 10
): Promise<any[]> {
  const results = [];

  for (let i = 0; i < codes.length; i += concurrency) {
    const batch = codes.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((code) => syncCreditShortForCode(code, date, dryRun))
    );
    results.push(...batchResults);

    // Log progress
    console.log(
      `[${i + batch.length}/${codes.length}] Processed batch, saved ${batchResults.filter((r) => r.saved).length}`
    );
  }

  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const opts: DataSyncOptions = {
      date: req.query.date as string,
      dryRun: req.query.dryRun === "true",
      concurrency: parseInt(String(req.query.concurrency || "10"), 10),
      universeFilter: (req.query.universeFilter as string) || "core,extended",
    };

    // Normalize date to today if not provided
    if (!opts.date) {
      const now = new Date();
      opts.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    console.log(`[dailyDataSync] Starting: date=${opts.date}, dryRun=${opts.dryRun}`);

    const codes = await loadTargetCodes(opts.universeFilter);
    console.log(`[dailyDataSync] Loaded ${codes.length} target codes`);

    if (!codes.length) {
      return res.status(200).json({
        success: true,
        date: opts.date,
        dryRun: opts.dryRun,
        codesProcessed: 0,
        codeSaved: 0,
        message: "No target codes found",
      });
    }

    const results = await processCodes(codes, opts.date, opts.dryRun, opts.concurrency);

    const saved = results.filter((r) => r.saved).length;
    const successful = results.filter((r) => r.success).length;
    const errors = results.filter((r) => !r.success);

    return res.status(200).json({
      success: true,
      date: opts.date,
      dryRun: opts.dryRun,
      codesProcessed: results.length,
      codeSaved: saved,
      successful,
      errorCount: errors.length,
      errors: errors.slice(0, 10), // First 10 errors only
      message: `Processed ${results.length} codes, saved ${saved}`,
    });
  } catch (err) {
    console.error("[dailyDataSync] Error:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
