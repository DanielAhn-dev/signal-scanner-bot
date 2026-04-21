import type { PDFFont } from "pdf-lib";
import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import type { TradeWindows, WindowSummary } from "./weeklyReportData";
import {
  C,
  FIFO_REALIZED_LABEL,
  FIFO_TRADE_NOTE,
  FIFO_WIN_RATE_LABEL,
  fmtInt,
  fmtKorMoney,
  fmtPct,
  fmtSignedInt,
  lineDate,
  pnlColor,
  toNum,
  truncate,
} from "./weeklyReportShared";
import {
  drawCommentBlock,
  drawKpiGrid,
  drawPortfolioSummaryRow,
  drawSectionHeader,
  drawTable,
  type KpiCard,
  type ReportRenderContext,
} from "./weeklyReportRenderers";

type WatchItem = {
  code: string;
  name: string;
  qty: number;
  buyPrice: number | null;
  currentPrice: number | null;
  invested: number;
  unrealized: number;
  pnlPct: number | null;
};

type SectorRow = {
  name: string;
  score: number | null;
  change_rate: number | null;
  metrics?: Record<string, unknown> | null;
};

type SectorProfile = {
  aliases: string[];
  description: string;
  representative: string;
};

const SECTOR_PROFILES: SectorProfile[] = [
  { aliases: ["반도체"], description: "메모리·파운드리", representative: "삼성전자" },
  { aliases: ["2차전지", "이차전지", "배터리"], description: "배터리 셀·소재", representative: "LG에너지솔루션" },
  { aliases: ["자동차"], description: "완성차·부품", representative: "현대차" },
  { aliases: ["조선"], description: "LNG·특수선", representative: "HD한국조선해양" },
  { aliases: ["바이오", "헬스케어"], description: "신약·진단", representative: "삼성바이오로직스" },
  { aliases: ["인터넷", "플랫폼"], description: "광고·커머스", representative: "NAVER" },
  { aliases: ["게임"], description: "콘텐츠·퍼블리싱", representative: "크래프톤" },
  { aliases: ["방산"], description: "항공·지상무기", representative: "한화에어로스페이스" },
  { aliases: ["은행"], description: "금리민감 대형금융", representative: "KB금융" },
  { aliases: ["철강"], description: "기초소재·판가", representative: "POSCO홀딩스" },
  { aliases: ["건설"], description: "주택·인프라", representative: "현대건설" },
  { aliases: ["화장품", "미용"], description: "브랜드·수출", representative: "아모레퍼시픽" },
  { aliases: ["유틸리티", "전력"], description: "전기·가스", representative: "한국전력" },
];

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, options: string[]): string {
  if (options.length === 0) return "";
  return options[hashSeed(seed) % options.length];
}

function getSectorProfile(name: string): { description: string; representative: string } {
  const found = SECTOR_PROFILES.find((profile) =>
    profile.aliases.some((alias) => name.includes(alias))
  );
  if (!found) return { description: "업종 순환 민감", representative: "대표주 확인" };
  return { description: found.description, representative: found.representative };
}

function formatSectorInfoCell(name: string): string {
  const { description, representative } = getSectorProfile(name);
  return truncate(`${name} · ${description} · 대표 ${representative}`, 36);
}

