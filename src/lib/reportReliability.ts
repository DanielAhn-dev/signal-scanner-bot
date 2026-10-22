/**
 * 리포트 데이터 신뢰도 — 숫자를 만든 재료가 믿을 만한지 점검해 문서 끝에 보여 준다.
 * 가격×수량 = 평가금, 종목 합 = 계좌 합이 맞는지 확인하고, 실시간가를 못 받아 매수가·종가로 대신한 종목, 평단이 없는 종목,
 * 분배율이 실제값이 아니라 가정인 종목을 알린다. 불일치가 있어도 계산을 멈추지는 않고 어디가 틀렸는지 보여 준다.
 */
export type ReliabilityRow = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  avgPrice: number | null;
  value: number;
  /** 인컴 그룹이면 분배율 출처가 중요하다 */
  isIncome: boolean;
  yieldSource: "ttm" | "assumed";
};

export type ReliabilityItem = { level: "warn" | "info"; text: string };

export type ReportReliability = {
  /** good: 막힌 곳 없음 / caution: 확인할 것 있음 / low: 가격이 없어 수량을 확정할 수 없음 */
  level: "good" | "caution" | "low";
  levelLabel: string;
  facts: Array<{ label: string; value: string }>;
  items: ReliabilityItem[];
  /** true면 매매 주수를 확정하지 말라는 신호 (가격 없는 종목이 있음) */
  blockQuantities: boolean;
};

export function buildReportReliability(input: {
  rows: ReliabilityRow[];
  accountTotal: number;
  today: string;
  /** 실시간가를 받은 종목 코드. 없으면(undefined) 실시간 여부는 모른다고 보고 점검하지 않는다 */
  realtimeCodes?: Set<string>;
  /** 월 인컴 목표(하한)가 설정돼 있는지 */
  hasIncomeFloor: boolean;
  /** 가격이 없어 가이드 계산(view)에서 빠진 종목 이름 — view는 가격 0 종목을 조용히 제외한다 */
  unpricedNames?: string[];
}): ReportReliability {
  const { rows, accountTotal, today, realtimeCodes } = input;
  const items: ReliabilityItem[] = [];
  const names = (xs: ReliabilityRow[]) => xs.map((x) => x.name).join(", ");

  const noPrice = rows.filter((r) => !(r.price > 0));
  const unpriced = [...noPrice.map((r) => r.name), ...(input.unpricedNames ?? [])];
  if (unpriced.length) items.push({ level: "warn", text: `현재가가 없는 종목: ${unpriced.join(", ")}. 이 종목은 비중·평가금 계산에서 빠져 있어 합계와 비중이 실제와 다르고, 매매 주수는 확정할 수 없습니다.` });

  // 가격 × 수량 = 평가금 (종목별) — 어긋나면 어느 종목인지 보여 준다
  const broken = rows.filter((r) => r.price > 0 && Math.abs(r.price * r.quantity - r.value) > 1);
  if (broken.length) items.push({ level: "warn", text: `가격 × 수량이 평가금과 다른 종목: ${broken.map((b) => `${b.name}(${Math.round(b.price * b.quantity).toLocaleString("ko-KR")}원 vs ${Math.round(b.value).toLocaleString("ko-KR")}원)`).join(", ")}.` });

  const sum = rows.reduce((s, r) => s + r.value, 0);
  if (Math.abs(sum - accountTotal) > 1) items.push({ level: "warn", text: `종목 평가금 합계(${Math.round(sum).toLocaleString("ko-KR")}원)가 계좌 합계(${Math.round(accountTotal).toLocaleString("ko-KR")}원)와 다릅니다.` });

  if (realtimeCodes) {
    const notLive = rows.filter((r) => r.price > 0 && !realtimeCodes.has(r.code));
    // 실시간가가 없고 현재가가 평단과 똑같으면 매수가로 대신했을 가능성이 크다 (toGuideHoldings: 시세가 없으면 매수가)
    const asBuy = notLive.filter((r) => r.avgPrice != null && r.price === r.avgPrice);
    const asClose = notLive.filter((r) => !asBuy.includes(r));
    if (asBuy.length) items.push({ level: "warn", text: `시세를 받지 못해 매수가로 대신했을 가능성이 있는 종목: ${names(asBuy)}. 손익이 0%로 보이고 매도 판단이 틀릴 수 있습니다.` });
    if (asClose.length) items.push({ level: "info", text: `실시간가가 아니라 저장된 종가를 쓴 종목: ${names(asClose)}. 장중이면 실제 가격과 다를 수 있습니다.` });
  }

  const noAvg = rows.filter((r) => r.avgPrice == null);
  if (noAvg.length) items.push({ level: "info", text: `평균 매수가가 없는 종목: ${names(noAvg)}. 수익·손실 구간을 알 수 없어 매도 제안에서 빠집니다.` });

  const assumed = rows.filter((r) => r.isIncome && r.yieldSource === "assumed");
  if (assumed.length) items.push({ level: "info", text: `분배율이 최근 12개월 실제값이 아니라 상품 유형별 가정인 인컴 종목: ${names(assumed)}. 월 분배금 추정이 실제와 다를 수 있습니다.` });

  if (!input.hasIncomeFloor) items.push({ level: "info", text: "월 인컴 목표(생활비)가 설정돼 있지 않아 인컴 하한을 지키는 매도 한도를 계산하지 못했습니다." });

  const incomeRows = rows.filter((r) => r.isIncome);
  const facts: ReportReliability["facts"] = [
    { label: "자료 기준일", value: today },
    { label: "가격 확인", value: realtimeCodes ? `실시간 ${rows.filter((r) => realtimeCodes.has(r.code)).length}/${rows.length}종목` : "확인 안 됨" },
    { label: "평단 있는 종목", value: `${rows.length - noAvg.length}/${rows.length}` },
    { label: "분배율 실제값(인컴 종목)", value: incomeRows.length ? `${incomeRows.length - assumed.length}/${incomeRows.length}` : "인컴 종목 없음" },
  ];

  const blockQuantities = unpriced.length > 0;
  const hasWarn = items.some((i) => i.level === "warn");
  const level: ReportReliability["level"] = blockQuantities ? "low" : hasWarn ? "caution" : "good";
  const levelLabel = level === "low" ? "낮음 — 가격이 없는 종목이 있습니다" : level === "caution" ? "확인 필요" : "문제 없음";
  return { level, levelLabel, facts, items, blockQuantities };
}
