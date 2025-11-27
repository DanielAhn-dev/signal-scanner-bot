import type { SupabaseClient } from "@supabase/supabase-js";

// JSONB용 느슨한 타입
type Json = Record<string, any>;
type BriefingType = "pre_market" | "market_close";

// DB Row 타입 정의
interface SectorRow {
  id: string;
  name: string;
  score: number | null;
  change_rate: number | null;
  avg_change_rate: number | null;
  metrics: Json | null;
}

interface StockRow {
  code: string;
  name: string;
  sector_id: string | null;
  close: number | null;
  liquidity: number | null;
  avg_volume_20d: number | null;
  rsi14: number | null;
  is_sector_leader: boolean | null;
  universe_level: string | null;
  is_active?: boolean | null;
}

interface ScoreRow {
  code: string;
  total_score: number | null;
  momentum_score: number | null;
  liquidity_score: number | null;
  value_score: number | null;
  factors: Json;
  asof?: string;
}

// ===== 메인 브리핑 함수 =====
export async function createBriefingReport(
  supabase: SupabaseClient,
  type: BriefingType = "pre_market"
): Promise<string> {
  // 0. 기준일 잡기: sector_daily 마지막 날짜
  const { data: sectorDateRows, error: sectorDateError } = await supabase
    .from("sector_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);

  if (sectorDateError) {
    throw new Error(`Sector date fetch failed: ${sectorDateError.message}`);
  }
  if (!sectorDateRows || sectorDateRows.length === 0) {
    throw new Error(
      "sector_daily에 데이터가 없어 브리핑 기준일을 정할 수 없습니다."
    );
  }

  const asOf = sectorDateRows[0].date as string;

  // 1. 주도 섹터 Top 3
  const { data: topSectors, error: sectorError } = await supabase
    .from("sectors")
    .select("id, name, avg_change_rate, change_rate, score, metrics")
    .order("score", { ascending: false })
    .limit(3)
    .returns<SectorRow[]>();

  if (sectorError) {
    throw new Error(`Sector fetch failed: ${sectorError.message}`);
  }
  if (!topSectors || topSectors.length === 0) {
    throw new Error("sectors 테이블에 데이터가 없습니다.");
  }

  const topSectorIds = topSectors.map((s) => s.id);

  // 2. 점수 기준일(asof)
  const { data: scoreDateRows, error: scoreDateError } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);

  if (scoreDateError) {
    throw new Error(`Score date fetch failed: ${scoreDateError.message}`);
  }
  const scoreAsOf = scoreDateRows?.[0]?.asof ?? asOf;

  // 3. 상위 섹터에 속한 종목들
  const { data: sectorStocks, error: stockError } = await supabase
    .from("stocks")
    .select(
      [
        "code",
        "name",
        "sector_id",
        "close",
        "liquidity",
        "avg_volume_20d",
        "rsi14",
        "is_sector_leader",
        "universe_level",
      ].join(", ")
    )
    .in("sector_id", topSectorIds)
    .eq("is_active", true)
    .order("is_sector_leader", { ascending: false })
    .order("liquidity", { ascending: false })
    .limit(80)
    .returns<StockRow[]>();

  if (stockError) {
    throw new Error(`Stock fetch failed: ${stockError.message}`);
  }

  const sectorStockCodes = (sectorStocks ?? []).map((s) => s.code);

  // 4. 위 종목들에 대한 score 정보
  const scoresByCode = await fetchScoresByCodes(
    supabase,
    sectorStockCodes,
    scoreAsOf
  );

  // 5. '밑에서' 턴어라운드 후보
  const bottomCandidates = await fetchBottomTurnaroundCandidates(
    supabase,
    scoreAsOf
  );

  // 6. 섹터별 리포트 텍스트 조립
  const sectorReports = topSectors.map((sector) => {
    const stocksOfSector =
      sectorStocks?.filter((s) => s.sector_id === sector.id) ?? [];

    const picked = pickTopStocksForSector(stocksOfSector, scoresByCode, 2);

    return formatSectorSection(sector, picked, scoresByCode);
  });

  // 7. 빈집털이 섹션 텍스트 조립
  const bottomSectionText = formatBottomSection(bottomCandidates);

  // 8. 최종 메시지 합치기
  const dateLabel = new Date(asOf).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const title =
    type === "pre_market"
      ? `☀️ **${dateLabel} 장전 브리핑**`
      : `🌙 **${dateLabel} 마감 브리핑**`;

  let report = `${title}\n\n`;

  report += `🚀 **오늘의 주도 테마 (Top 3)**\n`;
  // 섹터 사이 간격을 확실히 벌려줌 (\n\n)
  report += sectorReports.join("\n\n");

  report += `\n\n👀 **'빈집털이' 후보 (과매도 + 모멘텀 개선)**\n`;
  report += bottomSectionText;

  report += `\n\n📌 기준일: 섹터 ${asOf}, 점수 ${scoreAsOf}\n`;
  report += `💡 /start 명령어로 알림 설정을 확인하세요.`;

  return report;
}

