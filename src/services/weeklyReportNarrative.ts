import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import {
  FIFO_REALIZED_LABEL,
  FIFO_TRADE_NOTE,
  FIFO_WIN_RATE_LABEL,
  fmtInt,
  fmtKorMoney,
  fmtPct,
  fmtSignedInt,
  toNum,
  type ReportTopic,
} from "./weeklyReportShared";

type NarrativeWindowSummary = {
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  realizedPnl: number;
  winRate: number;
};

type NarrativeWatchItem = {
  code: string;
  name: string;
  pnlPct: number | null;
};

type NarrativeSectorRow = {
  name: string;
  score: number | null;
  change_rate: number | null;
  metrics?: Record<string, unknown> | null;
};

type NarrativeMarket = Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
type CoverMarket = Awaited<ReturnType<typeof fetchReportMarketData>>;

function formatKstDateTimeLabel(iso?: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function buildMarketDataQualityLine(market: NarrativeMarket): string | null {
  const meta = market.meta;
  if (!meta) return null;

  const quality = meta.isPartial ? "부분 수집" : "정상";
  const fetchedAt = formatKstDateTimeLabel(meta.fetchedAt);
  const missing = meta.isPartial && meta.missing.length
    ? ` / 누락: ${meta.missing.join(", ")}`
    : "";

  return `데이터 상태 ${quality}${fetchedAt ? ` / 조회 ${fetchedAt} KST` : ""}${missing}`;
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, options: string[]): string {
  if (!options.length) return "";
  return options[hashSeed(seed) % options.length];
}

export function buildTopicHeroSummary(input: {
  topic: ReportTopic;
  defaultSummary: string;
  curr: NarrativeWindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  watchItems: NarrativeWatchItem[];
  sectors: NarrativeSectorRow[];
  market: NarrativeMarket;
}): string {
  const { topic, defaultSummary, curr, totalUnrealized, totalUnrealizedPct, watchItems, sectors, market } = input;
  const seedBase = `${topic}|${curr.tradeCount}|${totalUnrealized.toFixed(0)}|${sectors[0]?.name ?? "none"}`;

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const fearGreed = toNum((market as any).fearGreed?.score);
    const vixLabel = vix >= 30 ? "고변동성" : vix >= 20 ? "경계" : "안정";
    const sentimentLabel = fearGreed <= 25 ? "공포" : fearGreed >= 75 ? "탐욕" : "중립";
    if (vix > 0 || usdkrw > 0 || fearGreed > 0) {
      return pickVariant(`${seedBase}|hero|economy`, [
        `VIX ${vix > 0 ? vix.toFixed(1) : "-"}, 환율 ${usdkrw > 0 ? fmtInt(usdkrw) + "원" : "-"}, 심리 ${sentimentLabel} 구간으로 현재 시장 체온은 ${vixLabel}에 가깝습니다.`,
        `거시 온도는 ${vixLabel}입니다. VIX ${vix > 0 ? vix.toFixed(1) : "-"}와 환율 ${usdkrw > 0 ? fmtInt(usdkrw) + "원" : "-"}, 투자심리 ${sentimentLabel}를 함께 체크해야 하는 구간입니다.`,
        `현재 매크로 포인트는 변동성·환율·심리의 조합입니다. VIX ${vix > 0 ? vix.toFixed(1) : "-"}, 달러/원 ${usdkrw > 0 ? fmtInt(usdkrw) + "원" : "-"}, 심리 ${sentimentLabel}로 요약됩니다.`,
      ]);
    }
  }

  if (topic === "flow") {
    const ranked = sectors
      .map((sector) => {
        const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
        const totalFlow = toNum(metrics.flow_foreign_5d) + toNum(metrics.flow_inst_5d);
        return { name: sector.name, totalFlow };
      })
      .filter((row) => row.totalFlow !== 0)
      .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow));
    if (ranked.length > 0) {
      const top = ranked[0];
      return pickVariant(`${seedBase}|hero|flow|${top.name}`, [
        `${top.name} 섹터에 최근 5거래일 기준 ${fmtKorMoney(top.totalFlow)} 규모의 순유입이 관측돼 자금 집중도가 가장 높습니다.`,
        `자금은 ${top.name}에 가장 강하게 모였습니다(최근 5거래일 ${fmtKorMoney(top.totalFlow)}). 수급 주도 구간으로 해석할 수 있습니다.`,
        `최근 수급의 중심은 ${top.name}입니다. 누적 ${fmtKorMoney(top.totalFlow)} 흐름이 확인돼 단기 우선순위가 높습니다.`,
      ]);
    }
  }

  if (topic === "sector") {
    const top = sectors[0];
    if (top) {
      return pickVariant(`${seedBase}|hero|sector|${top.name}`, [
        `${top.name}가 점수 ${toNum(top.score).toFixed(1)}점, 수익률 ${fmtPct(toNum(top.change_rate))}로 현재 강도 1위를 기록하고 있습니다.`,
        `섹터 강도 1위는 ${top.name}입니다. 점수 ${toNum(top.score).toFixed(1)}점으로 상단을 유지하고 있습니다.`,
        `${top.name}가 강도 상위권을 이끌고 있습니다. 현재 점수 ${toNum(top.score).toFixed(1)}점, 수익률 ${fmtPct(toNum(top.change_rate))}입니다.`,
      ]);
    }
  }

  if (topic === "watchlist") {
    const worst = watchItems.filter((item) => item.pnlPct != null).sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0))[0];
    const best = watchItems.filter((item) => item.pnlPct != null).sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0))[0];
    if (watchItems.length > 0) {
      const highlight = best && worst && best.code !== worst.code
        ? `상단 점검 ${best.name} ${fmtPct(best.pnlPct ?? 0)}, 하단 점검 ${worst.name} ${fmtPct(worst.pnlPct ?? 0)}`
        : `평가손익 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`;
      return `보유 ${watchItems.length}종목 기준 ${highlight} 흐름입니다. 최근 2주 거래는 ${curr.tradeCount}건이며 매도 손익은 FIFO 기준입니다.`;
    }
  }

  if (topic === "watchonly") {
    return watchItems.length > 0
      ? `관심 종목 ${watchItems.length}개를 추적 중입니다. 기준가 대비 등락을 확인하고 매수 타이밍을 점검하세요.`
      : "등록된 관심 종목이 없습니다. /관심 명령어로 종목을 추가해 보세요.";
  }

  if (topic === "full") {
    const leadSector = sectors[0]?.name;
    if (leadSector) {
      return `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}), 최근 거래 ${curr.tradeCount}건, 주도 섹터는 ${leadSector} 중심입니다.`;
    }
  }

  return defaultSummary;
}