export function drawMarketOverviewSection(
  ctx: ReportRenderContext,
  ymd: string,
  market: Awaited<ReturnType<typeof fetchReportMarketData>>,
  sectors: SectorRow[]
) {
  drawSectionHeader(ctx, "시장 개요", `기준: ${ymd}`);

  const cards: KpiCard[] = [];
  if (market.kospi) {
    cards.push({
      label: "KOSPI",
      value: fmtInt(toNum(market.kospi.price)),
      sub: fmtPct(toNum(market.kospi.changeRate)),
      valueColor: pnlColor(toNum(market.kospi.changeRate)),
    });
  }
  if (market.kosdaq) {
    cards.push({
      label: "KOSDAQ",
      value: fmtInt(toNum(market.kosdaq.price)),
      sub: fmtPct(toNum(market.kosdaq.changeRate)),
      valueColor: pnlColor(toNum(market.kosdaq.changeRate)),
    });
  }
  if (market.usdkrw) {
    cards.push({
      label: "USD/KRW",
      value: `${fmtInt(toNum(market.usdkrw.price))}원`,
      sub: fmtPct(toNum(market.usdkrw.changeRate)),
      valueColor: C.text,
    });
  }
  if (market.vix) {
    const vixVal = toNum(market.vix.price);
    cards.push({
      label: "VIX (공포지수)",
      value: vixVal.toFixed(1),
      sub: vixVal >= 30 ? "고공포" : vixVal >= 20 ? "주의" : "안정",
      valueColor: vixVal >= 30 ? C.up : C.text,
    });
  }
  if (market.fearGreed) {
    cards.push({
      label: "공포·탐욕",
      value: String(toNum(market.fearGreed.score)),
      sub: market.fearGreed.rating ?? "",
      valueColor: C.text,
    });
  }
  if (market.us10y) {
    cards.push({
      label: "미국 10년물",
      value: `${toNum(market.us10y.price).toFixed(2)}%`,
      sub: fmtPct(toNum(market.us10y.changeRate)),
      valueColor: pnlColor(toNum(market.us10y.changeRate)),
    });
  }
  if (market.sp500) {
    cards.push({
      label: "S&P 500",
      value: fmtInt(toNum(market.sp500.price)),
      sub: fmtPct(toNum(market.sp500.changeRate)),
      valueColor: pnlColor(toNum(market.sp500.changeRate)),
    });
  }
  if (market.nasdaq) {
    cards.push({
      label: "NASDAQ",
      value: fmtInt(toNum(market.nasdaq.price)),
      sub: fmtPct(toNum(market.nasdaq.changeRate)),
      valueColor: pnlColor(toNum(market.nasdaq.changeRate)),
    });
  }

  while (cards.length % 4 !== 0) cards.push({ label: "", value: "" });
  if (cards.length > 0) drawKpiGrid(ctx, cards, 4);

  if (sectors.length > 0) {
    ctx.y -= 4;
    drawSectionHeader(ctx, "주도 섹터 Top 3", `기준: ${ymd}`);
    drawTable(
      ctx,
      [
        { header: "순위", width: 40, align: "center" },
        { header: "섹터명", width: 200 },
        { header: "점수", width: 70, align: "right" },
        { header: "수익률", width: 80, align: "right" },
        { header: "상태", width: 117, align: "center" },
      ],
      sectors.map((sector, index) => {
        const rate = toNum(sector.change_rate);
        return [
          String(index + 1),
          sector.name,
          toNum(sector.score).toFixed(1),
          fmtPct(rate),
          rate >= 1 ? "강세" : rate >= 0 ? "보합" : "약세",
        ];
      }),
      sectors.map((sector) => pnlColor(toNum(sector.change_rate)))
    );
  }
}

export function drawPortfolioSection(
  ctx: ReportRenderContext,
  totalInvested: number,
  totalValue: number,
  totalUnrealized: number,
  totalUnrealizedPct: number,
  watchItems: WatchItem[],
  curr: WindowSummary,
  prev: WindowSummary
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "포트폴리오 요약");
  const cards: KpiCard[] = [
    { label: "총 원금", value: `${fmtInt(totalInvested)}원`, valueColor: C.text },
    { label: "평가금액", value: `${fmtInt(totalValue)}원`, valueColor: C.text },
    { label: "평가손익", value: fmtSignedInt(totalUnrealized), sub: fmtPct(totalUnrealizedPct), valueColor: pnlColor(totalUnrealized) },
    { label: "보유 종목수", value: `${watchItems.length}개`, valueColor: C.text },
    { label: "거래 (최근 2주)", value: `${curr.tradeCount}건`, sub: `매수 ${curr.buyCount} / 매도 ${curr.sellCount}`, valueColor: C.text },
    { label: `${FIFO_REALIZED_LABEL} (2주)`, value: fmtSignedInt(curr.realizedPnl), valueColor: pnlColor(curr.realizedPnl) },
    {
      label: `${FIFO_WIN_RATE_LABEL} (2주)`,
      value: `${curr.winRate.toFixed(1)}%`,
      sub:
        curr.sellCount > 0
          ? `${curr.sellCount}건 매도 · 손익비 ${curr.payoffRatio != null ? `${curr.payoffRatio.toFixed(2)}:1` : "집계불가"}`
          : "매도 없음",
      valueColor: curr.winRate >= 50 ? C.up : C.down,
    },
    { label: "이전 2주 대비", value: fmtSignedInt(curr.realizedPnl - prev.realizedPnl), sub: `${FIFO_REALIZED_LABEL} 증감`, valueColor: pnlColor(curr.realizedPnl - prev.realizedPnl) },
  ];
  drawKpiGrid(ctx, cards, 4);
}

export function drawTradesSection(ctx: ReportRenderContext, windows: TradeWindows) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "매매 기록 및 성과 분석", FIFO_TRADE_NOTE);

  if (windows.recent.length > 0) {
    drawTable(
      ctx,
      [
        { header: "일자", width: 56, align: "center" },
        { header: "구분", width: 40, align: "center" },
        { header: "종목", width: 112, align: "left" },
        { header: "수량", width: 44, align: "right" },
        { header: "단가 (원)", width: 82, align: "right" },
        { header: "금액 (원)", width: 82, align: "right" },
        { header: FIFO_REALIZED_LABEL, width: 105, align: "right" },
      ],
      windows.recent.map((row) => {
        const qty = Math.max(0, Math.floor(toNum(row.quantity)));
        const price = toNum(row.price);
        const pnl = row.side === "SELL" ? fmtSignedInt(toNum(row.pnl_amount)) : "-";
        const sideLabel = row.side === "BUY" ? "매수" : row.side === "SELL" ? "매도" : "수정";
        const displayName = row.name && row.name !== row.code
          ? `${truncate(row.name, 8)} ${row.code}`
          : row.code;
        return [
          lineDate(row.traded_at),
          sideLabel,
          displayName,
          `${qty}주`,
          fmtInt(price),
          fmtInt(price * qty),
          pnl,
        ];
      }),
      windows.recent.map((row) =>
        row.side === "SELL" ? pnlColor(toNum(row.pnl_amount)) : row.side === "BUY" ? C.down : C.text
      )
    );
  } else {
    ctx.y -= 4;
    ctx.text("최근 2주 거래 기록이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
  }
}