// ===== scores 조회 & 후보 조회 유틸 =====

async function fetchScoresByCodes(
  supabase: SupabaseClient,
  codes: string[],
  asof: string
) {
  const map = new Map<string, ScoreRow>();

  if (!codes.length) return map;

  const { data, error } = await supabase
    .from("scores")
    .select(
      [
        "code",
        "total_score",
        "momentum_score",
        "liquidity_score",
        "value_score",
        "factors",
      ].join(", ")
    )
    .eq("asof", asof)
    .in("code", codes)
    .returns<ScoreRow[]>();

  if (error) {
    throw new Error(`Scores fetch failed: ${error.message}`);
  }

  (data ?? []).forEach((row) => {
    map.set(row.code, row);
  });

  return map;
}

async function fetchBottomTurnaroundCandidates(
  supabase: SupabaseClient,
  asof: string
) {
  const { data: lowRsiStocks, error: lowRsiError } = await supabase
    .from("stocks")
    .select("code, name, close, rsi14")
    .lt("rsi14", 35)
    .eq("is_active", true)
    .order("rsi14", { ascending: true })
    .limit(100)
    .returns<Pick<StockRow, "code" | "name" | "close" | "rsi14">[]>();

  if (lowRsiError) {
    throw new Error(`Low-RSI stocks fetch failed: ${lowRsiError.message}`);
  }

  if (!lowRsiStocks || lowRsiStocks.length === 0) return [];

  const codes = lowRsiStocks.map((s) => s.code);

  const { data: scoreRows, error: scoresError } = await supabase
    .from("scores")
    .select("code, momentum_score, total_score, factors")
    .eq("asof", asof)
    .in("code", codes)
    .returns<
      Pick<ScoreRow, "code" | "momentum_score" | "total_score" | "factors">[]
    >();

  if (scoresError) {
    throw new Error(`Bottom scores fetch failed: ${scoresError.message}`);
  }

  const byCode = new Map<string, any>();
  (scoreRows ?? []).forEach((row) => byCode.set(row.code, row));

  const candidates = lowRsiStocks
    .map((stock) => {
      const score = byCode.get(stock.code);
      const factors = (score?.factors ?? {}) as Json;

      const roc21 = toNumber(
        factors.roc_21 ?? factors.roc21 ?? factors.ret_1m ?? factors.return_1m
      );

      return {
        ...stock,
        momentum_score: score?.momentum_score ?? null,
        total_score: score?.total_score ?? null,
        roc21,
      };
    })
    .filter((s) => (s.roc21 ?? 0) > 0)
    .sort((a, b) => (b.roc21 ?? 0) - (a.roc21 ?? 0))
    .slice(0, 5);

  return candidates;
}

