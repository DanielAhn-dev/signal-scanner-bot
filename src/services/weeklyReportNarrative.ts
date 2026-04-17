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

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const fearGreed = toNum((market as any).fearGreed?.score);
    const vixLabel = vix >= 30 ? "고변동성" : vix >= 20 ? "경계" : "안정";
    const sentimentLabel = fearGreed <= 25 ? "공포" : fearGreed >= 75 ? "탐욕" : "중립";
    if (vix > 0 || usdkrw > 0 || fearGreed > 0) {
      return `VIX ${vix > 0 ? vix.toFixed(1) : "-"}, 환율 ${usdkrw > 0 ? fmtInt(usdkrw) + "원" : "-"}, 심리 ${sentimentLabel} 구간으로 현재 시장 체온은 ${vixLabel}에 가깝습니다.`;
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
      return `${top.name} 섹터에 최근 5거래일 기준 ${fmtKorMoney(top.totalFlow)} 규모의 순유입이 관측돼 자금 집중도가 가장 높습니다.`;
    }
  }

  if (topic === "sector") {
    const top = sectors[0];
    if (top) {
      return `${top.name}가 점수 ${toNum(top.score).toFixed(1)}점, 수익률 ${fmtPct(toNum(top.change_rate))}로 현재 강도 1위를 기록하고 있습니다.`;
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

  if (topic === "economy") {
    const vix = toNum((market as any).vix?.price);
    const us10y = toNum((market as any).us10y?.price);
    const fg = toNum((market as any).fearGreed?.score ?? 50);
    const usdkrw = toNum((market as any).usdkrw?.price);
    const gold = toNum((market as any).gold?.price);
    if (vix >= 30) {
      return `VIX ${vix.toFixed(1)} · 미국 10년물 ${us10y.toFixed(2)}% 구간으로 시장 변동성이 위험 수준에 도달했습니다. 신규 매수는 분할 진입 원칙을 철저히 지키고, 포트폴리오 내 현금 비중을 20% 이상으로 유지하며 손절 라인을 사전에 설정하는 대응이 필요합니다.`;
    }
    if (vix >= 20 || us10y >= 5) {
      return `변동성(VIX ${vix.toFixed(1)})과 금리(미국 10년물 ${us10y.toFixed(2)}%) 가운데 하나 이상이 경계 수준입니다. 공격적 비중 확대보다는 주도 섹터 중심 선별 매수를 유지하고, 금리 방향 전환 신호가 나올 때까지 포지션 규모를 제한하는 것이 안전합니다.`;
    }
    if (fg >= 75) {
      return `공포·탐욕 지수 ${fg}로 시장 과열 신호가 나오고 있습니다. 추격 매수보다 수익 실현과 비중 조정 타이밍을 점검하세요. 조정 발생 시 재진입 계획을 미리 세워두는 것이 효과적입니다.`;
    }
    if (usdkrw >= 1400 && gold >= 2500) {
      return `원화 약세(${fmtInt(usdkrw)}원)와 금 강세($${fmtInt(Math.round(gold))})가 동시에 나타나 안전자산 선호도가 높아진 구간입니다. 국내 증시 외국인 수급 변동성을 주시하며 방어적 비중을 유지하세요.`;
    }
    return `현재 거시 지표는 전반적으로 안정 범위에 위치합니다. VIX ${vix.toFixed(1)}, 미국 10년물 ${us10y.toFixed(2)}%, 공포·탐욕 ${fg} 모두 과열·위기 임계치를 벗어나 있습니다. 시장 방향 확인 후 주도 업종·섹터 중심으로 비중을 점진적으로 늘리는 전략이 유효하며, 단기 모멘텀과 거래량 추이를 함께 모니터링하세요.`;
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
      ? `${top.name} 중심 자금 유입이 이어지는 동안은 역행 섹터보다 선도 섹터 눌림목 대응이 유리합니다.`
      : "뚜렷한 자금 집중 섹터가 약해 시장 순환매 속도가 빠를 수 있습니다. 추격 매수보다 확인 매수가 적절합니다.";
  }

  if (topic === "sector") {
    const leader = sectors[0]?.name;
    return leader
      ? `현재 1등 섹터인 ${leader}의 강도가 꺾이기 전까지는 하위 테마보다 선도 테마 대표 종목이 상대적으로 유리합니다.`
      : "섹터 강도 데이터가 약해 주도 테마 확신이 낮습니다. 시장 방향 확인 후 종목별 접근이 낫습니다.";
  }

  if (topic === "watchlist") {
    const losers = watchItems.filter((item) => (item.pnlPct ?? 0) < -5).length;
    return losers > 0
      ? `평가손실 -5% 초과 종목이 ${losers}개 있어 방어 우선 구간입니다. 비중과 손절 기준을 먼저 정리하는 편이 좋습니다.`
      : `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)}) 기준으로 급한 방어 이슈는 크지 않습니다. 강한 종목 위주 압축이 유효합니다.`;
  }

  return curr.realizedPnl >= prev.realizedPnl
    ? "최근 실현손익(FIFO) 흐름이 이전 구간보다 개선됐습니다. 주도 섹터와 현재 보유 포지션을 함께 관리하는 현재 전략을 유지할 만합니다."
    : "최근 실현손익(FIFO) 흐름이 둔화됐습니다. 보유 종목 점검과 함께 진입 빈도를 한 단계 낮춰 리듬을 조절하는 편이 낫습니다.";
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

  const lines = [
    `${title} (${ymd})`,
    `거래 ${curr.tradeCount}건 / ${FIFO_REALIZED_LABEL} ${fmtSignedInt(curr.realizedPnl)} / ${FIFO_WIN_RATE_LABEL} ${curr.winRate.toFixed(1)}%`,
    `보유평가 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
  ];
  if (qualityLine) lines.push(qualityLine);
  return lines.join("\n");
}