export function drawWatchlistSection(
  ctx: ReportRenderContext,
  watchItems: WatchItem[],
  totalInvested: number,
  totalUnrealized: number,
  totalUnrealizedPct: number
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "보유 종목 상세", `총 ${watchItems.length}개 종목`);

  if (watchItems.length > 0) {
    drawTable(
      ctx,
      [
        { header: "종목명", width: 112, align: "left" },
        { header: "코드", width: 54, align: "center" },
        { header: "수량", width: 46, align: "right" },
        { header: "평균단가", width: 78, align: "right" },
        { header: "현재가", width: 78, align: "right" },
        { header: "평가손익", width: 80, align: "right" },
        { header: "수익률", width: 59, align: "right" },
      ],
      watchItems.slice(0, 20).map((item) => [
        truncate(item.name, 10),
        item.code,
        `${item.qty}주`,
        item.buyPrice ? fmtInt(item.buyPrice) : "-",
        item.currentPrice ? fmtInt(item.currentPrice) : "-",
        item.invested > 0 ? fmtSignedInt(item.unrealized) : "-",
        item.pnlPct != null ? fmtPct(item.pnlPct) : "-",
      ]),
      watchItems.slice(0, 20).map((item) => pnlColor(item.unrealized))
    );

    drawPortfolioSummaryRow(
      ctx,
      "합계",
      `원금 ${fmtInt(totalInvested)}원`,
      `평가손익 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})`,
      pnlColor(totalUnrealized)
    );
  } else {
    ctx.y -= 8;
    ctx.text("등록된 보유 종목이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
  }
}