function pickTopStocksForSector(
  stocks: StockRow[],
  scoresByCode: Map<string, ScoreRow>,
  limit: number
) {
  const scored = stocks.map((s) => {
    const score = scoresByCode.get(s.code);
    const total = toNumber(score?.total_score ?? score?.momentum_score ?? 0);

    return {
      ...s,
      total_score: total,
    };
  });

  scored.sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));

  return scored.slice(0, limit);
}

// ===== 포맷팅 =====

function formatSectorSection(
  sector: SectorRow,
  stocks: any[],
  scoresByCode: Map<string, ScoreRow>
) {
  const sectorEmoji = getSectorEmoji(sector.name);
  const metrics = (sector.metrics ?? {}) as Json;

  const ret1m = toNumber(metrics.ret_1m ?? metrics.return_1m);
  const ret3m = toNumber(metrics.ret_3m ?? metrics.return_3m);
  const change = sector.change_rate as number | null;

  let header = `\n${sectorEmoji} **${sector.name}**`;
  header += ` | 점수 ${fmtInt(sector.score)}`;
  header += ` | 일간 ${fmtPct(change)}`;
  if (ret1m != null) header += ` | 1M ${fmtPct(ret1m)}`;
  if (ret3m != null) header += ` | 3M ${fmtPct(ret3m)}`;
  header += "\n";

  const lines: string[] = [header];

  // [수정 완료] 종목 없을 때 안내 문구
  if (!stocks || stocks.length === 0) {
    lines.push(`  ↳ (집계된 유동성 종목 없음)`);
    return lines.join("\n");
  }

  stocks.forEach((stock) => {
    const score = scoresByCode.get(stock.code);
    const total = score?.total_score ?? score?.momentum_score ?? null;
    const rsi = stock.rsi14 != null ? Math.round(stock.rsi14) : null;
    const price =
      stock.close != null ? Number(stock.close).toLocaleString("ko-KR") : "-";

    const arrow = changeArrow(change);
    const tags: string[] = [];
    if (stock.is_sector_leader) tags.push("리더");
    if (stock.universe_level && stock.universe_level !== "tail")
      tags.push(stock.universe_level);

    const tagStr = tags.length ? ` (${tags.join(",")})` : "";

    const parts = [
      `${stock.name}${tagStr}`,
      total != null ? `T${total}` : undefined,
      rsi != null ? `RSI${rsi}` : undefined,
    ].filter(Boolean);

    lines.push(`  └ ${parts.join(" / ")} | ${price}원 ${arrow}`);
  });

  return lines.join("\n");
}

function formatBottomSection(candidates: any[]) {
  // [수정 완료] 후보 없으면 안내 메시지 출력 (주석 해제함)
  if (!candidates || candidates.length === 0) {
    return "- 감지된 종목이 없습니다.\n";
  }

  return (
    candidates
      .map((s) => {
        const price =
          s.close != null ? Number(s.close).toLocaleString("ko-KR") : "-";
        const rsi = s.rsi14 != null ? Math.round(s.rsi14) : null;
        const rsiText = rsi != null ? `RSI ${rsi}` : "RSI N/A";

        return `- ${s.name} (${
          s.code
        }): ${price}원 / ${rsiText} / 모멘텀 ${fmtInt(s.momentum_score)}`;
      })
      .join("\n") + "\n"
  );
}

// ===== 공통 헬퍼 =====

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "N/A";
  }
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "-";
  }
  return String(Math.round(Number(v)));
}

function changeArrow(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  const n = Number(v);
  if (n > 0) return `🔺${n.toFixed(1)}%`;
  if (n < 0) return `🔹${n.toFixed(1)}%`;
  return "0.0%";
}

function getSectorEmoji(name: string): string {
  if (name.includes("반도체")) return "💾";
  if (name.includes("2차전지") || name.includes("배터리")) return "🔋";
  if (name.includes("바이오") || name.includes("제약")) return "💊";
  if (name.includes("자동차")) return "🚗";
  if (name.includes("로봇") || name.includes("AI")) return "🤖";
  return "📊";
}
