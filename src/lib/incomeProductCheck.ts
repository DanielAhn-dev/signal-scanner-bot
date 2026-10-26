/**
 * 인컴 상품 점검 — 일반 계좌(현금으로 쓸 수 있는 계좌)에 있는 인컴 상품을 분배 이력·총수익·중복으로 한 줄씩 판단한다.
 * 숫자 하나로 합친 점수는 쓰지 않고, 항목마다 기준을 밝힌 규칙으로 판정과 이유를 낸다. 매매 지시가 아니라 점검·순서 안내다.
 *
 *  보류(wait)    지급 이력이 6회 미만이거나 새 자료가 없다 → 안정성을 판단할 수 없다
 *  주의(caution) 최근 3회 분배가 직전 3회보다 25% 넘게 줄었다 / 최근 6회 변동계수 0.30 초과 / 분배금이 1년 새 2.5배 넘게 늘었다(변동성 장세의 결과일 수 있다)
 *  담을 후보(add) 지급 12회 이상, 변동계수 0.15 이하, 최근 분배 추세 −15% 이상, 같은 기초 계열이 일반 인컴의 40% 미만
 *  유지(keep)    그 밖 — 같은 계열 비중이 이미 크면 이유에 적는다
 * 기준은 2026-10 보유 상품 분포를 보고 정한 점검용 문턱이며 검증된 매매 규칙이 아니다. 한 시기의 표본이라 시장이 바뀌면 달라진다.
 */
import type { DistributionStats } from "./distributionStats";

export type CheckVerdict = "add" | "keep" | "caution" | "wait";

export type IncomeCheckInput = {
  code: string;
  name: string;
  /** 일반 계좌 평가금 (계좌 합) */
  value: number;
  price: number;
  /** 같은 기초·방식 상품끼리 묶는 열쇠 (rebalancePlan.strategyKey) */
  family: string;
  /** 가이드가 쓰는 분배율(%)과 출처 */
  yieldPct: number;
  yieldSource: "history" | "short" | "naver" | "assumed";
  stats: DistributionStats | null;
  /** 네이버 3개월 가격수익률(%) — 없으면 null */
  price3mPct: number | null;
};

export type IncomeCheckRow = {
  code: string;
  name: string;
  value: number;
  sharePct: number;
  familySharePct: number;
  yieldPct: number;
  yieldSource: IncomeCheckInput["yieldSource"];
  payments: number;
  historyMonths: number;
  cv6: number | null;
  trendPct: number | null;
  lastVsPeakPct: number | null;
  /** 가격수익률 + 최근 3개월 분배금 (세전, 재투자 제외) */
  total3mPct: number | null;
  verdict: CheckVerdict;
  reasons: string[];
};

const ORDER: Record<CheckVerdict, number> = { add: 0, keep: 1, caution: 2, wait: 3 };

export function buildIncomeCheck(inputs: IncomeCheckInput[]): IncomeCheckRow[] {
  const total = inputs.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return [];
  const familyValue = new Map<string, number>();
  for (const i of inputs) familyValue.set(i.family, (familyValue.get(i.family) ?? 0) + i.value);

  const rows = inputs.map((i): IncomeCheckRow => {
    const st = i.stats;
    const sharePct = (i.value / total) * 100;
    const familySharePct = ((familyValue.get(i.family) ?? 0) / total) * 100;
    const reasons: string[] = [];
    let total3m: number | null = null;
    if (st && i.price3mPct != null && i.price > 0) {
      const start = i.price / (1 + i.price3mPct / 100);
      total3m = i.price3mPct + (st.sum3m / start) * 100;
    }

    let verdict: CheckVerdict;
    if (!st || st.stale || st.payments < 6) {
      verdict = "wait";
      reasons.push(
        !st
          ? "분배금 이력이 없습니다(분배금 올리기에서 엑셀을 올리면 판단합니다)"
          : st.stale
            ? "마지막 지급 이후 새 자료가 없습니다"
            : `지급 이력이 ${st.payments}회뿐이라 안정성을 판단할 수 없습니다`,
      );
    } else {
      const cautions: string[] = [];
      if (st.trendPct != null && st.trendPct <= -25) cautions.push(`최근 3회 분배가 직전 3회보다 ${Math.abs(st.trendPct).toFixed(0)}% 줄었습니다`);
      if (st.cv6 != null && st.cv6 > 0.3) cautions.push(`최근 6회 분배가 들쭉날쭉합니다(변동계수 ${st.cv6.toFixed(2)})`);
      if (st.surgeX != null && st.surgeX >= 2.5) cautions.push(`분배금이 1년 새 ${st.surgeX.toFixed(1)}배가 됐습니다 — 변동성이 큰 장세의 결과일 수 있어 이어진다고 보기 어렵습니다`);
      if (cautions.length) {
        verdict = "caution";
        reasons.push(...cautions);
      } else if (st.payments >= 12 && (st.cv6 ?? 1) <= 0.15 && (st.trendPct ?? -100) >= -15 && familySharePct < 40) {
        verdict = "add";
        reasons.push(`지급 ${st.payments}회, 최근 6회 변동계수 ${st.cv6!.toFixed(2)}, 추세 ${st.trendPct! >= 0 ? "+" : ""}${st.trendPct!.toFixed(0)}%로 안정적입니다`);
      } else {
        verdict = "keep";
        if (familySharePct >= 40) reasons.push(`같은 기초·방식 상품이 일반 인컴의 ${familySharePct.toFixed(0)}%라 더 늘리면 한쪽에 쏠립니다`);
        else if (st.payments < 12) reasons.push(`지급 ${st.payments}회라 아직 1년 이력이 안 됩니다`);
        else reasons.push("안정성은 보통입니다");
      }
      if (st.lastVsPeakPct < 75) reasons.push(`마지막 분배가 최근 최고의 ${st.lastVsPeakPct.toFixed(0)}% 수준입니다`);
    }
    return {
      code: i.code,
      name: i.name,
      value: Math.round(i.value),
      sharePct,
      familySharePct,
      yieldPct: i.yieldPct,
      yieldSource: i.yieldSource,
      payments: st?.payments ?? 0,
      historyMonths: st?.historyMonths ?? 0,
      cv6: st?.cv6 ?? null,
      trendPct: st?.trendPct ?? null,
      lastVsPeakPct: st ? st.lastVsPeakPct : null,
      total3mPct: total3m,
      verdict,
      reasons,
    };
  });

  // 담을 후보는 같은 계열 비중이 낮은 쪽 → 최근 3개월 총수익이 높은 쪽 순
  return rows.sort(
    (a, b) =>
      ORDER[a.verdict] - ORDER[b.verdict] ||
      (a.verdict === "add" ? a.familySharePct - b.familySharePct || (b.total3mPct ?? -999) - (a.total3mPct ?? -999) : b.value - a.value),
  );
}
