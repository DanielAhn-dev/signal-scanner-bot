// scripts/reconcile_duplicates.ts
// Usage: ts-node scripts/reconcile_duplicates.ts --days=7 --windowSeconds=120 [--apply-safe]

import { createClient } from '@supabase/supabase-js';
import minimist from 'minimist';

const argv = minimist(process.argv.slice(2));
const days = Number(argv.days ?? 7);
const windowSeconds = Number(argv.windowSeconds ?? 120);
const applySafe = Boolean(argv['apply-safe'] ?? argv.applySafe ?? false);

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env required`);
  return v;
}

async function main() {
  const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Scanning duplicate trades since ${since} within ${windowSeconds}s window`);

  // Find candidate duplicate pairs: same chat_id, code, side, price, quantity, traded_at within window
  const sql = `
    SELECT t1.id as id1, t2.id as id2, t1.chat_id, t1.code, t1.side, t1.price, t1.quantity, t1.net_amount as net1, t2.net_amount as net2, t1.traded_at as t1_at, t2.traded_at as t2_at
    FROM public.virtual_trades t1
    JOIN public.virtual_trades t2
      ON t1.chat_id = t2.chat_id
      AND t1.code = t2.code
      AND t1.side = t2.side
      AND t1.price = t2.price
      AND t1.quantity = t2.quantity
      AND t1.id < t2.id
      AND ABS(EXTRACT(EPOCH FROM (t1.traded_at - t2.traded_at))) <= $1
    WHERE t1.traded_at >= $2
    ORDER BY t1.chat_id, t1.code, t1.traded_at;
  `;

  let data: any = null;
  let error: any = null;
  try {
    const res = await supabase.rpc('sql', { sql_statement: sql, params: [windowSeconds, since] } as any);
    data = (res as any).data ?? (res as any);
    error = (res as any).error ?? null;
  } catch (e) {
    data = null;
    error = e;
  }

  // Normalize possible shapes returned by rpc('sql') into an array of rows.
  function normalizeRpcRows(x: any): Array<any> | null {
    if (!x) return null;
    if (Array.isArray(x)) return x;
    if (x.data && Array.isArray(x.data)) return x.data;
    if (x.rows && Array.isArray(x.rows)) return x.rows;
    if (x.result && Array.isArray(x.result)) return x.result;
    // If object with a single array-valued prop, try to find it
    for (const k of Object.keys(x)) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
    return null;
  }

  const rpcRows = normalizeRpcRows(data);

  // Note: some Supabase setups don't allow raw SQL via rpc('sql'). Fallback to select via .from with filter is complex.
  if (!rpcRows) {
    console.error('Raw SQL execution failed or not permitted in this environment. Trying RESTful fallback.');

    // Fallback: fetch trades and perform pairwise check in JS
    const { data: trades, error: tErr } = await supabase
      .from('virtual_trades')
      .select('id,chat_id,code,side,price,quantity,net_amount,traded_at')
      .gte('traded_at', since)
      .order('traded_at', { ascending: true })
      .limit(10000);

    if (tErr) {
      console.error('Failed to fetch trades for fallback:', tErr);
      process.exit(1);
    }

    const rows = trades as Array<any>;
    const pairs: Array<any> = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length && j < i + 200; j++) {
        const a = rows[i];
        const b = rows[j];
        if (a.chat_id !== b.chat_id) break;
        if (a.code === b.code && a.side === b.side && Number(a.price) === Number(b.price) && Number(a.quantity) === Number(b.quantity)) {
          const diff = Math.abs(new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime()) / 1000;
          if (diff <= windowSeconds) {
            pairs.push({ id1: a.id, id2: b.id, chat_id: a.chat_id, code: a.code, side: a.side, price: a.price, quantity: a.quantity, t1_at: a.traded_at, t2_at: b.traded_at, net1: a.net_amount, net2: b.net_amount });
          }
        }
      }
    }

    return reportAndMaybeApply(supabase, pairs, applySafe);
  }

  return reportAndMaybeApply(supabase, rpcRows as Array<any>, applySafe);
}

