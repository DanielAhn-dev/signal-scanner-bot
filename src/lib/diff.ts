// src/lib/diff.ts
import { StockRow, SectorRow } from "../types/db";

export function diffStocks(snapshot: StockRow[], current: StockRow[]) {
  const curMap = new Map(current.map((r) => [r.code, r]));
  const inserted: StockRow[] = [];
  const updated: StockRow[] = [];

  for (const s of snapshot) {
    const c = curMap.get(s.code);
    if (!c) {
      inserted.push(s);
    } else {
      if (c.name !== s.name || c.market !== s.market) {
        updated.push({ ...c, ...s });
      }
    }
  }
  return { inserted, updated, total: snapshot.length };
}

export function diffSectors(snapshot: SectorRow[], current: SectorRow[]) {
  const curMap = new Map(current.map((r) => [r.id, r]));
  const inserted: SectorRow[] = [];
  const updated: SectorRow[] = [];

  for (const s of snapshot) {
    const c = curMap.get(s.id);
    if (!c) {
      inserted.push(s);
    } else {
      const changed =
        c.name !== s.name ||
        JSON.stringify(c.metrics ?? {}) !== JSON.stringify(s.metrics ?? {});
      if (changed) updated.push({ ...c, ...s });
    }
  }
  return { inserted, updated, total: snapshot.length };
}
