import { createClient } from '@supabase/supabase-js';
import { analyzeOrderIntakeSignal, type OrderIntakeSignalResult } from '../lib/newsSentiment';

const ORDER_INTAKE_SIGNAL_TABLE = 'order_intake_signals';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

type OrderIntakeSignalRow = {
  code: string;
  sector_id: string | null;
  sector_name: string | null;
  signal_date: string;
  signal_score: number;
  positive_count: number;
  negative_count: number;
  headline_count: number;
  source: string;
  details: Record<string, unknown>;
};

export type SaveOrderIntakeSignalInput = {
  code: string;
  sectorId?: string | null;
  sectorName?: string | null;
  titles: string[];
  observedAt?: Date | string;
  source?: string;
};

export type SectorOrderSignalBoost = {
  bySectorId: Map<string, number>;
  bySectorName: Map<string, number>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDateKey(input?: Date | string): string {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function toDayDiff(fromDateKey: string, toDate: Date): number {
  const from = new Date(`${fromDateKey}T00:00:00.000Z`).getTime();
  const to = Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

export async function saveOrderIntakeSignalFromNews(
  input: SaveOrderIntakeSignalInput
): Promise<OrderIntakeSignalResult | null> {
  const code = String(input.code || '').trim();
  if (!code || !input.titles?.length) return null;

  const analyzed = analyzeOrderIntakeSignal(input.titles);
  const signalDate = toDateKey(input.observedAt);

  const payload = {
    code,
    sector_id: input.sectorId ?? null,
    sector_name: input.sectorName ?? null,
    signal_date: signalDate,
    signal_score: analyzed.score,
    positive_count: analyzed.positiveMatches.length,
    negative_count: analyzed.negativeMatches.length,
    headline_count: input.titles.length,
    source: input.source ?? 'watchlist-news',
    details: {
      positive_details: analyzed.positiveDetails,
      negative_details: analyzed.negativeDetails,
      sampled_titles: input.titles.slice(0, 5),
    },
  };

  try {
    const { error } = await supabase
      .from(ORDER_INTAKE_SIGNAL_TABLE)
      .upsert(payload, { onConflict: 'code,signal_date,source' });

    if (error) {
      console.error('[order-intake] upsert failed:', error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[order-intake] save failed:', message);
  }

  return analyzed;
}

export async function fetchRecentSectorOrderSignalBoost(
  windowDays?: number,
  maxBoostPoints?: number
): Promise<SectorOrderSignalBoost> {
  // 환경변수에서 기본값 읽기
  const defaultWindowDays = Number(process.env.ORDER_INTAKE_SIGNAL_WINDOW_DAYS || 20);
  const defaultMaxBoostPoints = Number(process.env.ORDER_INTAKE_SIGNAL_MAX_BOOST_POINTS || 6);
  
  const finalWindowDays = windowDays ?? defaultWindowDays;
  const finalMaxBoostPoints = maxBoostPoints ?? defaultMaxBoostPoints;
  
  const now = new Date();
  const cutoff = new Date(now.getTime() - finalWindowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const bySectorId = new Map<string, number>();
  const bySectorName = new Map<string, number>();

  try {
    const { data, error } = await supabase
      .from(ORDER_INTAKE_SIGNAL_TABLE)
      .select('sector_id, sector_name, signal_date, signal_score, positive_count, negative_count, headline_count')
      .gte('signal_date', cutoff)
      .order('signal_date', { ascending: false })
      .returns<OrderIntakeSignalRow[]>();

    if (error || !data?.length) {
      if (error) {
        console.error('[order-intake] fetch boost failed:', error.message);
      }
      return { bySectorId, bySectorName };
    }

    for (const row of data) {
      const keyId = row.sector_id ?? '';
      const keyName = row.sector_name ?? '';
      if (!keyId && !keyName) continue;

      const daysAgo = toDayDiff(row.signal_date, now);
      const recencyWeight = clamp(1 - daysAgo / (finalWindowDays + 1), 0.2, 1);
      const signalStrength = clamp(Number(row.signal_score ?? 0) / 10, -1, 1);
      const evidenceWeight = clamp(Number(row.headline_count ?? 0) / 5, 0.2, 1);
      const signedBoost = signalStrength * recencyWeight * evidenceWeight * finalMaxBoostPoints;

      if (keyId) {
        bySectorId.set(keyId, clamp((bySectorId.get(keyId) ?? 0) + signedBoost, -finalMaxBoostPoints, finalMaxBoostPoints));
      }
      if (keyName) {
        bySectorName.set(keyName, clamp((bySectorName.get(keyName) ?? 0) + signedBoost, -finalMaxBoostPoints, finalMaxBoostPoints));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[order-intake] fetch boost exception:', message);
  }

  return { bySectorId, bySectorName };
}