async function reportAndMaybeApply(supabase: any, pairs: Array<any>, applySafe: boolean) {
  const arr = Array.isArray(pairs) ? pairs : [];
  if (arr.length === 0) {
    console.log('No duplicate candidates found.');
    return;
  }

  console.log(`Found ${arr.length} duplicate candidate pairs:`);
  for (const p of arr) {
    console.log(`- chat ${p.chat_id} ${p.side} ${p.code} qty ${p.quantity} price ${p.price} ids ${p.id1},${p.id2} times ${p.t1_at},${p.t2_at}`);
  }

  if (!applySafe) {
    console.log('\nRun with --apply-safe to attempt safe automated reconciliation for simple BUY duplicates.');
    return;
  }

  console.log('\nApplying safe reconciliation for BUY duplicates only.');
  for (const p of pairs) {
    try {
      if (p.side !== 'BUY') {
        console.log(`Skipping pair ${p.id1},${p.id2}: side=${p.side}`);
        continue;
      }
      // Choose canonical = smallest id (id1), duplicate = id2
      const dupId = p.id2;
      const chatId = p.chat_id;
      const code = p.code;
      const qty = Number(p.quantity);
      const gross = Number(p.net2 ?? p.net1 ?? 0);

      // Safety checks
      const { data: lotMatches } = await supabase.from('virtual_trade_lot_matches').select('id').eq('trade_id', dupId).limit(1);
      if (lotMatches && lotMatches.length > 0) {
        console.log(`Skipping ${dupId}: has lot matches`);
        continue;
      }

      // Check position
      const { data: posRows } = await supabase.from('watchlist').select('id,quantity,invested_amount').eq('chat_id', chatId).eq('code', code).maybeSingle();
      const pos = posRows as any;
      if (!pos) {
        console.log(`Skipping ${dupId}: no position found for ${code}`);
        continue;
      }
      if ((pos.quantity ?? 0) < qty) {
        console.log(`Skipping ${dupId}: position qty ${pos.quantity} < dup qty ${qty}`);
        continue;
      }
      if ((pos.invested_amount ?? 0) < gross) {
        console.log(`Skipping ${dupId}: invested_amount ${pos.invested_amount} < dup gross ${gross}`);
        continue;
      }

      // All checks passed — perform revert: delete trade, decrement position, add cash back
      console.log(`Reverting duplicate BUY trade ${dupId} for chat ${chatId} ${code} qty ${qty} net ${gross}`);

      // 1) delete trade row
      const { error: delErr } = await supabase.from('virtual_trades').delete().eq('id', dupId);
      if (delErr) {
        console.error('Failed to delete trade', dupId, delErr);
        continue;
      }

      // 2) update position
      const newQty = Math.max(0, (pos.quantity ?? 0) - qty);
      const newInvested = Math.max(0, (pos.invested_amount ?? 0) - gross);
      if (newQty <= 0) {
        const { error: delPosErr } = await supabase.from('watchlist').delete().eq('id', pos.id);
        if (delPosErr) console.error('Failed to delete position', pos.id, delPosErr);
      } else {
        const { error: updPosErr } = await supabase.from('watchlist').update({ quantity: newQty, invested_amount: newInvested }).eq('id', pos.id);
        if (updPosErr) console.error('Failed to update position', pos.id, updPosErr);
      }

      // 3) credit virtual_cash back to user prefs
      const { data: prefsData, error: prefErr } = await supabase.from('users').select('prefs').eq('tg_id', chatId).maybeSingle();
      if (prefErr) {
        console.error('Failed to fetch user prefs for', chatId, prefErr);
      } else {
        const prefs = (prefsData?.prefs ?? {}) as Record<string, any>;
        const currentCash = Number(prefs.virtual_cash ?? 0);
        const nextCash = Math.max(0, Math.round(currentCash + gross));
        const { error: setErr } = await supabase.from('users').update({ prefs: { ...prefs, virtual_cash: nextCash } }).eq('tg_id', chatId);
        if (setErr) console.error('Failed to update user prefs cash', chatId, setErr);
      }

      console.log(`Reverted duplicate trade ${dupId}`);
    } catch (e) {
      console.error('Error processing pair', p, e);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
