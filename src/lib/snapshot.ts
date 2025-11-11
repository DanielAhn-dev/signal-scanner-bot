// src/lib/snapshot.ts
import { StockRow, SectorRow } from "../types/db";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed ${r.status}: ${url}`);
  return (await r.json()) as T;
}

export async function loadAllKRXStocks(): Promise<StockRow[]> {
  const url = process.env.ALL_KRX_JSON_URL || "";
  if (!url) throw new Error("ALL_KRX_JSON_URL missing");
  const list = await fetchJson<StockRow[]>(url);
  // 기본 정합성 체크
  return (list || []).filter((x) => x?.code && x?.name);
}

export async function loadAllSectors(): Promise<SectorRow[]> {
  // 정적 목록 또는 환경변수 기반 JSON URL
  const url = process.env.ALL_KRX_SECTORS_URL || "";
  if (!url) {
    // fallback: 최소 목록
    const now = new Date().toISOString();
    return [
      { id: "KRX:IT", name: "정보기술", metrics: {}, updated_at: now },
      { id: "KRX:HLTH", name: "헬스케어", metrics: {}, updated_at: now },
      { id: "KRX:FIN", name: "금융", metrics: {}, updated_at: now },
      { id: "KRX:IND", name: "산업재", metrics: {}, updated_at: now },
      { id: "KRX:DSCR", name: "임의소비재", metrics: {}, updated_at: now },
      { id: "KRX:CSTM", name: "필수소비재", metrics: {}, updated_at: now },
      { id: "KRX:MATR", name: "소재", metrics: {}, updated_at: now },
      { id: "KRX:ENRG", name: "에너지", metrics: {}, updated_at: now },
      { id: "KRX:UTIL", name: "유틸리티", metrics: {}, updated_at: now },
      { id: "KRX:COMM", name: "커뮤니케이션", metrics: {}, updated_at: now },
    ];
  }
  const list = await fetchJson<SectorRow[]>(url);
  const now = new Date().toISOString();
  return (list || []).map((s) => ({
    ...s,
    metrics: s.metrics ?? {},
    updated_at: s.updated_at ?? now,
  }));
}