export function drawCommentarySection(
  ctx: ReportRenderContext,
  font: PDFFont,
  curr: WindowSummary,
  prev: WindowSummary,
  totalUnrealized: number,
  totalUnrealizedPct: number,
  watchItems: WatchItem[],
  sectors: SectorRow[],
  wrapText: (text: string, maxWidth: number, font: PDFFont, size: number) => string[]
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "주간 코멘트 및 대응 전략");

  const seedBase = `${curr.tradeCount}|${prev.tradeCount}|${curr.winRate.toFixed(1)}|${totalUnrealized.toFixed(0)}|${watchItems.length}`;

  const tradeMom =
    curr.tradeCount > prev.tradeCount
      ? pickVariant(`${seedBase}|trade|up`, [
          `이번 주 거래 횟수(${curr.tradeCount}건)가 이전 주(${prev.tradeCount}건)보다 늘었습니다. 진입이 많아진 구간이므로 종목당 손실 한도를 먼저 고정해 두세요.`,
          `거래 빈도가 ${prev.tradeCount}건에서 ${curr.tradeCount}건으로 증가했습니다. 기회 포착 구간이지만 포지션 크기는 평소보다 보수적으로 운영하는 편이 좋습니다.`,
          `이번 주는 거래가 활발했습니다(${curr.tradeCount}건). 신규 진입 전 손절·목표가를 먼저 입력해 리듬을 지키는 대응이 유효합니다.`,
        ])
      : curr.tradeCount < prev.tradeCount
        ? pickVariant(`${seedBase}|trade|down`, [
            `이번 주 거래 횟수(${curr.tradeCount}건)가 이전 주(${prev.tradeCount}건)보다 줄었습니다. 관망 비중이 높아진 만큼 확실한 신호 위주로만 대응하세요.`,
            `거래 빈도가 둔화됐습니다(${prev.tradeCount}건→${curr.tradeCount}건). 무리한 추격보다 체크리스트를 충족한 종목만 선별하는 흐름이 적절합니다.`,
            `진입 횟수가 감소했습니다. 시장 확인 구간으로 보고, 진입 조건이 맞는 종목만 소수로 압축하는 전략이 안정적입니다.`,
          ])
        : pickVariant(`${seedBase}|trade|flat`, [
            "이번 주 거래 횟수는 이전 주와 유사합니다. 현재 페이스를 유지하면서 손익비가 좋은 구간만 선택하세요.",
            "거래 빈도가 전주와 동일해 리듬은 안정적입니다. 동일한 규칙을 유지하되 변동성 확대 구간만 별도 경계하면 됩니다.",
            "매매 건수는 큰 변화가 없습니다. 기존 진입 규칙을 유지하며 포지션 간 상관도를 함께 점검해 주세요.",
          ]);

  drawCommentBlock(ctx, "매매 활동", tradeMom, C.navyLight, font, wrapText);

  const winNote =
    curr.winRate >= prev.winRate
      ? pickVariant(`${seedBase}|win|up`, [
          `${FIFO_WIN_RATE_LABEL}이 ${prev.winRate.toFixed(1)}%에서 ${curr.winRate.toFixed(1)}%로 개선됐습니다. 이익 실현 기준을 유지하고, 수익 구간에서는 분할 익절을 우선하세요.`,
          `${FIFO_WIN_RATE_LABEL}이 상승했습니다(${prev.winRate.toFixed(1)}%→${curr.winRate.toFixed(1)}%). 현재 매도 리듬이 유효하므로 강한 종목은 추세를 조금 더 보유해도 됩니다.`,
          `${FIFO_WIN_RATE_LABEL} 개선 흐름입니다. 손익비가 좋은 매매를 유지하되, 급등 종목은 목표가 도달 시 일부 차익 실현을 권장합니다.`,
        ])
      : pickVariant(`${seedBase}|win|down`, [
          `${FIFO_WIN_RATE_LABEL}이 ${prev.winRate.toFixed(1)}%에서 ${curr.winRate.toFixed(1)}%로 하락했습니다. 손절 기준과 진입 타이밍을 먼저 좁혀서 재정렬하세요.`,
          `${FIFO_WIN_RATE_LABEL} 둔화가 확인됩니다(${prev.winRate.toFixed(1)}%→${curr.winRate.toFixed(1)}%). 추격 진입을 줄이고 눌림 구간 대응 비중을 높이는 편이 안전합니다.`,
          `${FIFO_WIN_RATE_LABEL}이 낮아졌습니다. 손실 거래의 공통 패턴을 점검하고, 한 번에 투입하는 비중을 한 단계 낮추는 대응이 필요합니다.`,
        ]);
  drawCommentBlock(ctx, `${FIFO_WIN_RATE_LABEL} 분석`, winNote, curr.winRate >= prev.winRate ? C.up : C.down, font, wrapText);

  const pfNote =
    totalUnrealized >= 0
      ? pickVariant(`${seedBase}|pf|plus`, [
          `포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})로 우호적입니다. 수익 구간 종목은 추세 훼손 전까지 분할 관리가 유효합니다.`,
          `현재 보유 평가가 플러스(${fmtSignedInt(totalUnrealized)}, ${fmtPct(totalUnrealizedPct)})를 유지 중입니다. 과열 구간에서 비중을 조금씩 낮춰 변동성 대비를 병행하세요.`,
          `평가손익이 양수 구간입니다(${fmtSignedInt(totalUnrealized)}). 강한 종목 중심으로 압축하되, 신규 진입은 분할 원칙을 유지하세요.`,
        ])
      : pickVariant(`${seedBase}|pf|minus`, [
          `포트폴리오 평가손익은 ${fmtSignedInt(totalUnrealized)} (${fmtPct(totalUnrealizedPct)})로 손실 구간입니다. 손실 상위 종목부터 비중을 재조정하는 대응이 필요합니다.`,
          `미실현 손실 상태(${fmtSignedInt(totalUnrealized)})가 이어집니다. 평균단가 낮추기보다 리스크 큰 종목 정리를 우선하는 편이 안전합니다.`,
          `현재 평가가 음수 구간입니다(${fmtPct(totalUnrealizedPct)}). 종목 수를 줄여 변동성 노출을 낮추고 현금 비중을 일부 확보하세요.`,
        ]);
  drawCommentBlock(ctx, "포트폴리오 평가", pfNote, pnlColor(totalUnrealized), font, wrapText);

  const topLoss = watchItems.filter((item) => (item.pnlPct ?? 0) < -5);
  if (topLoss.length > 0) {
    const names = topLoss.slice(0, 3).map((item) => `${item.name}(${fmtPct(item.pnlPct ?? 0)})`).join(", ");
    drawCommentBlock(
      ctx,
      "손절 재점검 대상",
      pickVariant(`${seedBase}|loss|${topLoss.length}`, [
        `평가손실 -5% 초과 종목: ${names}. 손절 기준일을 다시 맞추고 반등 실패 시 비중 축소를 우선하세요.`,
        `리스크 경고 종목: ${names}. 추가 매수보다 손절·축소 순서를 먼저 정해 대응하는 편이 유리합니다.`,
        `${names}는 손실 방어가 필요한 구간입니다. 대응 기준(보유/축소/정리)을 오늘 안에 확정해 두세요.`,
      ]),
      C.up,
      font,
      wrapText
    );
  }

  const sectorNames = sectors.slice(0, 2).map((sector) => sector.name).join(", ");
  if (sectorNames) {
    drawCommentBlock(
      ctx,
      "주도 섹터 대응",
      pickVariant(`${seedBase}|sector|${sectorNames}`, [
        `이번 주 주도 섹터는 ${sectorNames}입니다. 선도 섹터 내 대표주 위주로 우선순위를 두고 눌림 구간을 노려보세요.`,
        `${sectorNames}가 상대강도를 유지 중입니다. 하위 테마 추격보다 주도 섹터 핵심 종목 중심 대응이 효율적입니다.`,
        `시장 관심은 ${sectorNames}에 집중됩니다. 편입 비중을 늘릴 때는 거래대금 유지 여부를 함께 확인하세요.`,
      ]),
      C.navyLight,
      font,
      wrapText
    );
  }

  drawCommentBlock(
    ctx,
    "유의 사항",
    "본 리포트는 가상 포트폴리오 기준입니다. 실제 거래에는 세금·수수료·유동성 슬리피지를 반영하고, 종목당 손실 한도(-4%~-6%), 포트폴리오 현금 비중(최소 10~20%), 총 포지션 수 상한을 사전에 고정한 뒤 집행하십시오.",
    C.muted,
    font,
    wrapText
  );
}

