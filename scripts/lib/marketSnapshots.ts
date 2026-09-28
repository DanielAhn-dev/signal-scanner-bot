/**
 * 전 종목 일별 스냅샷(Supabase Storage: market-snapshots/YYYY/YYYY-MM-DD.csv.gz) 로더.
 * 수집은 scripts/batch_modules/market_snapshot.py (일일 배치 마지막 단계).
 */
import { gunzipSync } from "node:zlib";

export type MarketSnapshotRow = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  type: string;
  close: number;
  changePct: number;
  volume: number;
  valueMil: number;
  mcapEok: number;
  tradingStatus: string;
};

const BUCKET = "market-snapshots";

function parseCsv(text: string): MarketSnapshotRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split(",") ?? [];
  const idx = (k: string) => header.indexOf(k);
  return lines.map((line) => {
    // 종목명에 쉼표가 들어갈 수 있어 따옴표 필드를 처리한다
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    const n = (k: string) => Number(cells[idx(k)] || 0);
    return {
      code: cells[idx("code")],
      name: cells[idx("name")],
      market: cells[idx("market")] as "KOSPI" | "KOSDAQ",
      type: cells[idx("type")],
      close: n("close"),
      changePct: n("change_pct"),
      volume: n("volume"),
      valueMil: n("value_mil"),
      mcapEok: n("mcap_eok"),
      tradingStatus: cells[idx("trading_status")],
    };
  });
}

/** 기간 내 스냅샷을 날짜 → 행 목록으로 불러온다 */
export async function loadMarketSnapshots(
  supabase: any,
  from: string,
  to: string
): Promise<Map<string, MarketSnapshotRow[]>> {
  const out = new Map<string, MarketSnapshotRow[]>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) {
    const { data: files } = await supabase.storage.from(BUCKET).list(String(y), { limit: 1000 });
    for (const f of (files ?? []) as Array<{ name: string }>) {
      const date = f.name.replace(".csv.gz", "");
      if (date < from || date > to) continue;
      const { data: blob } = await supabase.storage.from(BUCKET).download(`${y}/${f.name}`);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      out.set(date, parseCsv(gunzipSync(buf).toString("utf-8")));
    }
  }
  return out;
}
