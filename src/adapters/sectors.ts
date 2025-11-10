// src/adapters/sectors.ts
import type { SectorRow } from "../types/db";

// 실제 구현 전 스텁: 최소 1~2개 예시를 반환
export async function fetchAllSectorsWithMetrics(): Promise<SectorRow[]> {
  // TODO: PyKRX 또는 내부 계산으로 대체
  return [
    {
      id: "KRX:IT",
      name: "정보기술",
      metrics: { r1m: 3.2, r3m: 8.1 },
      updated_at: new Date().toISOString(),
    },
    {
      id: "KRX:HLTH",
      name: "헬스케어",
      metrics: { r1m: -1.1, r3m: 5.4 },
      updated_at: new Date().toISOString(),
    },
  ];
}
