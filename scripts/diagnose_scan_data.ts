import { createClient } from '@supabase/supabase-js';

function usage() {
  console.log('Usage: node -r ts-node/register scripts/diagnose_scan_data.ts --date YYYY-MM-DD');
  console.log('Or: node -r ts-node/register scripts/diagnose_scan_data.ts --last N');
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL or SUPABASE_KEY missing in environment');
    usage();
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const argv = process.argv.slice(2);
  let dateArg: string | undefined;
  let lastN = 3;
  for (const a of argv) {
    if (a.startsWith('--date=')) dateArg = a.split('=')[1];
    if (a.startsWith('--last=')) lastN = Number(a.split('=')[1]) || 3;
  }

  let datesToCheck: string[] = [];
  if (dateArg) {
    datesToCheck = [dateArg];
  } else {
    // get recent distinct trade_date from pullback_signals
    const { data: recentDates } = await supabase
      .from('pullback_signals')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(Math.max(1, lastN));

    const uniqueDates = [...new Set((recentDates ?? []).map((r: any) => r.trade_date).filter(Boolean))].slice(0, lastN);
    datesToCheck = uniqueDates as string[];
  }

  if (!datesToCheck.length) {
    console.log('No trade_date found to check.');
    process.exit(0);
  }

  for (const d of datesToCheck) {
    console.log('---');
    console.log(`Date: ${d}`);

    const { data: pbRows } = await supabase
      .from('pullback_signals')
      .select('code, entry_grade, entry_score, trend_grade, dist_grade, warn_grade, trade_date')
      .eq('trade_date', d)
      .limit(500);

    const pbCount = (pbRows ?? []).length;
    console.log(`pullback_signals count: ${pbCount}`);
    if (pbCount > 0) {
      console.log('Sample pullback_signals (max 10):');
      console.table((pbRows ?? []).slice(0, 10));
    }

    const { data: scoreRows } = await supabase
      .from('scores')
      .select('code, total_score, signal, factors')
      .eq('asof', d)
      .limit(1000);

    const scoresCount = (scoreRows ?? []).length;
    console.log(`scores count (asof=${d}): ${scoresCount}`);

    if (scoresCount > 0) {
      let nonNullStableAccum = 0;
      let nonNullStableAbove = 0;
      let nonNullStableTrust = 0;
      let nonNullStableTurn = 0;

      for (const row of scoreRows as any[]) {
        const f = row.factors ?? {};
        if (f && typeof f === 'object') {
          if (f.stable_accumulation !== undefined && f.stable_accumulation !== null) nonNullStableAccum += 1;
          if (f.stable_above_avg !== undefined && f.stable_above_avg !== null) nonNullStableAbove += 1;
          if (f.stable_turn_trust !== undefined && f.stable_turn_trust !== null) nonNullStableTrust += 1;
          if (f.stable_turn !== undefined && f.stable_turn !== null) nonNullStableTurn += 1;
        }
      }

      console.log('factors presence:');
      console.log(`  stable_accumulation: ${nonNullStableAccum}/${scoresCount} (${((nonNullStableAccum/scoresCount)*100).toFixed(1)}%)`);
      console.log(`  stable_above_avg:    ${nonNullStableAbove}/${scoresCount} (${((nonNullStableAbove/scoresCount)*100).toFixed(1)}%)`);
      console.log(`  stable_turn_trust:   ${nonNullStableTrust}/${scoresCount} (${((nonNullStableTrust/scoresCount)*100).toFixed(1)}%)`);
      console.log(`  stable_turn:         ${nonNullStableTurn}/${scoresCount} (${((nonNullStableTurn/scoresCount)*100).toFixed(1)}%)`);

      // show sample where factors are present vs null
      const haveFactors = (scoreRows as any[]).filter((r) => r.factors && Object.keys(r.factors).length > 0).slice(0, 8);
      const nullFactors = (scoreRows as any[]).filter((r) => !r.factors || Object.keys(r.factors).length === 0).slice(0, 8);
      if (haveFactors.length) {
        console.log('Sample score rows with factors:');
        console.table(haveFactors.map((r) => ({ code: r.code, total: r.total_score, signal: r.signal, factors: r.factors })));
      }
      if (nullFactors.length) {
        console.log('Sample score rows with NULL/empty factors:');
        console.table(nullFactors.map((r) => ({ code: r.code, total: r.total_score, signal: r.signal })));
      }
    }

    // cross-check: codes present in pullback but missing in scores
    const pbCodes = (pbRows ?? []).map((r: any) => String(r.code).trim()).filter(Boolean);
    const scoreCodes = (scoreRows ?? []).map((r: any) => String(r.code).trim()).filter(Boolean);
    const missingInScores = pbCodes.filter((c) => !scoreCodes.includes(c));
    console.log(`codes in pullback but missing in scores: ${missingInScores.length}`);
    if (missingInScores.length > 0) console.log(missingInScores.slice(0, 20).join(', '));
  }

  console.log('--- done');
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