export function drawFlowSection(ctx: ReportRenderContext, sectors: SectorRow[], sectorStocksMap: Record<string, string[]> = {}) {
  const rows = sectors
    .map((sector) => {
      const metrics = (sector.metrics ?? {}) as Record<string, unknown>;
      const foreignFlow = toNum(metrics.flow_foreign_5d);
      const instFlow = toNum(metrics.flow_inst_5d);
      return {
        name: sector.name,
        info: formatSectorInfoCell(sector.name),
        score: toNum(sector.score),
        foreignFlow,
        instFlow,
        totalFlow: foreignFlow + instFlow,
      };
    })
    .filter((row) => row.totalFlow !== 0)
    .sort((a, b) => Math.abs(b.totalFlow) - Math.abs(a.totalFlow))
    .slice(0, 12);

  drawSectionHeader(ctx, "수급 상위 섹터", "최근 5거래일");

  if (rows.length === 0) {
    ctx.text("수급 집계 데이터가 없습니다.", ctx.ML + 8, ctx.y - 2, 9, C.muted);
    ctx.y -= 22;
    return;
  }

  drawTable(
    ctx,
    [
      { header: "섹터 정보", width: 260 },
      { header: "점수", width: 50, align: "right" },
      { header: "외국인", width: 80, align: "right" },
      { header: "기관", width: 80, align: "right" },
      { header: "합계", width: 90, align: "right" },
    ],
    rows.map((row) => [
      row.info,
      row.score.toFixed(1),
      fmtKorMoney(row.foreignFlow),
      fmtKorMoney(row.instFlow),
      fmtKorMoney(row.totalFlow),
    ]),
    rows.map((row) => pnlColor(row.totalFlow))
  );

  ctx.y -= 4;
  ctx.text(
    "용어 메모: 코스피200 비중상한 20%는 지수 내 한 종목 최대 비중을 20%로 제한한다는 뜻입니다.",
    ctx.ML + 8,
    ctx.y,
    8,
    C.muted
  );
  ctx.y -= 14;

  drawSectorStocksList(ctx, rows.map((r) => ({ name: r.name })), sectorStocksMap);
}

export function drawSectorSection(ctx: ReportRenderContext, sectors: SectorRow[], ymd: string, sectorStocksMap: Record<string, string[]> = {}) {
  drawSectionHeader(ctx, "섹터 강도 랭킹", `기준: ${ymd}`);

  if (sectors.length === 0) {
    ctx.text("섹터 데이터가 없습니다.", ctx.ML + 8, ctx.y - 2, 9, C.muted);
    ctx.y -= 22;
    return;
  }

  drawTable(
    ctx,
    [
      { header: "순위", width: 40, align: "center" },
      { header: "섹터 정보", width: 300 },
      { header: "점수", width: 60, align: "right" },
      { header: "수익률", width: 70, align: "right" },
      { header: "상태", width: 70, align: "center" },
    ],
    sectors.slice(0, 12).map((sector, index) => {
      const rate = toNum(sector.change_rate);
      return [
        String(index + 1),
        formatSectorInfoCell(sector.name),
        toNum(sector.score).toFixed(1),
        fmtPct(rate),
        rate >= 1 ? "강세" : rate >= 0 ? "보합" : "약세",
      ];
    }),
    sectors.slice(0, 12).map((sector) => pnlColor(toNum(sector.change_rate)))
  );

  ctx.y -= 4;
  ctx.text(
    "해석 팁: 섹터 정보는 업종 성격과 대표 종목을 함께 표시해 초보자도 맥락을 빠르게 파악할 수 있게 구성했습니다.",
    ctx.ML + 8,
    ctx.y,
    8,
    C.muted
  );
  ctx.y -= 14;

  drawSectorStocksList(ctx, sectors.slice(0, 12), sectorStocksMap);
}

