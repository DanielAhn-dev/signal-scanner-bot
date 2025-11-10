// src/adapters/sectors.ts
export type SectorRow = {
  id: string;
  name: string;
  metrics?: any;
  updated_at?: string;
};

/**
 * KRX 업종/테마 전체를 반환.
 * 1차 버전: 정적 목록 또는 저장소의 JSON에서 불러오기.
 * 2차 버전: 지표 계산 잡이 metrics를 주기적으로 갱신.
 */
export async function fetchAllSectors(): Promise<SectorRow[]> {
  // TODO: 실제 목록으로 교체. 우선 예시 (필요 시 Storage JSON을 fetch)
  const base: SectorRow[] = [
    { id: "KRX:IT", name: "정보기술" },
    { id: "KRX:HLTH", name: "헬스케어" },
    { id: "KRX:FIN", name: "금융" },
    { id: "KRX:IND", name: "산업재" },
    { id: "KRX:CSTM", name: "필수소비재" },
    { id: "KRX:DSCR", name: "임의소비재" },
    { id: "KRX:ENRG", name: "에너지" },
    { id: "KRX:MATR", name: "소재" },
    { id: "KRX:UTIL", name: "유틸리티" },
    { id: "KRX:COMM", name: "커뮤니케이션" },
  ];
  const now = new Date().toISOString();
  return base.map((s) => ({ ...s, metrics: s.metrics ?? {}, updated_at: now }));
}
