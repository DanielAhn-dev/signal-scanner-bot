// src/jobs/sync.ts
import { syncSectorScoresToDB } from "../data/sector";

(async () => {
  console.log("[sync] 섹터 점수 동기화 시작...");
  await syncSectorScoresToDB();
  console.log("[sync] 완료 ✅");
})();