export function drawEconomySection(
  ctx: ReportRenderContext,
  font: PDFFont,
  market: Awaited<ReturnType<typeof fetchAllMarketData>>,
  ymd: string,
  wrapText: (text: string, maxWidth: number, font: PDFFont, size: number) => string[]
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "거시 환경 요약", `기준: ${ymd}`);
  ctx.y -= 6;

  const cards: KpiCard[] = [];
  if (market.kospi) cards.push({ label: "KOSPI", value: fmtInt(toNum(market.kospi.price)), sub: fmtPct(toNum(market.kospi.changeRate)), valueColor: pnlColor(toNum(market.kospi.changeRate)) });
  if (market.kosdaq) cards.push({ label: "KOSDAQ", value: fmtInt(toNum(market.kosdaq.price)), sub: fmtPct(toNum(market.kosdaq.changeRate)), valueColor: pnlColor(toNum(market.kosdaq.changeRate)) });
  if (market.sp500) cards.push({ label: "S&P 500", value: fmtInt(toNum(market.sp500.price)), sub: fmtPct(toNum(market.sp500.changeRate)), valueColor: pnlColor(toNum(market.sp500.changeRate)) });
  if (market.nasdaq) cards.push({ label: "NASDAQ", value: fmtInt(toNum(market.nasdaq.price)), sub: fmtPct(toNum(market.nasdaq.changeRate)), valueColor: pnlColor(toNum(market.nasdaq.changeRate)) });
  if (market.usdkrw) cards.push({ label: "USD/KRW", value: `${fmtInt(toNum(market.usdkrw.price))}원`, sub: fmtPct(toNum(market.usdkrw.changeRate)), valueColor: C.text });
  if (market.us10y) cards.push({ label: "미국 10년물", value: `${toNum(market.us10y.price).toFixed(2)}%`, sub: fmtPct(toNum(market.us10y.changeRate)), valueColor: pnlColor(toNum(market.us10y.changeRate)) });
  if (market.vix) cards.push({ label: "VIX", value: toNum(market.vix.price).toFixed(2), sub: toNum(market.vix.price) >= 30 ? "고위험" : toNum(market.vix.price) >= 20 ? "주의" : "안정", valueColor: toNum(market.vix.price) >= 30 ? C.up : C.text });
  if (market.fearGreed) cards.push({ label: "공포·탐욕", value: String(toNum(market.fearGreed.score)), sub: market.fearGreed.rating ?? "", valueColor: C.text });
  if (market.gold) cards.push({ label: "금 Gold", value: `$${fmtInt(Math.round(toNum(market.gold.price)))}`, sub: fmtPct(toNum(market.gold.changeRate)), valueColor: pnlColor(toNum(market.gold.changeRate)) });
  if (market.wtiOil) cards.push({ label: "WTI 원유", value: `$${toNum(market.wtiOil.price).toFixed(1)}`, sub: fmtPct(toNum(market.wtiOil.changeRate)), valueColor: pnlColor(toNum(market.wtiOil.changeRate)) });
  if (market.copper) cards.push({ label: "구리 Copper", value: `$${toNum(market.copper.price).toFixed(2)}`, sub: fmtPct(toNum(market.copper.changeRate)), valueColor: pnlColor(toNum(market.copper.changeRate)) });
  if (market.silver) cards.push({ label: "은 Silver", value: `$${toNum(market.silver.price).toFixed(2)}`, sub: fmtPct(toNum(market.silver.changeRate)), valueColor: pnlColor(toNum(market.silver.changeRate)) });

  while (cards.length % 4 !== 0) cards.push({ label: "", value: "" });
  if (cards.length > 0) drawKpiGrid(ctx, cards, 4);
  ctx.y -= 10;

  const vixVal = market.vix ? toNum(market.vix.price) : 0;
  const fgVal = market.fearGreed ? toNum(market.fearGreed.score) : 50;
  const us10yVal = market.us10y ? toNum(market.us10y.price) : 0;
  const usdkrwVal = market.usdkrw ? toNum(market.usdkrw.price) : 0;
  const wtiVal = market.wtiOil ? toNum(market.wtiOil.price) : 0;
  const goldVal = market.gold ? toNum(market.gold.price) : 0;
  const copperVal = market.copper ? toNum(market.copper.price) : 0;

  const comments: string[] = [];
  if (vixVal >= 30) comments.push(`VIX ${vixVal.toFixed(1)}로 변동성 위험 수준입니다. 옵션 헤지 비용이 높아진 구간으로 신규 진입 시 포지션 규모를 평소의 50~70% 이하로 제한하는 것이 좋습니다.`);
  else if (vixVal >= 20) comments.push(`VIX ${vixVal.toFixed(1)}로 경계 구간에 진입했습니다. 단기 급등락 가능성을 열어두고 손절·목표가 기준을 사전에 정해 두는 대응이 필요합니다.`);
  if (fgVal <= 20) comments.push(`공포·탐욕 지수 ${fgVal}로 극단적 공포 구간입니다. 과거 사례상 이 구간은 중기 저점 형성 가능성이 높아 분할 매수를 고려할 만합니다.`);
  else if (fgVal <= 30) comments.push(`공포·탐욕 지수 ${fgVal}로 공포 심리가 우세합니다. 낙폭 과대 우량주의 기술적 반등 대응이 유효할 수 있습니다.`);
  else if (fgVal >= 75) comments.push(`공포·탐욕 지수 ${fgVal}로 탐욕 구간이 과열 중입니다. 추격 매수보다 보유 종목 수익 실현과 포지션 비중 조절을 우선 검토하세요.`);
  if (us10yVal >= 5) comments.push(`미국 10년물 금리가 ${us10yVal.toFixed(2)}%로 부담 수준입니다. 높은 할인율은 성장주·기술주 밸류에이션 압박 요인으로 작용하며, 금융·에너지 등 가치주 상대 강세가 지속될 가능성이 있습니다.`);
  else if (us10yVal >= 4.5) comments.push(`미국 10년물 금리 ${us10yVal.toFixed(2)}%는 중립~경계 구간입니다. 금리 방향성과 연준 발언을 주시하며 성장주 비중을 조율하는 전략이 적절합니다.`);
  if (usdkrwVal >= 1400) comments.push(`원·달러가 ${fmtInt(usdkrwVal)}원으로 약세입니다. 외국인 환차익 메리트 감소로 코스피 수급 이탈 압력이 높아질 수 있으며, 수출주보다 내수·방어주 비중 확대가 유리할 수 있습니다.`);
  if (wtiVal >= 90) comments.push(`WTI 유가 $${wtiVal.toFixed(1)}로 공급 비용 부담이 높습니다. 항공·운송·화학 등 원가 민감 업종에 불리하며 정유·에너지 섹터의 영업이익 확대 수혜를 참고하세요.`);
  if (goldVal >= 2500) comments.push(`금 $${fmtInt(Math.round(goldVal))}로 안전자산 선호가 강합니다. 인플레이션 헤지 수요와 지정학적 불확실성이 복합적으로 작용 중이며, 포트폴리오 내 금·달러 방어 자산 비중을 점검할 필요가 있습니다.`);
  if (copperVal <= 3.5) comments.push(`구리 $${copperVal.toFixed(2)}로 경기 선행 신호가 약화됐습니다. 건설·인프라 수요 감소 우려가 내포된 신호로, 산업재 및 소재 섹터 비중 축소를 검토할 만합니다.`);

  const defaultComment = [
    `현재 핵심 거시 변수는 전반적으로 중립 범위에 위치합니다.`,
    `VIX ${vixVal.toFixed(1)}, 공포·탐욕 ${fgVal}, 미국 10년물 ${us10yVal.toFixed(2)}% 모두 과열·위기 임계치를 벗어나 있어 단기 시스템 리스크는 제한적입니다.`,
    `다만 금리·환율 방향성이 바뀌는 시점에서 노출 포지션을 신속하게 재조정할 수 있도록 손절·비중 기준을 사전 설정해 두는 것을 권장합니다.`,
  ].join(" ");

  drawCommentBlock(ctx, "거시 해석", comments.join(" ") || defaultComment, C.navyLight, font, wrapText, false);
  ctx.y -= 10;
}

