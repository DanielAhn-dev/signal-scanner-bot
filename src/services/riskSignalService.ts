import type { SupabaseClient } from "@supabase/supabase-js";

export interface MarketIndex {
  value: number;
  change?: number;
  changePercent?: number;
}

export interface MarketData {
  vix?: number | MarketIndex;
  usdkrw?: number;
  usdkrw_weekly_change?: number;
  [key: string]: any;
}

export interface RiskFactor {
  type: string;
  value: string | number;
  signal: number;
}

export interface RiskSignalResult {
  signal_count: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  factors: RiskFactor[];
  html_brief: string;
  strategy_options: string;
}

async function getLatestInvestorFlow(
  supabase: SupabaseClient
): Promise<{
  foreign_net?: number;
  institution_net?: number;
  retail_net?: number;
  prev_days?: Array<{ date: string; foreign_net: number }>;
}> {
  try {
    const { data, error } = await supabase
      .from("investor_daily")
      .select("date, foreign_net, institution_net, retail_net")
      .order("date", { ascending: false })
      .limit(4);

    if (error) {
      console.error("[riskSignalService] investor_daily 조회 실패:", error);
      return {};
    }

    if (!data || data.length === 0) {
      return {};
    }

    return {
      foreign_net: data[0].foreign_net,
      institution_net: data[0].institution_net,
      retail_net: data[0].retail_net,
      prev_days: data.slice(0, 3),
    };
  } catch (error) {
    console.error("[riskSignalService] investor_daily 조회 예외:", error);
    return {};
  }
}

function checkForeignConsecutiveSelling(prevDays: Array<{ date: string; foreign_net: number }> | undefined): RiskFactor | null {
  if (!prevDays || prevDays.length < 3) {
    return null;
  }

  const last3 = prevDays.slice(0, 3);
  const allNegative = last3.every((d) => d.foreign_net < -1_000_000);

  if (allNegative) {
    const totalNet = last3.reduce((sum, d) => sum + d.foreign_net, 0);
    return {
      type: "외국인_연속순매도",
      value: `${(totalNet / 1_000_000).toFixed(1)}M`,
      signal: 1,
    };
  }

  return null;
}

function checkForeignInstitutionDiscrepancy(
  foreignNet: number | undefined,
  institutionNet: number | undefined
): RiskFactor | null {
  if (foreignNet === undefined || institutionNet === undefined) {
    return null;
  }

  if (foreignNet < 0 && institutionNet > 0) {
    const discrepancy = Math.abs(foreignNet - institutionNet);
    const ratio = (discrepancy / (Math.abs(foreignNet) + Math.abs(institutionNet))) * 100;

    if (ratio > 30) {
      return {
        type: "외국인기관_수급괴리",
        value: `외 ${(foreignNet / 1_000_000).toFixed(1)}M, 기 ${(institutionNet / 1_000_000).toFixed(1)}M`,
        signal: 1,
      };
    }
  }

  return null;
}

function checkVixSpike(vix: number | MarketIndex | undefined): RiskFactor | null {
  let vixValue: number | undefined;
  
  if (typeof vix === "number") {
    vixValue = vix;
  } else if (vix && typeof vix === "object" && "value" in vix) {
    vixValue = (vix as MarketIndex).value;
  }
  
  if (vixValue === undefined || vixValue <= 25) {
    return null;
  }

  return {
    type: "VIX_급상승",
    value: vixValue.toFixed(1),
    signal: 1,
  };
}

function checkWonWeakness(usdkrw: number | undefined, weeklyChange?: number): RiskFactor | null {
  if (usdkrw === undefined || !weeklyChange || weeklyChange <= 2) {
    return null;
  }

  return {
    type: "원화_약세",
    value: `${weeklyChange.toFixed(1)}%`,
    signal: 1,
  };
}

export async function calculateRiskSignals(
  supabase: SupabaseClient,
  marketData: MarketData,
  options?: { chatId?: number }
): Promise<RiskSignalResult> {
  const factors: RiskFactor[] = [];
  let signalCount = 0;

  // 수급 데이터 조회
  const investorFlow = await getLatestInvestorFlow(supabase);

  // 신호 1: 외국인 3일 연속 순매도
  const foreignSelling = checkForeignConsecutiveSelling(investorFlow.prev_days);
  if (foreignSelling) {
    factors.push(foreignSelling);
    signalCount += foreignSelling.signal;
  }

  // 신호 2: 외국인-기관 수급 괴리
  const discrepancy = checkForeignInstitutionDiscrepancy(
    investorFlow.foreign_net,
    investorFlow.institution_net
  );
  if (discrepancy) {
    factors.push(discrepancy);
    signalCount += discrepancy.signal;
  }

  // 신호 3: VIX 급상승
  const vixSpike = checkVixSpike(marketData.vix);
  if (vixSpike) {
    factors.push(vixSpike);
    signalCount += vixSpike.signal;
  }

  // 신호 4: 원화 약세 (주간 변화)
  const wonWeakness = checkWonWeakness(marketData.usdkrw, marketData.usdkrw_weekly_change);
  if (wonWeakness) {
    factors.push(wonWeakness);
    signalCount += wonWeakness.signal;
  }

  // 위험도 판정
  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (signalCount >= 4) {
    riskLevel = "HIGH";
  } else if (signalCount >= 2) {
    riskLevel = "MEDIUM";
  }

  // HTML 브리핑 생성
  const html_brief = formatRiskSignalBriefing(factors, riskLevel);
  const strategy_options = formatStrategyOptions(riskLevel);

  return {
    signal_count: signalCount,
    risk_level: riskLevel,
    factors,
    html_brief,
    strategy_options,
  };
}

function formatRiskSignalBriefing(factors: RiskFactor[], riskLevel: "LOW" | "MEDIUM" | "HIGH"): string {
  const levelEmoji = riskLevel === "HIGH" ? "🔴" : riskLevel === "MEDIUM" ? "🟡" : "🟢";
  const levelLabel = riskLevel === "HIGH" ? "HIGH" : riskLevel === "MEDIUM" ? "MEDIUM" : "LOW";

  if (factors.length === 0) {
    return `<b>리스크 신호 ${levelEmoji} ${levelLabel}</b>\n감지된 신호 없음`;
  }

  let brief = `<b>리스크 신호 ${levelEmoji} ${levelLabel}</b>\n`;
  for (const factor of factors) {
    brief += `  • ${factor.type}: ${factor.value}\n`;
  }

  return brief;
}

function formatStrategyOptions(riskLevel: "LOW" | "MEDIUM" | "HIGH"): string {
  const strategies: Record<string, string> = {
    HOLD_SAFE: "안전 포지셀",
    REDUCE_TIGHT: "타이트 손절",
    WAIT_AND_DIP_BUY: "매수 기회 대기",
  };

  let options = `\n권장 전략\n`;
  options += `1️⃣ ${strategies.HOLD_SAFE} — 보수 운용, 무보유 시 1종목만 진입\n`;
  options += `2️⃣ ${strategies.REDUCE_TIGHT} — 손절 2%, 익절 4%\n`;
  options += `3️⃣ ${strategies.WAIT_AND_DIP_BUY} — 현금 보유, 저가 진입 대기\n`;
  options += `\n/전략선택 으로 선택하세요.`;

  return options;
}
