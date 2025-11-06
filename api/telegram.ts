// api/telegram.ts (사용자 코드 기반 전체 수정)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions"; // waitUntil import 추가
import { KRXClient } from "../packages/data/krx-client";
import { searchByNameOrCode, getNamesForCodes } from "../packages/data/search";
import {
  getCache,
  setCache,
  invalidateCache,
  TTL_MS,
} from "../packages/data/cache";
import {
  getTopSectors,
  getLeadersForSector, // getLeadersForSector: 섹터 리더 추출 (sector.ts 가정, inline 대체)
  getTopSectorsRealtime,
  loadSectorMap,
} from "../packages/data/sector"; // sector.ts 함수들 (미구현 시 inline 대체)

const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const krx = new KRXClient();

export const config = { api: { bodyParser: false } };

type Update = {
  message?: {
    text?: string;
    chat: { id: number | string };
    from: { id: number | string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message: { chat: { id: number | string } };
  };
};

async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ---- indicators (기존 유지) ----
function sma(a: number[], n: number): number[] {
  const o: number[] = [];
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    o.push(i >= n - 1 ? s / n : NaN);
  }
  return o;
}

function rsiWilder(closes: number[], n = 14): number[] {
  const r: number[] = [];
  let g = 0,
    l = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1],
      gg = Math.max(ch, 0),
      ll = Math.max(-ch, 0);
    if (i <= n) {
      g += gg;
      l += ll;
      r.push(NaN);
      continue;
    }
    if (i === n + 1) {
      let ag = g / n,
        al = l / n;
      const rs = al === 0 ? 100 : ag / al;
      r.push(100 - 100 / (1 + rs));
      g = ag;
      l = al;
      continue;
    }
    g = (g * (n - 1) + gg) / n;
    l = (l * (n - 1) + ll) / n;
    const rs = l === 0 ? 100 : g / l;
    r.push(100 - 100 / (1 + rs));
  }
  const pad = Math.max(0, closes.length - r.length);
  r.unshift(...Array(pad).fill(NaN));
  return r;
}

function roc(closes: number[], n: number): number[] {
  return closes.map((v, i) =>
    i >= n ? ((v - closes[i - n]) / closes[i - n]) * 100 : NaN
  );
}

