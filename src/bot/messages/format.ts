// src/bot/messages/format.ts — 텔레그램 HTML 메시지 공통 유틸리티

/** HTML 특수문자 이스케이프 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 정수 포맷 (천 단위 콤마) */
export const fmtInt = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";

/** 소수 1자리 */
export const fmtOne = (n: number) =>
  Number.isFinite(n) ? n.toFixed(1) : "-";

/** 퍼센트 (부호 포함) */
export const fmtPct = (n: number) =>
  Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "-";

/** 구분선 */
export const LINE = "─────────────────";

/** 등급 라벨 (A→●, B→◐, C→○, D→✕) */
export const gradeLabel: Record<string, string> = {
  A: "●",
  B: "◐",
  C: "○",
  D: "✕",
};

/** 등고 변동 화살표 */
export const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "―");