/**
 * 섹터별 구성 종목 목록을 compact하게 표시한다.
 * sectorStocksMap이 비어 있으면 아무것도 표시하지 않는다.
 */
function drawSectorStocksList(
  ctx: ReportRenderContext,
  sectors: { name: string }[],
  sectorStocksMap: Record<string, string[]>
) {
  const entries = sectors
    .map((s) => ({ name: s.name, stocks: sectorStocksMap[s.name] ?? [] }))
    .filter((e) => e.stocks.length > 0);

  if (entries.length === 0) return;

  ctx.y -= 6;
  drawSectionHeader(ctx, "섹터별 주요 종목", "유동성 상위 기준");

  const labelFontSize = 8.5;
  const stockFontSize = 8.5;
  const lineH = Math.round(stockFontSize * 1.45);
  const labelX = ctx.ML + 8;
  const maxLabelW = Math.min(160, Math.max(76, ctx.BODY_W * 0.28));
  const measuredLabelW = entries.reduce(
    (maxWidth, entry) => Math.max(maxWidth, ctx.font.widthOfTextAtSize(entry.name, labelFontSize)),
    0
  );
  const labelColumnW = Math.min(maxLabelW, Math.max(76, measuredLabelW + 18));
  const stockX = labelX + labelColumnW;
  const stockMaxW = Math.max(120, ctx.ML + ctx.BODY_W - stockX - 8);

  for (const entry of entries) {
    const label = `${entry.name}`;
    const stockStr = entry.stocks.join("  ·  ");
    ctx.ensureSpace(lineH + 8);
    const labelLines = ctx.text(label, labelX, ctx.y, labelFontSize, C.navyLight, labelColumnW - 8);
    const stockLines = ctx.text(stockStr, stockX, ctx.y, stockFontSize, C.ink, stockMaxW);
    ctx.y -= Math.max(labelLines, stockLines) * lineH + 4;
  }
  ctx.y -= 6;
}

/**
 * 관심종목(qty=0, 추적 전용) 목록을 표시한다.
 */