function scoreFromIndicators(closes: number[], vols: number[]) {
  const s20 = sma(closes, 20),
    s50 = sma(closes, 50),
    s200 = sma(closes, 200),
    r14 = rsiWilder(closes, 14);
  const c = closes.at(-1)!,
    s20l = s20.at(-1)!,
    s50l = s50.at(-1)!,
    s200l = s200.at(-1)!,
    s200Prev = s200.at(-2)!;
  const s200Slope = !isNaN(s200l) && !isNaN(s200Prev) ? s200l - s200Prev : 0;
  const roc14 = roc(closes, 14),
    roc21 = roc(closes, 21);
  const r14Last = r14.at(-1)!,
    roc14Last = roc14.at(-1)!,
    roc21Last = roc21.at(-1)!;
  let score = 0;
  if (!isNaN(s20l) && c > s20l) score += 3;
  if (!isNaN(s50l) && c > s50l) score += 4;
  if (!isNaN(s200l) && c > s200l) score += 5;
  if (s200Slope > 0) score += 4;
  if (!isNaN(r14Last)) score += r14Last > 50 ? 2 : r14Last < 40 ? -2 : 0;
  if (!isNaN(roc14Last)) score += roc14Last > 0 ? 2 : -2;
  if (!isNaN(roc21Last)) score += Math.abs(roc21Last) < 2 ? 1 : 0;
  let signal: "buy" | "hold" | "sell" = "hold";
  if (score >= 12) signal = "buy";
  else if (score <= 2) signal = "sell";
  return {
    score,
    signal,
    factors: {
      sma20: isNaN(s20l) ? 0 : c > s20l ? 3 : -3,
      sma50: isNaN(s50l) ? 0 : c > s50l ? 4 : -4,
      sma200: isNaN(s200l) ? 0 : c > s200l ? 5 : -5,
      sma200_slope: s200Slope,
      rsi14: isNaN(r14Last) ? 0 : Math.round(r14Last),
      roc14: isNaN(roc14Last) ? 0 : Math.round(roc14Last),
      roc21: isNaN(roc21Last) ? 0 : Math.round(roc21Last),
    },
  };
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number = 10000, // 15s → 10s로 줄임 (네트워크 안정)
  label = "op"
): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout:${label} (${ms}ms)`)), ms)
    ),
  ]);
}

function toInlineKeyboard(rows: { text: string; data: string }[][]) {
  return {
    inline_keyboard: rows.map((r) =>
      r.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

async function answerCallbackQuery(id: string, text?: string) {
  await fetch("https://api.telegram.org/bot" + TOKEN + "/answerCallbackQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text: text || "" }),
  }).catch(() => {});
}

type ReplyFn = (
  t: string,
  extra?: { reply_markup?: any },
  chatOverride?: number | string
) => Promise<void>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const secretHeader = req.headers["x-telegram-bot-api-secret-token"] as string;
  if (!secretHeader || secretHeader !== SECRET)
    return res.status(401).send("Unauthorized");

  let update: Update | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw);
  } catch {
    return res.status(200).send("OK");
  }

  const message = update?.message,
    callback = update?.callback_query;
  const baseChatId = callback ? callback.message.chat.id : message?.chat.id;

  const reply: ReplyFn = async (t, extra, chatOverride) => {
    const cid = chatOverride ?? baseChatId!;
    try {
      const resp = await fetch(
        "https://api.telegram.org/bot" + TOKEN + "/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: cid,
            text: t,
            reply_markup: extra?.reply_markup,
            parse_mode: "Markdown", // Markdown 지원 (포맷팅)
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        console.error(
          "Reply failed: " +
            resp.status +
            " " +
            err +
            " for chat " +
            cid +
            ", text: " +
            t.slice(0, 50)
        );
      }
    } catch (e) {
      console.error("Reply network error: " + String(e) + " for chat " + cid);
    }
  };

  // ---- callback queries ----
  if (callback) {
    const cb = callback.data ?? "";
    console.log("Callback:", cb, "chat:", baseChatId);
    await answerCallbackQuery(callback.id, "분석 시작...");
    res.status(200).send("OK");
    waitUntil(
      (async () => {
        try {
          await reply("⏳ 데이터 불러오는 중...");
          if (cb.startsWith("sector:")) {
            await handleStocksBySector(cb.slice(7), reply);
          } else if (cb.startsWith("score:")) {
            await analyzeAndReply(cb.slice(6), reply);
          }
        } catch (e: unknown) {
          console.error(
            "waitUntil error:",
            String(e),
            "| stack:",
            (e as Error)?.stack?.slice(0, 200)
          );
          await reply(
            "⚠️ 처리 중 오류: " + String(e).slice(0, 80) + "\n로그 확인 필요."
          );
        }
      })()
    );
    return;
  }

  if (!message) return res.status(200).send("OK");
  const txt = (message.text || "").trim();

  // ---- /top 명령어 (추가: 유동성 상위, 에러 픽스 포함) ----
  if (txt.startsWith("/top")) {
    try {
      await reply("🔥 유동성 상위 종목 로딩 중...");
      // KOSPI (STK → KOSPI)
      const kospiTops = await krx.getTopVolumeStocks("KOSPI", 100);
      const kospiList = kospiTops
        .slice(0, 5)
        .map(
          (s: any) => `• ${s.name} (${s.code}): ${s.volume.toLocaleString()}주`
        )
        .join("\n");

      // KOSDAQ (KSQ → KOSDAQ)
      const kosdaqTops = await krx.getTopVolumeStocks("KOSDAQ", 100);
      const kosdaqList = kosdaqTops
        .slice(0, 5)
        .map(
          (s: any) => `• ${s.name} (${s.code}): ${s.volume.toLocaleString()}주`
        )
        .join("\n");

      const topMsg = `
🔥 **유동성 상위 (실시간)**
**KOSPI TOP 5:**
${kospiList}

**KOSDAQ TOP 5:**
${kosdaqList}