export function buildTopicClosingSummary(input: {
  topic: ReportTopic;
  curr: NarrativeWindowSummary;
  prev: NarrativeWindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  watchItems: NarrativeWatchItem[];
  sectors: NarrativeSectorRow[];
  market: NarrativeMarket;
}): string {
  const { topic, curr, prev, totalUnrealized, totalUnrealizedPct, watchItems, sectors, market } = input;
  const seedBase = `${topic}|${curr.tradeCount}|${prev.tradeCount}|${curr.winRate.toFixed(1)}|${totalUnrealized.toFixed(0)}|${sectors[0]?.name ?? "none"}`;

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const us10y = toNum((market as any).us10y?.price);
    const fg = toNum((market as any).fearGreed?.score ?? 50);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const gold = toNum((market as any).gold?.price);
    if (vix >= 30) {
      return pickVariant(`${seedBase}|close|economy|risk`, [
        `VIX ${vix.toFixed(1)}와 미국 10년물 ${us10y.toFixed(2)}% 조합은 고위험 구간입니다. 신규 매수는 2~3회 분할로 제한하고, 종목당 손실 한도를 먼저 고정하세요. 현금 비중을 20% 이상 유지해 급변동 재진입 여력을 남겨두는 전략이 유효합니다.`,
        `변동성 경보 구간입니다(VIX ${vix.toFixed(1)}). 공격적 추격 매수보다 포지션 축소와 손절 라인 명확화가 우선입니다. 보유 종목은 거래대금이 유지되는 핵심주 중심으로 압축하세요.`,
        `시장 리스크가 높습니다. 금리 ${us10y.toFixed(2)}%와 변동성 ${vix.toFixed(1)}가 동시에 부담을 키우고 있어 보수적 운영이 필요합니다. 이번 주는 수익 방어를 우선 과제로 두는 편이 좋습니다.`,
      ]);
    }
    if (vix >= 20 || us10y >= 5) {
      return pickVariant(`${seedBase}|close|economy|warn`, [
        `VIX ${vix.toFixed(1)} 또는 미국 10년물 ${us10y.toFixed(2)}%가 경계선입니다. 비중 확대는 주도 섹터 대표주 위주로 제한하고, 추격 매수는 피하세요. 금리 방향 전환이 확인될 때까지 포지션 규모를 평시보다 낮게 유지하는 것이 안전합니다.`,
        `거시 변수 중 하나 이상이 부담 구간입니다. 현재 전략은 공격보다 선별이 유리하며, 신규 진입은 분할 접근이 필요합니다. 손절 기준과 목표가를 사전에 고정해 변동성 대응력을 높이세요.`,
        `경계 국면입니다. 변동성과 금리의 조합이 완화되기 전까지는 방어적 운용이 적절합니다. 섹터 1위군 중심으로만 비중을 유지하고 나머지는 관찰 리스트로 돌리세요.`,
      ]);
    }
    if (fg >= 75) {
      return pickVariant(`${seedBase}|close|economy|greed`, [
        `공포·탐욕 ${fg}는 과열 신호에 가깝습니다. 추격 매수보다 분할 익절과 비중 조정의 우선순위를 높이세요. 조정 시 재진입 가격대를 미리 정해두면 대응이 훨씬 안정적입니다.`,
        `시장 심리가 과열권입니다(${fg}). 신규 진입보다 보유 수익 보호가 먼저입니다. 목표 수익률 도달 종목은 일부 차익 실현으로 변동성 리스크를 줄이세요.`,
        `탐욕 구간에서는 리스크 관리가 성과를 좌우합니다. 급등 종목 추격보다 눌림 확인 후 진입이 유리합니다. 포지션당 투입 비중도 평소보다 낮춰 운영하세요.`,
      ]);
    }
    if (usdkrw >= 1400 && gold >= 2500) {
      return pickVariant(`${seedBase}|close|economy|safe`, [
        `원화 약세(${fmtInt(usdkrw)}원)와 금 강세($${fmtInt(Math.round(gold))})가 동시에 나타났습니다. 위험자산 선호가 약해질 수 있어 방어적 비중 유지가 합리적입니다. 외국인 수급 반전 신호가 나오기 전까지는 분할 대응을 권장합니다.`,
        `안전자산 선호가 강화된 흐름입니다. 환율과 금 가격이 동시에 높아 국내 변동성이 커질 수 있습니다. 고베타 종목 비중은 줄이고 현금 비중을 일부 확보하세요.`,
        `거시 자금이 방어 쪽으로 이동하는 구간입니다. 원화와 금 지표를 함께 볼 때 공격적 레버리지 전략은 불리합니다. 주도주 중심의 보수적 포트폴리오가 더 안정적입니다.`,
      ]);
    }
    return pickVariant(`${seedBase}|close|economy|stable`, [
      `거시 지표는 대체로 안정권입니다(VIX ${vix.toFixed(1)}, 미국 10년물 ${us10y.toFixed(2)}%, 공포·탐욕 ${fg}). 공격적 확장보다 주도 섹터 중심의 점진적 비중 확대가 적절합니다. 단기 모멘텀과 거래대금 둔화 신호가 나오면 즉시 진입 속도를 낮추세요.`,
      `지금은 극단 구간이 아닌 정상 범위입니다. 시장 방향이 유지되는 동안 선도 업종 대표주 위주로 분할 접근이 유효합니다. 종목 수를 과도하게 늘리기보다 강한 포지션에 집중하는 전략이 성과에 유리합니다.`,
      `리스크 지표는 관리 가능한 구간입니다. 비중을 천천히 늘리되, 손절·익절 기준은 기존보다 더 명확하게 가져가세요. 조정이 와도 재진입할 현금 여력을 남겨두는 운영이 좋습니다.`,
    ]);
  }

  if (topic === "flow") {
    const top = sectors
      .map((sector) => {
        const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
        return {
          name: sector.name,
          totalFlow: toNum(metrics.flow_foreign_5d) + toNum(metrics.flow_inst_5d),
        };
      })
      .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow))[0];
    return top?.name
      ? pickVariant(`${seedBase}|close|flow|lead|${top.name}`, [
          `${top.name} 중심 자금 유입이 이어지고 있습니다. 역행 섹터 추격보다 선도 섹터 눌림목 대응이 유리합니다. 유입 강도가 둔화되는 시점에는 비중을 빠르게 조절하세요.`,
          `수급의 무게 중심은 ${top.name}입니다. 단기 대응은 선도 섹터 대표주에 집중하는 편이 효율적입니다. 다만 5일 누적 흐름이 꺾이면 방어 전환을 바로 실행해야 합니다.`,
          `${top.name}가 자금을 흡수하는 구간입니다. 주도 섹터 내 종목만 선별해 진입하고, 반대 흐름 섹터는 관찰 리스트로 두세요. 추세 약화 신호가 보이면 신규 진입을 즉시 축소하세요.`,
        ])
      : pickVariant(`${seedBase}|close|flow|none`, [
          "뚜렷한 자금 집중 섹터가 약합니다. 순환매 속도가 빨라 추격 매수의 효율이 낮아질 수 있습니다. 거래대금이 붙는 구간에서만 확인 매수로 접근하세요.",
          "수급 중심축이 분산된 장세입니다. 섹터 베팅보다 종목별 신호 확인이 더 중요합니다. 매수 빈도를 줄이고 손실 제한 기준을 먼저 점검하세요.",
          "자금이 한 방향으로 모이지 않는 구간입니다. 성급한 추격보다 눌림 확인 후 짧게 대응하는 전략이 안전합니다. 포지션당 비중도 보수적으로 유지하세요.",
        ]);
  }

  if (topic === "sector") {
    const leader = sectors[0]?.name;
    return leader
      ? pickVariant(`${seedBase}|close|sector|lead|${leader}`, [
          `현재 1등 섹터는 ${leader}입니다. 강도가 유지되는 동안은 하위 테마보다 선도 테마 대표주가 상대 우위일 가능성이 높습니다. 강도 점수와 거래대금이 동시에 꺾일 때만 비중 축소를 고려하세요.`,
          `${leader}가 섹터 리더십을 확보하고 있습니다. 추세가 이어지는 동안은 동일 섹터 내 상위 종목 중심 전략이 유효합니다. 확산 구간이 오면 2~3순위 섹터로 분산을 준비하세요.`,
          `섹터 강도는 ${leader} 중심입니다. 리더 섹터 내에서 진입 구간을 고르는 편이 승률에 유리합니다. 다만 과열 구간에서는 분할 익절 규칙을 함께 적용하세요.`,
        ])
      : pickVariant(`${seedBase}|close|sector|none`, [
          "섹터 강도 데이터가 고르게 분산돼 주도 테마 확신이 낮습니다. 테마 베팅보다 종목별 신호 확인이 우선입니다. 진입 규모를 줄이고 손실 제한 규칙을 엄격히 적용하세요.",
          "뚜렷한 리더 섹터가 약한 구간입니다. 성급한 추격보다 거래량과 모멘텀 동시 확인 후 진입하는 편이 안전합니다. 종목 수를 늘리기보다 관망 비중을 높이세요.",
          "주도 섹터 공백에 가까운 환경입니다. 확률 높은 진입만 선택하고 나머지는 대기 전략으로 두는 것이 낫습니다. 손절 라인은 평소보다 타이트하게 운용하세요.",
        ]);
  }

  if (topic === "watchlist") {
    const losers = watchItems.filter((item) => (item.pnlPct ?? 0) < -5).length;
    return losers > 0
      ? pickVariant(`${seedBase}|close|watch|risk|${losers}`, [
          `평가손실 -5% 초과 종목이 ${losers}개입니다. 지금은 수익 확대보다 손실 방어가 우선입니다. 비중 축소 기준과 손절 라인을 먼저 확정한 뒤 신규 진입을 검토하세요.`,
          `손실 방어가 필요한 종목이 ${losers}개 확인됩니다. 평균단가 조정보다 리스크 큰 포지션 정리가 선행돼야 합니다. 대응 우선순위를 정해 하루 안에 실행 계획을 고정하세요.`,
          `방어 모드가 필요한 구간입니다(손실 경고 ${losers}개). 약한 종목 비중을 줄이고 현금 비중을 일부 복원하세요. 신규 매수는 강도 상위 종목에만 제한하는 편이 좋습니다.`,
        ])
      : pickVariant(`${seedBase}|close|watch|ok`, [
          `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}) 기준으로 급한 방어 이슈는 제한적입니다. 강한 종목 중심으로 포트폴리오를 압축해 효율을 높이세요. 신규 진입은 기존 수익 포지션과 상관도가 낮은 종목 위주가 좋습니다.`,
          `현재 보유 상태는 안정적인 편입니다(${fmtPct(totalUnrealizedPct)}). 상위 성과 종목을 중심으로 비중을 재배치하면 관리가 쉬워집니다. 단기 변동성 확대 시를 대비해 손절 기준은 유지하세요.`,
          `포트폴리오 방어 부담은 크지 않습니다. 우세 종목에 자원을 집중하고 성과 낮은 종목은 관찰군으로 내리는 전략이 유효합니다. 수익 구간에서는 분할 익절로 변동성 노출을 줄이세요.`,
        ]);
  }

  if (topic === "watchonly") {
    return watchItems.length > 0
      ? `관심 종목 ${watchItems.length}개 추적 중입니다. 기준가 대비 등락이 유리한 종목부터 진입 시점을 구체화하세요.`
      : "관심 종목을 추가하면 이 리포트에 목록이 표시됩니다.";
  }

  return curr.realizedPnl >= prev.realizedPnl
    ? pickVariant(`${seedBase}|close|full|up`, [
        `최근 ${FIFO_REALIZED_LABEL} 흐름이 이전 구간보다 개선됐습니다. 현재 전략을 유지하되 주도 섹터 대표주 중심으로 비중을 관리하세요. 수익 종목은 분할 익절 규칙을 함께 적용하면 변동성 대응력이 높아집니다.`,
        `실현손익이 개선 방향입니다. 보유 포지션 관리를 우선으로 두고 신규 진입은 선택적으로 진행하세요. 성과가 낮은 종목은 교체 후보로 분류해 리밸런싱 효율을 높일 수 있습니다.`,
        `최근 매매 성과는 우호적입니다. 기존 전략의 틀을 유지하되, 과열 구간에서는 진입 속도를 낮추는 보완이 필요합니다. 섹터 리더십 변화 신호를 주기적으로 점검하세요.`,
      ])
    : pickVariant(`${seedBase}|close|full|down`, [
        `최근 ${FIFO_REALIZED_LABEL} 흐름이 둔화됐습니다. 진입 빈도를 한 단계 낮추고 보유 종목의 손익비를 재점검하세요. 손실 누적 종목 정리를 먼저 실행하면 회복 속도를 높일 수 있습니다.`,
        `매매 성과가 직전 구간 대비 약해졌습니다. 추격 진입을 줄이고 확인된 눌림 구간만 대응하는 전략이 필요합니다. 리스크 큰 포지션부터 축소해 변동성 노출을 낮추세요.`,
        `성과 둔화 국면입니다. 공격보다 방어 우선으로 운용하고, 신규 매수는 우선순위 1~2개로 제한하세요. 다음 주는 손절 규칙 준수율을 핵심 관리 지표로 두는 것이 좋습니다.`,
      ]);
}

