/**
 * 리포트용 하락 가정 — 계좌 보유를 주식·채권·금·현금성으로 묶어 충격을 주고 평가금이 얼마나 줄지 계산한다.
 * 예측이 아니라 "이런 일이 생기면" 계산이다. 충격 크기는 web/src/lib/mix.ts의 STRESS_PRESETS와 같은 값(손으로 옮긴 사본 —
 * 한쪽만 고치면 갈라진다. 바꿀 때 둘 다 고친다). 자산 안의 개별 차이(커버드콜은 덜 빠짐 등)는 모른다고 가정한다.
 */
import type { AssetBucket } from "./incomeGuide";

export type StressClass = "equity" | "bond" | "gold" | "cash";
export type StressShocks = { equity: number; bond: number; gold: number };

export const REPORT_STRESS_PRESETS: Array<{ key: string; label: string; note: string; shocks: StressShocks }> = [
  { key: "crash", label: "일반 폭락", note: "주식 −40%, 채권·금은 제자리", shocks: { equity: -0.4, bond: 0, gold: 0 } },
  { key: "rate", label: "금리 급등형", note: "주식 −25%, 채권 −20% (2022년처럼 같이 하락)", shocks: { equity: -0.25, bond: -0.2, gold: 0 } },
  { key: "stagflation", label: "인플레 충격형", note: "주식 −35%, 채권 −15%, 금 +10%", shocks: { equity: -0.35, bond: -0.15, gold: 0.1 } },
  { key: "severe", label: "최악 가정", note: "주식 −55%, 채권 −10%, 금 −10%", shocks: { equity: -0.55, bond: -0.1, gold: -0.1 } },
];

/** 이름에 만기가 긴 채권이 보이면 금리 충격을 받는 채권, 아니면 충격 없는 현금성(KOFR·CD·단기채·MMF 등) */
const LONG_BOND = /(장기|10년|20년|30년|국채\s?10|국고채\s?10|국고채\s?30|종합채권|회사채|하이일드|미국채)/;

export function stressClassOf(bucket: AssetBucket, name: string): StressClass {
  if (bucket === "gold") return "gold";
  if (bucket === "bond_cash") return LONG_BOND.test(name) ? "bond" : "cash";
  return "equity"; // 지수·배당·커버드콜·리츠·개별주·테마·레버리지(아래에서 2배)
}

export type StressInputRow = { bucket: AssetBucket; name: string; value: number };

export type StressScenario = {
  key: string;
  label: string;
  note: string;
  /** 평가금 변화(원, 음수가 손실) */
  lossWon: number;
  /** 평가금 변화율 % (음수가 손실) */
  lossPct: number;
  /** 원금으로 돌아오는 데 필요한 수익률 % */
  recoveryNeededPct: number;
};

export type ReportStress = {
  /** 분석 대상 평가금 (예수금 제외) */
  total: number;
  /** 묶음별 비중 % — 합이 100 */
  shares: Array<{ cls: StressClass; label: string; value: number; pct: number }>;
  scenarios: StressScenario[];
};

const CLASS_LABEL: Record<StressClass, string> = { equity: "주식형(지수·배당·커버드콜·리츠·개별주·테마)", bond: "채권(만기 긴 것)", gold: "금", cash: "현금성(단기채·KOFR·CD)" };

export function buildReportStress(rows: StressInputRow[]): ReportStress | null {
  const total = rows.reduce((s, r) => s + (r.value > 0 ? r.value : 0), 0);
  if (total <= 0) return null;
  const byClass = new Map<StressClass, number>();
  for (const r of rows) {
    if (!(r.value > 0)) continue;
    const c = stressClassOf(r.bucket, r.name);
    byClass.set(c, (byClass.get(c) ?? 0) + r.value);
  }
  const order: StressClass[] = ["equity", "bond", "gold", "cash"];
  const shares = order.filter((c) => (byClass.get(c) ?? 0) > 0).map((c) => ({ cls: c, label: CLASS_LABEL[c], value: byClass.get(c)!, pct: (byClass.get(c)! / total) * 100 }));

  const scenarios = REPORT_STRESS_PRESETS.map((p) => {
    let lossWon = 0;
    for (const r of rows) {
      if (!(r.value > 0)) continue;
      const c = stressClassOf(r.bucket, r.name);
      let shock = c === "cash" ? 0 : p.shocks[c];
      if (r.bucket === "leveraged") shock = Math.max(-1, shock * 2); // 레버리지·인버스는 방향을 모르므로 2배 하락만 가정
      lossWon += r.value * shock;
    }
    const lossPct = (lossWon / total) * 100;
    return {
      key: p.key,
      label: p.label,
      note: p.note,
      lossWon: Math.round(lossWon),
      lossPct,
      recoveryNeededPct: lossPct < 0 ? (1 / (1 + lossPct / 100) - 1) * 100 : 0,
    };
  });
  return { total, shares, scenarios };
}