*데이터: KRX 실시간 (오늘 기준)*
      `.trim();

      await reply(topMsg);
      await setCache("top_volumes", {
        kospi: kospiTops,
        kosdaq: kosdaqTops,
        updated: Date.now(),
      });
    } catch (e: any) {
      console.error("/top error:", e);
      await reply("❌ 상위 종목 로드 실패. 나중에 다시 시도하세요.");
    }
    return res.status(200).send("OK");
  }

  // ---- 점수 명령어 (기존 유지) ----
  const isScore =
    /^\/?점수\b/.test(txt) || txt.endsWith(" 점수") || txt.startsWith("/score");
  if (isScore) {
    const arg = txt
      .replace(/^\/?점수\b|\s*점수$/g, "")
      .trim()
      .replace(/^\/score\s*/, "");
    const q = arg || txt.split(/\s+/)[1] || "";
    if (!q) {
      await reply("⚠️ 사용법: /score 삼성전자 또는 /score 005930");
      return res.status(200).send("OK");
    }
    await reply("🔍 분석 중...");
    try {
      await handleScoreFlow(q, reply);
    } catch (e: any) {
      await reply(
        "❌ 데이터 수집 실패: " + String(e?.message || e).slice(0, 120)
      );
    }
    return res.status(200).send("OK");
  }

  // ---- 섹터 명령어 (기존 유지) ----
  const isSector = /^\/?섹터\b/.test(txt) || txt.startsWith("/sector");
  if (isSector) {
    try {
      let tops =
        ((await getCache("top_sectors")) as {
          sector: string;
          score: number;
        }[]) || [];
      const lastUpdate = await getCache("stocks_last_update");
      const needsUpdate =
        !tops.length ||
        Date.now() - new Date(lastUpdate || 0).getTime() > TTL_MS / 2;

      if (needsUpdate) {
        await reply("📊 데이터 최신화 중...");
        const baseUrl = `https://${
          process.env.VERCEL_URL || "your-domain.vercel.app"
        }`;
        const ingestResp = await fetch(`${baseUrl}/api/ingest-data`, {
          method: "POST",
          headers: { "x-ingest-secret": process.env.INGEST_SECRET! },
        });
        if (ingestResp.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          await invalidateCache("top_sectors");
        } else {
          console.error("On-demand ingest failed:", await ingestResp.text());
        }
        tops = await getTopSectors(8); // 재호출
      }

      if (!tops.length) {
        tops = await getTopSectorsRealtime(8);
      }

      await setCache("top_sectors", tops);

      const map = await loadSectorMap();
      const rows = tops.map((s) => {
        const meta = map[s.sector];
        const emoji =
          meta?.category === "IT"
            ? "💻"
            : meta?.category === "Healthcare"
            ? "🏥"
            : meta?.category === "Energy"
            ? "⚡"
            : "📊";
        const displayScore = s.score > 0 ? Math.round(s.score) : "N/A";
        return [
          {
            text: `${emoji} ${s.sector} (${displayScore})`,
            data: "sector:" + s.sector,
          },
        ];
      });
      await reply("📊 실시간 유망 섹터입니다. 선택하세요:", {
        reply_markup: toInlineKeyboard(rows),
      });
      return res.status(200).send("OK");
    } catch (e: any) {
      console.error("Sector handler error:", e);
      await reply("❌ 섹터 계산 실패: " + String(e.message || e).slice(0, 80));
      return res.status(200).send("OK");
    }
  }

  // ---- 종목 명령어 (기존 유지) ----
  const isStocks = /^\/?종목\b/.test(txt) || txt.startsWith("/stocks");
  if (isStocks) {
    const sector = txt.split(/\s+/)[1]?.trim() || "반도체";
    await reply(`📊 "${sector}" 섹터 대장주 후보를 불러오는 중...`);
    try {
      await handleStocksBySector(sector, reply);
    } catch (e: any) {
      console.error("handleStocksBySector error:", e);
      await reply(
        `❌ "${sector}" 섹터 조회 실패: ${String(e.message || e).slice(0, 80)}`
      );
    }
    return res.status(200).send("OK");
  }

  // ---- 도움말 ( /top 추가) ----
  if (txt.startsWith("/start") || txt.startsWith("/시작")) {
    await reply(
      [
        "📱 명령어:",
        "/start - 도움말",
        "/top - 유동성 상위 종목",
        "/sector - 유망 섹터",
        "/stocks <섹터> - 대장주 후보",
        "/score <이름|코드> - 점수/신호",
      ].join("\n")
    );
    return res.status(200).send("OK");
  }

  await reply("❓ 알 수 없는 명령입니다. /start 로 도움말을 확인하세요.");
  return res.status(200).send("OK");
}

// ---- flows (기존 유지 + 픽스) ----
async function handleScoreFlow(input: string, reply: ReplyFn) {
  if (/^\d{6}$/.test(input)) {
    await analyzeAndReply(input, reply);
    return;
  }
  const candidates = await searchByNameOrCode(input, 10);
  if (candidates.length === 0) {
    await reply(
      "❌ 종목을 찾지 못했습니다: " + input + "\n다시 입력해 주세요."
    );
    return;
  }
  if (candidates.length > 1) {
    const rows = candidates.map((c) => [
      {
        text: c.name + " (" + c.code + ") [" + (c.sector || "미분류") + "]",
        data: "score:" + c.code,
      },
    ]);
    await reply("🔎 종목을 선택하세요:", {
      reply_markup: toInlineKeyboard(rows),
    });
    return;
  }
  await analyzeAndReply(candidates[0].code, reply);
}

async function analyzeAndReply(code: string, reply: ReplyFn) {
  try {
    await reply("🔍 " + code + " 분석 중... (데이터 로딩)");
    const end = new Date();
    const start = new Date(end.getTime() - 420 * 24 * 60 * 60 * 1000); // 420일
    const endDate = end.toISOString().slice(0, 10);
    const startDate = start.toISOString().slice(0, 10);

    let ohlcv: any[] = [];
    try {
      ohlcv = await withTimeout(
        krx.getMarketOHLCV(code, startDate, endDate),
        10000,
        "krx"
      );
    } catch (e) {
      console.log("KRX timeout/failed, trying Naver...");
      await reply("⚠️ KRX 데이터 지연: 네이버 대체 로딩 중...");
    }
    if (ohlcv.length < 100) {
      try {
        const alt = await withTimeout(
          krx.getMarketOHLCVFromNaver(code, startDate, endDate),
          8000, // 더 짧게
          "naver"
        );
        if (alt.length > ohlcv.length) ohlcv = alt;
      } catch (e) {
        console.log("Naver also failed:", e);
      }
    }
    if (ohlcv.length < 100) {
      throw new Error(
        `데이터 부족 (필요 100봉 이상, 실제 ${ohlcv.length}봉): 네트워크 확인`
      );
    }

    const closes = ohlcv.map((d) => d.close);
    const highs = ohlcv.map((d) => d.high);
    const lows = ohlcv.map((d) => d.low);
    const vols = ohlcv.map((d) => d.volume);
    const result = scoreFromIndicators(closes, vols);
    const nameMap = await getNamesForCodes([code]);
    const title = (nameMap[code] || code) + " (" + code + ")";
    const last = ohlcv.at(-1)!;
    const emoji =
      result.signal === "buy" ? "🟢" : result.signal === "sell" ? "🔴" : "🟡";
    const plan = buildTradePlan(closes, highs, lows); // 호출 추가 (레벨 계산)

    const lines = [
      `${emoji} **${title}** 분석 결과`,
      "",
      `현재가: **${fmtKRW(last.close)}**`,
      `점수: **${result.score}/100**`,
      `신호: **${result.signal.toUpperCase()}**`,
      "",
      "**이평선:**",
      `• 20SMA: ${fmtKRW(
        Math.round(sma(closes, 20).at(-1)!)
      )} (${plan.state.gap20.toFixed(1)}%)`,
      `• 50SMA: ${fmtKRW(
        Math.round(sma(closes, 50).at(-1)!)
      )} (${plan.state.gap50.toFixed(1)}%)`,
      `• 200SMA: ${fmtKRW(
        Math.round(sma(closes, 200).at(-1)!)
      )} (${plan.state.gap200.toFixed(1)}%)`,
      "",
      `모멘텀: RSI14 **${Math.round(plan.state.rsi14)}**, ROC14 **${Math.round(
        plan.state.roc14
      )}%**, ROC21 **${Math.round(plan.state.roc21)}%**`,
      "",
      "**레벨:**",
      `• 엔트리: ${fmtKRW(plan.levels.entryLo)} ~ ${fmtKRW(
        plan.levels.entryHi
      )}`,
      `• 손절: ${fmtKRW(plan.levels.stop)} (-${(
        ((plan.levels.entry - plan.levels.stop) / plan.levels.entry) *
        100
      ).toFixed(1)}%)`,
      `• 목표: ${fmtKRW(plan.levels.t1)} / ${fmtKRW(plan.levels.t2)} / ${fmtKRW(
        plan.levels.t20
      )}`,
    ].join("\n");
    await reply(lines);
  } catch (e: any) {
    console.error("analyzeAndReply error:", e);
    const errMsg = String(e.message || e).slice(0, 100);
    await reply(
      `❌ 분석 실패 (${code}): ${errMsg}\n\n다시 시도하거나 /start 확인.`
    );
  }
}

async function handleStocksBySector(sector: string, reply: ReplyFn) {
  const timeout = async <T>(p: Promise<T>, ms = 5000): Promise<T> => {
    const fallback = new Promise<T>((resolve) =>
      setTimeout(() => resolve([] as any as T), ms)
    );
    return Promise.race([p, fallback]) as Promise<T>;
  };

  let codes: string[] = await timeout(getLeadersForSector(sector, 12));
  if (typeof codes === "undefined" || !codes.length) {
    // TS2345 픽스: STK → KOSPI, KSQ → KOSDAQ
    const [ks, kq] = await Promise.all([
      krx.getTopVolumeStocks("KOSPI", 100), // STK → KOSPI
      krx.getTopVolumeStocks("KOSDAQ", 100), // KSQ → KOSDAQ
    ]);
    const allVolume = [...ks, ...kq]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
    codes = allVolume.map((x) => x.code);
    await reply(
      `⚠️ "${sector}" 섹터 데이터 부족: 전체 거래대금 상위 ${codes.length}종으로 대체합니다.`
    );
  }

  const nameMap = await getNamesForCodes(codes);
  const rows = codes.slice(0, 10).map((code: string) => {
    const displayName = nameMap[code] || code;
    const text = displayName !== code ? `${displayName} (${code})` : code;
    return [{ text, data: "score:" + code }];
  });

  await reply(
    `📈 **[${sector}]** 대장주 후보 (유동성 상위 순):\n\n거래량 기준`,
    {
      reply_markup: toInlineKeyboard(rows),
    }
  );
}

// ---- utils (기존 유지) ----
function atrWilder(
  highs: number[],
  lows: number[],
  closes: number[],
  n = 14
): number[] {
  const tr: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    const hc = i > 0 ? Math.abs(highs[i] - closes[i - 1]) : 0;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i - 1]) : 0;
    tr.push(Math.max(highs[i] - lows[i], hc, lc));
  }
  const out: number[] = [];
  let avg = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < n) {
      avg += tr[i];
      out.push(NaN);
      continue;
    }
    if (i === n) {
      avg = avg / n;
      out.push(avg);
      continue;
    }
    avg = (avg * (n - 1) + tr[i]) / n;
    out.push(avg);
  }
  return out;
}

function pct(a: number, b: number) {
  return b ? ((a - b) / b) * 100 : NaN;
}

function fmtKRW(x: number) {
  return Math.round(x).toLocaleString() + "원";
}

function buildTradePlan(closes: number[], highs: number[], lows: number[]) {
  const s20 = sma(closes, 20),
    s50 = sma(closes, 50),
    s200 = sma(closes, 200);
  const r14 = rsiWilder(closes, 14),
    roc14 = roc(closes, 14),
    roc21 = roc(closes, 21);
  const atr14 = atrWilder(highs, lows, closes, 14);
  const c = closes.at(-1)!,
    s20l = s20.at(-1)!,
    s50l = s50.at(-1)!,
    s200l = s200.at(-1)!;
  const atr = atr14.at(-1)!;
  const boxLo = isNaN(s20l) ? c * 0.97 : s20l * 0.97;
  const boxHi = isNaN(s20l) ? c * 1.03 : s20l * 1.03;
  const entry = Math.min(Math.max(c, boxLo), boxHi);
  const pctRisk = entry * 0.07;
  const atrRisk = isNaN(atr) ? 0 : 1.5 * atr;
  const risk = Math.max(pctRisk, atrRisk || 0);
  const stop = Math.max(entry - risk, isNaN(s50l) ? 0 : s50l * 0.97);
  const R = entry - stop;
  const t1 = entry + 1 * R;
  const t2 = entry + 2 * R;
  const t20 = entry * 1.2;
  const t25 = entry * 1.25;
  return {
    levels: { entryLo: boxLo, entryHi: boxHi, entry, stop, t1, t2, t20, t25 },
    state: {
      gap20: pct(c, s20l),
      gap50: pct(c, s50l),
      gap200: pct(c, s200l),
      rsi14: r14.at(-1)!,
      roc14: roc14.at(-1)!,
      roc21: roc21.at(-1)!,
    },
  };
}
