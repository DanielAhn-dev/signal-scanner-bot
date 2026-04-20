import type { SectorScore } from "../lib/sectors";
import type { MarketOverview } from "../utils/fetchMarketData";

export type SectorFlowInsightRow = {
  name: string;
  foreignFlow: number;
  instFlow: number;
  totalFlow: number;
};

const LARGE_CAP_KEYWORDS = [
  "코스피 200",
  "코스피200",
  "TOP 10",
  "비중상한",
  "전기전자",
  "대형주",
];

const GROWTH_KEYWORDS = [
  "코스닥",
  "기술",
  "정보기술",
  "헬스케어",
  "산업재",
  "기계",
  "전자장비",
  "성장",
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function joinNames(items: string[], fallback: string): string {
  const filtered = items.filter(Boolean).slice(0, 3);
  return filtered.length ? filtered.join(", ") : fallback;
}

function buildTopFlowNames(rows: SectorFlowInsightRow[], kind: "positive" | "negative"): string[] {
  return rows
    .filter((row) => (kind === "positive" ? row.totalFlow > 0 : row.totalFlow < 0))
    .sort((a, b) => (kind === "positive" ? b.totalFlow - a.totalFlow : a.totalFlow - b.totalFlow))
    .slice(0, 3)
    .map((row) => row.name);
}

export function buildFlowInsightLines(rows: SectorFlowInsightRow[]): string[] {
  const activeRows = rows.filter((row) => row.totalFlow !== 0);
  if (!activeRows.length) {
    return ["뚜렷한 수급 축이 약해, 숫자보다 개별 종목 거래대금과 추세 확인이 더 중요합니다."];
  }

  const foreignTotal = activeRows.reduce((sum, row) => sum + row.foreignFlow, 0);
  const instTotal = activeRows.reduce((sum, row) => sum + row.instFlow, 0);
  const foreignLargeCap = activeRows
    .filter((row) => includesAny(row.name, LARGE_CAP_KEYWORDS))
    .reduce((sum, row) => sum + row.foreignFlow, 0);
  const foreignGrowth = activeRows
    .filter((row) => includesAny(row.name, GROWTH_KEYWORDS))
    .reduce((sum, row) => sum + row.foreignFlow, 0);
  const instLargeCap = activeRows
    .filter((row) => includesAny(row.name, LARGE_CAP_KEYWORDS))
    .reduce((sum, row) => sum + row.instFlow, 0);
  const instGrowth = activeRows
    .filter((row) => includesAny(row.name, GROWTH_KEYWORDS))
    .reduce((sum, row) => sum + row.instFlow, 0);
  const positiveNames = buildTopFlowNames(activeRows, "positive");
  const negativeNames = buildTopFlowNames(activeRows, "negative");
  const lines: string[] = [];

  if (foreignLargeCap < 0 && foreignGrowth > 0 && instLargeCap > 0) {
    lines.push("외국인은 대형지수 비중을 줄이면서 성장·설비 쪽으로 옮기고, 기관은 대형주를 받아내며 함께 담는 재배치 흐름으로 읽힙니다.");
  } else if (foreignTotal < 0 && instTotal > 0) {
    lines.push("외국인 매도를 기관이 흡수하는 구조라, 지수는 버틸 수 있어도 체감 강도는 종목별로 갈릴 가능성이 큽니다.");
  } else if (foreignTotal > 0 && instTotal > 0) {
    lines.push("외국인과 기관이 같은 방향으로 유입되는 구간이라, 시장 전체 수급은 비교적 우호적인 편입니다.");
  } else if (foreignTotal < 0 && instTotal < 0) {
    lines.push("외국인과 기관이 모두 보수적으로 움직여, 지금 장은 공격보다 방어와 선별 대응이 더 자연스럽습니다.");
  } else if (foreignTotal > 0 && instTotal < 0) {
    lines.push("외국인이 주도하는 반등 성격이 강해, 추세는 나올 수 있어도 기관 확인 매수 전까지는 변동성이 큰 편입니다.");
  }

  if (positiveNames.length || negativeNames.length) {
    lines.push(`강하게 받는 쪽은 ${joinNames(positiveNames, "뚜렷한 상단 섹터 없음")}이고, 상대적으로 약한 쪽은 ${joinNames(negativeNames, "뚜렷한 하단 섹터 없음")}입니다.`);
  }

  if (instLargeCap > 0 && instGrowth > 0 && foreignLargeCap < 0) {
    lines.push("한쪽이 일방적으로 끌어올리는 장이라기보다, 기관이 지수 하단을 받치고 외국인은 섹터 로테이션을 만드는 장에 가깝습니다.");
  } else if (positiveNames.length >= 2 && Math.sign(foreignTotal || 1) === Math.sign(instTotal || 1)) {
    lines.push("따라서 지금은 시장 전체 방향보다 실제 자금이 붙는 섹터와 그 안의 대표 종목을 좁혀서 보는 편이 효율적입니다.");
  }

  return lines.slice(0, 3);
}

export function buildMarketInsightLines(input: {
  market: MarketOverview;
  riskScore: number;
  regimeLabel: string;
  topSectors: Array<{ name: string }>;
  nextSectors: Array<{ name: string }>;
}): string[] {
  const { market, riskScore, regimeLabel, topSectors, nextSectors } = input;
  const lines: string[] = [];
  const leadNames = topSectors.slice(0, 3).map((sector) => sector.name);
  const nextNames = nextSectors.slice(0, 2).map((sector) => sector.name);
  const vix = Number(market.vix?.price ?? 0);
  const usdkrw = Number(market.usdkrw?.price ?? 0);

  if (riskScore >= 70) {
    lines.push(`지금 장은 ${regimeLabel} 쪽 해석이 맞습니다. 시장 전체를 넓게 사기보다 방어와 현금 여력을 우선 두는 편이 안전합니다.`);
  } else if (riskScore <= 40) {
    lines.push(`지금 장은 ${regimeLabel} 쪽입니다. 다만 지수 전체 추격보다 실제로 자금이 붙는 섹터를 따라가는 편이 효율적입니다.`);
  } else {
    lines.push(`지금 장은 ${regimeLabel}과 관망 사이의 중간 구간입니다. 방향성은 열려 있지만, 아무 섹터나 따라가기는 애매한 환경입니다.`);
  }

  if (leadNames.length) {
    let line = `현재 수급 중심은 ${joinNames(leadNames, "상위 섹터 확인 중")}입니다.`;
    if (nextNames.length) {
      line += ` 다음 후보로는 ${joinNames(nextNames, "후보 확인 중")}가 보입니다.`;
    }
    lines.push(line);
  }

  if (vix >= 20 || usdkrw >= 1400) {
    lines.push("변동성과 환율 부담이 완전히 풀린 장은 아니라서, 신규 진입은 분할 접근과 손절 기준을 함께 가져가는 편이 맞습니다.");
  } else if (riskScore <= 40) {
    lines.push("거시 부담이 상대적으로 덜해, 주도 섹터 대표주 중심으로만 천천히 비중을 늘리는 전략이 무리하지 않습니다.");
  }

  return lines.slice(0, 3);
}

export function buildEconomyInsightLines(market: MarketOverview): string[] {
  const lines: string[] = [];
  const vix = Number(market.vix?.price ?? 0);
  const us10y = Number(market.us10y?.price ?? 0);
  const usdkrw = Number(market.usdkrw?.price ?? 0);
  const fearGreed = Number(market.fearGreed?.score ?? 50);

  if (vix >= 30 || us10y >= 5 || usdkrw >= 1450) {
    lines.push("거시 변수는 아직 방어 우위 구간입니다. 공격적으로 확장하기보다 비중 조절과 손실 제한을 먼저 점검하는 편이 자연스럽습니다.");
  } else if (vix >= 20 || us10y >= 4.5 || usdkrw >= 1400) {
    lines.push("거시 환경은 완전한 위험선호보다 경계에 가깝습니다. 신규 진입은 가능해도 분할 접근과 확인 매수가 전제돼야 합니다.");
  } else {
    lines.push("거시 지표만 놓고 보면 시장을 막을 정도의 큰 압박은 아닙니다. 다만 공격적 확장보다 강한 섹터 위주 선별 대응이 여전히 유리합니다.");
  }

  if (fearGreed <= 25) {
    lines.push("심리는 공포 쪽이라, 숫자만 나쁘다고 바로 비관하기보다 과매도 반등 후보를 함께 봐야 하는 구간입니다.");
  } else if (fearGreed >= 75) {
    lines.push("심리는 탐욕 쪽에 가까워, 좋은 지표가 나와도 추격 매수보다 분할 익절과 재진입 가격 관리가 더 중요합니다.");
  }

  if (usdkrw >= 1400 && vix >= 20) {
    lines.push("환율과 변동성이 같이 높으면 외국인 수급이 흔들리기 쉬워, 대형주도 안심 구간으로 보기 어렵습니다.");
  } else if (vix < 20 && us10y < 4.5) {
    lines.push("변동성과 금리 부담이 심하지 않아, 실전에서는 시장 전체보다 어떤 업종에 자금이 붙는지 확인하는 단계로 넘어가면 됩니다.");
  }

  return lines.slice(0, 3);
}

export function buildSectorInsightLines(sectors: SectorScore[]): string[] {
  if (!sectors.length) {
    return ["섹터 강도 데이터가 부족해, 당장은 종목별 거래대금과 가격 구조를 우선 확인하는 편이 낫습니다."];
  }

  const leader = sectors[0];
  const second = sectors[1];
  const topNames = sectors.slice(0, 3).map((sector) => sector.name);
  const lines: string[] = [];
  const gap = leader && second ? Number(leader.score) - Number(second.score) : 0;

  if (leader && second && gap >= 8) {
    lines.push(`${leader.name}가 확실한 선두라, 지금은 테마 확산보다 1등 섹터 집중 장세에 더 가깝습니다.`);
  } else if (topNames.length >= 3) {
    lines.push(`상위 섹터 간 점수 차가 크지 않아 ${joinNames(topNames, "상위 섹터")} 중심의 순환매가 빠르게 돌 수 있습니다.`);
  }

  if (leader) {
    const flowParts: string[] = [];
    if (leader.flowF5) flowParts.push(`외국인 ${leader.flowF5 > 0 ? "유입" : "이탈"}`);
    if (leader.flowI5) flowParts.push(`기관 ${leader.flowI5 > 0 ? "유입" : "이탈"}`);
    if (flowParts.length) {
      lines.push(`${leader.name}는 강도뿐 아니라 ${flowParts.join(", ")}이 같이 보이는지 확인하면 추세 신뢰도를 더 빨리 가늠할 수 있습니다.`);
    }
  }

  lines.push("따라서 지금은 하위 테마를 넓게 추격하기보다, 상위 섹터 대표 종목 안에서 진입 자리를 고르는 편이 더 안정적입니다.");
  return lines.slice(0, 3);
}