export function drawWatchOnlySection(ctx: ReportRenderContext, watchOnlyItems: WatchItem[]) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "관심 종목 목록", `총 ${watchOnlyItems.length}개`);

  if (watchOnlyItems.length === 0) {
    ctx.y -= 8;
    ctx.text("등록된 관심 종목이 없습니다.", ctx.ML + 8, ctx.y, 9, C.muted);
    ctx.y -= 20;
    return;
  }

  drawTable(
    ctx,
    [
      { header: "종목명", width: 160, align: "left" },
      { header: "코드", width: 70, align: "center" },
      { header: "기준가 (원)", width: 110, align: "right" },
      { header: "현재가 (원)", width: 110, align: "right" },
      { header: "등락", width: 107, align: "right" },
    ],
    watchOnlyItems.slice(0, 30).map((item) => [
      truncate(item.name, 13),
      item.code,
      item.buyPrice ? fmtInt(item.buyPrice) : "-",
      item.currentPrice ? fmtInt(item.currentPrice) : "-",
      item.pnlPct != null ? fmtPct(item.pnlPct) : "-",
    ]),
    watchOnlyItems.slice(0, 30).map((item) => pnlColor(item.pnlPct ?? 0))
  );

  ctx.y -= 6;
  ctx.text(
    "기준가: 종목 등록 시 입력한 참고 가격입니다. 매수 여부와 무관하게 관심 목적으로만 추적 중인 종목입니다.",
    ctx.ML + 8,
    ctx.y,
    8,
    C.muted
  );
  ctx.y -= 14;
}

// ─── 판단 신뢰도 섹션 ──────────────────────────────────────────────────────

export type DecisionReliabilityForSection = {
  windowDays: number;
  totalDecisions: number;
  executedDecisions: number;
  explanationCoveragePct: number;
  averageConfidencePct: number | null;
  linkedSellCount: number;
  linkedSellWinRatePct: number | null;
  linkedRealizedPnl: number;
  strategyVersionCount: number;
  trustScore: number | null;
};

/**
 * 의사결정 신뢰도 요약 섹션을 PDF에 렌더링한다.
 * portfolio / weekly 토픽에서 포트폴리오 요약 이후 노출한다.
 */
export function drawDecisionLogSection(
  ctx: ReportRenderContext,
  reliability: DecisionReliabilityForSection
) {
  ctx.y -= 6;
  drawSectionHeader(ctx, "판단 신뢰도 분석", `최근 ${reliability.windowDays}일 기준`);

  if (reliability.totalDecisions === 0) {
    ctx.y -= 8;
    ctx.text(
      "의사결정 기록이 없습니다. 가상매수·가상매도 후 결정 로그가 자동으로 쌓입니다.",
      ctx.ML + 8,
      ctx.y,
      9,
      C.muted
    );
    ctx.y -= 20;
    return;
  }

  const trustColor =
    reliability.trustScore == null
      ? C.text
      : reliability.trustScore >= 70
        ? C.up
        : reliability.trustScore >= 40
          ? C.text
          : C.down;

  const cards: KpiCard[] = [
    {
      label: "판단 신뢰점수",
      value: reliability.trustScore != null ? `${reliability.trustScore}점` : "계산중",
      sub: "신뢰도 · 근거 · 승률 복합",
      valueColor: trustColor,
    },
    {
      label: "총 의사결정",
      value: `${reliability.totalDecisions}건`,
      sub: `실행 ${reliability.executedDecisions}건`,
      valueColor: C.text,
    },
    {
      label: "근거 기록률",
      value: `${reliability.explanationCoveragePct.toFixed(1)}%`,
      sub: "reason_summary 입력 비율",
      valueColor: reliability.explanationCoveragePct >= 80 ? C.up : C.text,
    },
    {
      label: "평균 신뢰도",
      value:
        reliability.averageConfidencePct != null
          ? `${reliability.averageConfidencePct.toFixed(1)}%`
          : "-",
      sub: "confidence 평균",
      valueColor: C.text,
    },
  ];

  if (reliability.linkedSellCount > 0) {
    cards.push({
      label: "연결 매도 승률",
      value:
        reliability.linkedSellWinRatePct != null
          ? `${reliability.linkedSellWinRatePct.toFixed(1)}%`
          : "집계중",
      sub: `${reliability.linkedSellCount}건 매도 연결`,
      valueColor:
        reliability.linkedSellWinRatePct != null
          ? pnlColor(reliability.linkedSellWinRatePct - 50)
          : C.text,
    });
    cards.push({
      label: "연결 실현손익",
      value: fmtSignedInt(reliability.linkedRealizedPnl),
      sub: "결정 연결 매도 합산",
      valueColor: pnlColor(reliability.linkedRealizedPnl),
    });
  }

  if (reliability.strategyVersionCount > 0) {
    cards.push({
      label: "전략 버전 수",
      value: `${reliability.strategyVersionCount}개`,
      sub: "사용된 전략 버전",
      valueColor: C.text,
    });
  }

  while (cards.length % 4 !== 0) cards.push({ label: "", value: "" });
  drawKpiGrid(ctx, cards, 4);

  ctx.y -= 4;
  ctx.text(
    "판단 신뢰점수 = 평균 신뢰도(30%) + 근거 기록률(30%) + 연결 매도 승률(40%) 복합 지수입니다.",
    ctx.ML + 8,
    ctx.y,
    8,
    C.muted
  );
  ctx.y -= 14;
}