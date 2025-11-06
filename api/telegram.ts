// api/telegram.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../packages/data/krx-client";
import { searchByNameOrCode, getNamesForCodes } from "../packages/data/search";
import {
  getTopSectors,
  getLeadersForSector,
  getTopSectorsRealtime,
  loadSectorMap,
} from "../packages/data/sector";

const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

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
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ---- indicators ----
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

function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout:${label}`)), ms)
    ),
  ]) as Promise<T>;
}

function toInlineKeyboard(rows: { text: string; data: string }[][]) {
  return {
    inline_keyboard: rows.map((r) =>
      r.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

async function answerCallbackQuery(id: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
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

// ✅ ES Module export (기본 export)
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
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cid,
        text: t,
        reply_markup: extra?.reply_markup,
      }),
    }).catch(() => {});
  };

  // ---- callback queries ----
  if (callback) {
    const cb = callback.data || "";
    // 1) 즉시 확인 + 즉시 안내 (둘 다 기다림)
    await Promise.allSettled([
      answerCallbackQuery(callback.id, "처리중..."),
      reply("⏳ 불러오는 중..."),
    ]);

    // 2) 가벼운 작업은 즉시 처리(3~5초 내 끝나도록 타임아웃)
    if (cb.startsWith("sector:")) {
      const sector = cb.slice("sector:".length);
      await handleStocksBySector(sector, reply); // 내부 timeout 유지
    } else if (cb.startsWith("score:")) {
      const code = cb.slice("score:".length);
      await analyzeAndReply(code, reply);
    }

    // 3) 처리 후 응답 종료
    return res.status(200).send("OK");
  }

  if (!message) return res.status(200).send("OK");

  const txt = (message.text || "").trim();

  // ---- 점수 명령어 ----
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
        `❌ 데이터 수집 실패: ${String(e?.message || e).slice(0, 120)}`
      );
    }
    return res.status(200).send("OK");
  }

  // ---- 섹터 명령어 ----
  const isSector = /^\/?섹터\b/.test(txt) || txt.startsWith("/sector");
  if (isSector) {
    try {
      const tops = await getTopSectors(8);
      let use = tops;
      if (!use.length)
        use = (await getTopSectorsRealtime(8)).map((x) => ({
          sector: x.sector,
          score: x.score,
        }));

      if (!use.length) {
        await reply("⚠️ 섹터 데이터가 부족합니다. 잠시 후 다시 시도해 주세요.");
        return res.status(200).send("OK");
      }

      const map = await loadSectorMap();
      const rows = use.map((s) => {
        const meta = map[s.sector];
        const emoji =
          meta?.category === "IT"
            ? "💻"
            : meta?.category === "Energy"
            ? "⚡"
            : meta?.category === "Healthcare"
            ? "🏥"
            : "📊";
        return [
          {
            text: `${emoji} ${s.sector} (${Math.round(s.score)})`,
            data: `sector:${s.sector}`,
          },
        ];
      });

      await reply("📊 실시간 유망 섹터입니다. 선택하세요:", {
        reply_markup: toInlineKeyboard(rows),
      });
      return res.status(200).send("OK");
    } catch (e: any) {
      await reply(`❌ 섹터 계산 실패: ${String(e?.message || e).slice(0, 80)}`);
      return res.status(200).send("OK");
    }
  }

  // ---- 종목 명령어 ----
  const isStocks = /^\/?종목\b/.test(txt) || txt.startsWith("/stocks");
  if (isStocks) {
    const sector = txt.split(/\s+/)[1] || "반도체";
    await handleStocksBySector(sector, reply);
    return res.status(200).send("OK");
  }

  // ---- 도움말 ----
  if (txt.startsWith("/start") || txt.startsWith("/시작")) {
    await reply(
      [
        "📱 명령어:",
        "/start - 도움말",
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

// ---- flows ----
async function handleScoreFlow(input: string, reply: ReplyFn) {
  if (/^\d{6}$/.test(input)) {
    await analyzeAndReply(input, reply);
    return;
  }

  const candidates = await searchByNameOrCode(input, 10);
  if (candidates.length === 0) {
    await reply(`❌ 종목을 찾지 못했습니다: ${input}\n다시 입력해 주세요.`);
    return;
  }

  if (candidates.length > 1) {
    const rows = candidates.map((c) => [
      {
        text: `${c.name} (${c.code}) [${c.sector || "미분류"}]`,
        data: `score:${c.code}`,
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
  const krx = new KRXClient();
  const end = new Date();
  const start = new Date(end.getTime() - 420 * 24 * 60 * 60 * 1000);
  const endDate = end.toISOString().slice(0, 10),
    startDate = start.toISOString().slice(0, 10);

  let ohlcv: any[] = [];
  try {
    ohlcv = await withTimeout(
      krx.getMarketOHLCV(code, startDate, endDate),
      12000,
      "krx"
    );
  } catch {}

  if (ohlcv.length < 220) {
    try {
      const alt = await withTimeout(
        krx.getMarketOHLCVFromNaver(code, startDate, endDate),
        8000,
        "naver"
      );
      if (alt.length > ohlcv.length) ohlcv = alt;
    } catch {}
  }

  if (ohlcv.length < 200) {
    await reply(`❌ 데이터 부족/지연(필요 200봉): ${code}`);
    return;
  }

  const closes = ohlcv.map((d) => d.close),
    vols = ohlcv.map((d) => d.volume),
    highs = ohlcv.map((d) => d.high),
    lows = ohlcv.map((d) => d.low);

  const result = scoreFromIndicators(closes, vols);
  const nameMap = await getNamesForCodes([code]);
  const title = `${nameMap[code] || code} (${code})`;
  const last = ohlcv.at(-1)!;
  const emoji =
    result.signal === "buy" ? "🟢" : result.signal === "sell" ? "🔴" : "🟡";
  const plan = buildTradePlan(closes, highs, lows);

  const lines = [
    `${emoji} ${title} 분석 결과`,
    "",
    `가격: ${fmtKRW(last.close)}`,
    `점수: ${result.score} / 100`,
    `신호: ${result.signal.toUpperCase()}`,
    "",
    `이평선 상태:`,
    `• 20SMA ${fmtKRW(
      Math.round(sma(closes, 20).at(-1)!)
    )} (${plan.state.gap20.toFixed(1)}%) — 현재가가 ${
      plan.state.gap20 >= 0 ? "위" : "아래"
    }입니다`,
    `• 50SMA ${fmtKRW(
      Math.round(sma(closes, 50).at(-1)!)
    )} (${plan.state.gap50.toFixed(1)}%)`,
    `• 200SMA ${fmtKRW(
      Math.round(sma(closes, 200).at(-1)!)
    )} (${plan.state.gap200.toFixed(1)}%)`,
    "",
    `모멘텀: RSI14 ${Math.round(
      plan.state.rsi14
    )} (40~60 중립), ROC14 ${Math.round(plan.state.roc14)}%, ROC21 ${Math.round(
      plan.state.roc21
    )}%`,
    "",
    `제안 레벨:`,
    `• 엔트리: ${fmtKRW(plan.levels.entryLo)} ~ ${fmtKRW(plan.levels.entryHi)}`,
    `• 손절: ${fmtKRW(plan.levels.stop)} (리스크 ${(
      ((plan.levels.entry - plan.levels.stop) / plan.levels.entry) *
      100
    ).toFixed(1)}%)`,
    `• 목표가: ${fmtKRW(plan.levels.t1)} / ${fmtKRW(plan.levels.t2)} / ${fmtKRW(
      plan.levels.t20
    )}`,
  ].join("\n");

  await reply(lines);
}

async function handleStocksBySector(sector: string, reply: ReplyFn) {
  const timeout = (p: Promise<string[]>, ms = 3000) =>
    Promise.race([
      p,
      new Promise<string[]>((r) => setTimeout(() => r([]), ms)),
    ]);

  let codes = await timeout(getLeadersForSector(sector, 12));
  if (!codes.length) {
    const krx = new KRXClient();
    const [ks, kq] = await Promise.all([
      krx.getTopVolumeStocks("STK", 100),
      krx.getTopVolumeStocks("KSQ", 100),
    ]);
    codes = [...ks, ...kq].slice(0, 10).map((x) => x.code);
    await reply(`⚠️ '${sector}' 섹터 조회가 느려 거래대금 상위로 대체합니다.`);
  }
  const nameMap = await getNamesForCodes(codes);
  const rows = codes
    .slice(0, 10)
    .map((code) => [
      { text: `${nameMap[code] || code} (${code})`, data: `score:${code}` },
    ]);
  await reply(`📈 [${sector}] 대장주 후보를 선택하세요:\n\n(유동성 상위 순)`, {
    reply_markup: toInlineKeyboard(rows),
  });
}

// ---- utils ----
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