export function buildCoverHeadline(input: {
  curr: NarrativeWindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: NarrativeSectorRow[];
  market: CoverMarket;
}): { kicker: string; detail: string } {
  const { curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;
  const leadSector = sectors[0]?.name ?? "주도 섹터 확인 중";
  const kospiMove = market.kospi ? fmtPct(toNum(market.kospi.changeRate)) : "-";
  const riskTone = market.vix
    ? toNum(market.vix.price) >= 30
      ? "고변동성"
      : toNum(market.vix.price) >= 20
        ? "경계"
        : "안정"
    : "중립";

  return {
    kicker: `${leadSector} 주도 · KOSPI ${kospiMove} · 시장 온도 ${riskTone}`,
    detail: `최근 거래 ${curr.tradeCount}건, 보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}) 흐름입니다.`,
  };
}

export function buildReportCaption(input: {
  title: string;
  topic: ReportTopic;
  krDate: string;
  curr: NarrativeWindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: NarrativeSectorRow[];
  market: NarrativeMarket;
}): string {
  const { title, topic, krDate, curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;
  const qualityLine = buildMarketDataQualityLine(market);

  if (topic === "economy") {
    const lines = [
      `${title} — ${krDate}`,
      `VIX ${market.vix ? toNum(market.vix.price).toFixed(1) : "-"} · 환율 ${market.usdkrw ? `${fmtInt(toNum(market.usdkrw.price))}원` : "-"}`,
      "핵심 거시 변수만 빠르게 점검할 수 있게 정리했습니다.",
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "flow") {
    const topSector = sectors[0]?.name ?? "상위 섹터";
    const lines = [
      `${title} — ${krDate}`,
      `${topSector} 중심 수급 흐름과 상위 자금 유입 섹터를 정리했습니다.`,
      "자금 방향 위주로 빠르게 확인하세요.",
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "sector") {
    const topSector = sectors[0]?.name ?? "주도 섹터";
    const lines = [
      `${title} — ${krDate}`,
      `${topSector} 포함 상위 강도 섹터를 압축했습니다.`,
      "테마 로테이션 체크용으로 바로 볼 수 있습니다.",
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "watchlist") {
    const lines = [
      `${title} — ${krDate}`,
      `최근 거래 ${curr.tradeCount}건 · 보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
      `${FIFO_TRADE_NOTE} · 보유 종목 점검용으로 바로 활용할 수 있습니다.`,
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "watchonly") {
    const lines = [
      `${title} — ${krDate}`,
      "매수 전 관심 추적 종목을 정리했습니다.",
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  const lines = [
    `${title} — ${krDate}`,
    `거래 ${curr.tradeCount}건 · ${FIFO_REALIZED_LABEL} ${fmtSignedInt(curr.realizedPnl)} · 보유평가 ${fmtSignedInt(totalUnrealized)}`,
    "다운로드 후 인쇄해서 사용하세요.",
  ];
  if (qualityLine) lines.push(qualityLine);
  return lines.join("\n");
}

export function buildReportSummaryText(input: {
  title: string;
  topic: ReportTopic;
  ymd: string;
  curr: NarrativeWindowSummary;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: NarrativeSectorRow[];
  market: NarrativeMarket;
}): string {
  const { title, topic, ymd, curr, totalUnrealized, totalUnrealizedPct, sectors, market } = input;
  const qualityLine = buildMarketDataQualityLine(market);

  if (topic === "economy") {
    const lines = [
      `${title} (${ymd})`,
      `VIX ${market.vix ? toNum(market.vix.price).toFixed(1) : "-"} / 환율 ${market.usdkrw ? `${fmtInt(toNum(market.usdkrw.price))}원` : "-"}`,
      `공포탐욕 ${market.fearGreed ? toNum(market.fearGreed.score) : "-"} / 미국 10년물 ${market.us10y ? `${toNum(market.us10y.price).toFixed(2)}%` : "-"}`,
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "flow") {
    const lines = [
      `${title} (${ymd})`,
      `상위 수급 섹터: ${sectors.slice(0, 3).map((sector) => sector.name).join(", ") || "데이터 없음"}`,
      `최근 5거래일 기준 자금 유입 방향을 압축했습니다.`,
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "sector") {
    const lines = [
      `${title} (${ymd})`,
      `상위 섹터: ${sectors.slice(0, 3).map((sector) => `${sector.name} ${toNum(sector.score).toFixed(1)}점`).join(" / ") || "데이터 없음"}`,
      `강도와 수익률 중심으로 정리했습니다.`,
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "watchlist") {
    const lines = [
      `${title} (${ymd})`,
      `거래 ${curr.tradeCount}건 / ${FIFO_REALIZED_LABEL} ${fmtSignedInt(curr.realizedPnl)} / ${FIFO_WIN_RATE_LABEL} ${curr.winRate.toFixed(1)}%`,
      `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  if (topic === "watchonly") {
    const lines = [
      `${title} (${ymd})`,
      "매수 전 관심 추적 종목 목록입니다.",
    ];
    if (qualityLine) lines.push(qualityLine);
    return lines.join("\n");
  }

  const lines = [
    `${title} (${ymd})`,
    `거래 ${curr.tradeCount}건 / ${FIFO_REALIZED_LABEL} ${fmtSignedInt(curr.realizedPnl)} / ${FIFO_WIN_RATE_LABEL} ${curr.winRate.toFixed(1)}%`,
    `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
  ];
  if (qualityLine) lines.push(qualityLine);
  return lines.join("\n");
}