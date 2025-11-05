import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../packages/data/krx-client";
import { searchByNameOrCode, getNamesForCodes } from "../packages/data/search";
import { getTopSectors, getLeadersForSector } from "../packages/data/sector";

// 환경변수
const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN = process.env.TELEGRAM_ADMIN_CHAT_ID;
const BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

// Vercel: Raw body 필요
export const config = {
  api: { bodyParser: false },
};

// Telegram Update 타입
type Update = {
  message?: {
    text?: string;
    chat: { id: number | string };
    from: { id: number | string };
  };
};

// OHLCV 로컬 타입(외부 타입 파일 없이 사용 가능)
type OHLCV = {
  date: string;
  code: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

// Raw body 읽기
async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Telegram 메시지 전송(unknown → 명시적 타입)
async function sendMessage(chatId: number | string, text: string) {
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      }
    );
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const t = await resp.text();
      console.error(
        "[Telegram] Non-JSON sendMessage:",
        resp.status,
        t.slice(0, 200)
      );
      return;
    }
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) console.error("[Telegram] send failed:", json.description);
  } catch (e) {
    console.error("[Telegram] send error:", e);
  }
}

// 지표 계산
function sma(arr: number[], n: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    out.push(i >= n - 1 ? sum / n : NaN);
  }
  return out;
}

function rsiWilder(closes: number[], n = 14): number[] {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= n) {
      gains += g;
      losses += l;
      rsi.push(NaN);
      continue;
    }
    if (i === n + 1) {
      let avgG = gains / n;
      let avgL = losses / n;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      rsi.push(100 - 100 / (1 + rs));
      gains = avgG;
      losses = avgL;
      continue;
    }
    gains = (gains * (n - 1) + g) / n;
    losses = (losses * (n - 1) + l) / n;
    const rs = losses === 0 ? 100 : gains / losses;
    rsi.push(100 - 100 / (1 + rs));
  }
  rsi.unshift(...Array(Math.max(0, closes.length - rsi.length)).fill(NaN));
  return rsi;
}

function roc(closes: number[], n: number): number[] {
  return closes.map((c, i) =>
    i >= n ? ((c - closes[i - n]) / closes[i - n]) * 100 : NaN
  );
}

function scoreFromIndicators(closes: number[], vols: number[]) {
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const r14 = rsiWilder(closes, 14);
  const r14Last = r14[r14.length - 1];
  const roc14 = roc(closes, 14);
  const roc21 = roc(closes, 21);
  const c = closes[closes.length - 1];
  const s20l = s20[s20.length - 1];
  const s50l = s50[s50.length - 1];
  const s200l = s200[s200.length - 1];
  const s200Prev = s200[s200.length - 2];
  const s200Slope = !isNaN(s200l) && !isNaN(s200Prev) ? s200l - s200Prev : 0;

  let score = 0;
  if (!isNaN(s20l) && c > s20l) score += 3;
  if (!isNaN(s50l) && c > s50l) score += 4;
  if (!isNaN(s200l) && c > s200l) score += 5;
  if (s200Slope > 0) score += 4;
  if (!isNaN(r14Last)) score += r14Last > 50 ? 2 : r14Last < 40 ? -2 : 0;
  const roc14Last = roc14[roc14.length - 1];
  const roc21Last = roc21[roc21.length - 1];
  if (!isNaN(roc14Last)) score += roc14Last > 0 ? 2 : -2;
  if (!isNaN(roc21Last)) score += Math.abs(roc21Last) < 2 ? 1 : 0;

  let signal: "buy" | "hold" | "sell" | "none" = "none";
  if (score >= 12) signal = "buy";
  else if (score <= 2) signal = "sell";
  else signal = "hold";

  const reco =
    signal === "buy"
      ? "엔트리는 20SMA 근처 눌림 재돌파, 손절 −7~−8%, 익절 +20~25% 분할 제안"
      : signal === "sell"
      ? "50일선·AVWAP 하회 시 청산 고려"
      : "보유, 50일선 하회 시 트레일링 스탑 검토";

  return {
    score,
    factors: {
      sma20: isNaN(s20l) ? 0 : c > s20l ? 3 : -3,
      sma50: isNaN(s50l) ? 0 : c > s50l ? 4 : -4,
      sma200: isNaN(s200l) ? 0 : c > s200l ? 5 : -5,
      sma200_slope: s200Slope,
      rsi14: isNaN(r14Last) ? 0 : Math.round(r14Last),
      roc14: isNaN(roc14Last) ? 0 : Math.round(roc14Last),
      roc21: isNaN(roc21Last) ? 0 : Math.round(roc21Last),
      avwap_support: 0,
    },
    signal,
    recommendation: reco,
  };
}

// 메인 핸들러
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const secretHeader = req.headers["x-telegram-bot-api-secret-token"] as string;
  if (!secretHeader || secretHeader !== SECRET) {
    console.error("[Telegram] invalid secret");
    return res.status(401).send("Unauthorized");
  }

  let update: Update | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw);
  } catch (e) {
    console.error("[Telegram] bad JSON body");
    return res.status(200).send("OK");
  }

  const message = update?.message;
  if (!message) return res.status(200).send("OK");

  const text = message.text || "";
  const chatId = message.chat.id;
  const userId = message.from.id;
  console.log(`[Telegram] ${userId} -> ${text}`);

  const krx = new KRXClient();

  // 콜백 우선 처리
  const callback = (update as any).callback_query as
    | { id: string; data?: string; message: { chat: { id: number | string } } }
    | undefined;

  const baseChatId = callback ? callback.message.chat.id : message!.chat.id;
  const reply = async (
    t: string,
    extra?: any,
    chatOverride?: number | string
  ) => {
    const cid = chatOverride ?? baseChatId;
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cid,
        text: t,
        parse_mode: "Markdown",
        reply_markup: extra?.reply_markup,
      }),
    });
  };

  if (callback) {
    const cb = callback.data || "";
    await answerCallbackQuery(callback.id);

    if (cb.startsWith("sector:")) {
      const sector = cb.slice("sector:".length);
      const codes = await getLeadersForSector(sector);
      const nameMap = await getNamesForCodes(codes);
      const rows = codes
        .slice(0, 10)
        .map((code) => [
          { text: `${nameMap[code] || code} (${code})`, data: `score:${code}` },
        ]);
      await reply(`📈 ${sector} 대장주 후보를 선택하세요:`, {
        reply_markup: toInlineKeyboard(rows),
      });
    } else if (cb.startsWith("score:")) {
      const code = cb.slice("score:".length);
      await handleScoreFlow(code, reply);
    } else if (cb.startsWith("stocks:")) {
      const sector = cb.slice("stocks:".length);
      await handleStocksBySector(sector, reply);
    }
    return res.status(200).send("OK");
  }

  // 명령 라우팅(한글/영문)
  const txt = (text || "").trim();
  const isScore =
    /^\/?점수\b/.test(txt) || txt.endsWith(" 점수") || txt.startsWith("/score");
  if (isScore) {
    const arg = txt
      .replace(/^\/?점수\b|\s*점수$/g, "")
      .trim()
      .replace(/^\/score\s*/, "");
    const q = arg || txt.split(/\s+/)[1] || "";
    if (!q) await reply("⚠️ 사용법: /점수 삼성전자  또는  /score 005930");
    else {
      await reply("🔍 분석 중...");
      await handleScoreFlow(q, reply);
    }
    return res.status(200).send("OK");
  }

  // 점수 흐름
  async function handleScoreFlow(
    input: string,
    reply: (t: string, extra?: any) => Promise<void>
  ) {
    if (/^\d{6}$/.test(input)) {
      await analyzeAndReply(input, reply);
      return;
    }
    const candidates = await searchByNameOrCode(input, 8);
    if (candidates.length === 0) {
      await reply(`❌ 종목을 찾지 못했습니다: ${input}\n다시 입력해 주세요.`);
      return;
    }
    if (candidates.length > 1) {
      const rows = candidates.map((c) => [
        { text: `${c.name} (${c.code})`, data: `score:${c.code}` },
      ]);
      await reply("🔎 종목을 선택하세요:", {
        reply_markup: toInlineKeyboard(rows),
      });
      return;
    }
    await analyzeAndReply(candidates[0].code, reply);
  }

  const isSector = /^\/?섹터\b/.test(txt);
  const isStocks = /^\/?종목\b/.test(txt) || txt.startsWith("/stocks");

  if (isSector) {
    const tops = await getTopSectors(6);
    if (!tops.length) {
      await reply("⚠️ 섹터 데이터가 부족합니다. stocks.sector를 채워주세요.");
      return res.status(200).send("OK");
    }
    const rows = tops.map((s) => [
      {
        text: `${s.sector} (점수 ${Math.round(s.score)})`,
        data: `sector:${s.sector}`,
      },
    ]);
    await reply("📊 유망 섹터를 선택하세요:", {
      reply_markup: toInlineKeyboard(rows),
    });
    return res.status(200).send("OK");
  }

  if (isStocks) {
    const sector = txt.split(/\s+/)[1] || "반도체";
    await handleStocksBySector(sector, reply);
    return res.status(200).send("OK");
  }

  try {
    if (text.startsWith("/start")) {
      await reply(
        "✅ 시그널 스캐너 시작\n\n" +
          "명령어:\n" +
          "/sector - 상위 섹터\n" +
          "/stocks - 추천 종목\n" +
          "/score <코드> - 점수\n" +
          "/buy <코드> - 매수 신호"
      );
    } else if (text.startsWith("/sector")) {
      await reply("📊 섹터 분석 준비 중");
    } else if (text.startsWith("/stocks")) {
      await reply("📈 거래대금 상위 준비 중");
    } else if (text.startsWith("/buy")) {
      const parts = text.trim().split(/\s+/);
      const ticker = parts[1];
      if (!ticker) {
        await reply("❌ 사용법: /buy 005930");
      } else {
        await reply(`💰 ${ticker} 매수 신호 분석 준비 중`);
      }
    } else if (text.startsWith("/score")) {
      const parts = text.trim().split(/\s+/);
      const ticker = parts[1];
      if (!ticker) {
        await reply("❌ 사용법: /score 005930");
        return res.status(200).send("OK");
      }
      await reply("🔍 분석 중...");

      const end = new Date();
      const start = new Date(end.getTime() - 420 * 24 * 60 * 60 * 1000);
      const endDate = end.toISOString().slice(0, 10);
      const startDate = start.toISOString().slice(0, 10);

      let ohlcv = await krx.getMarketOHLCV(ticker, startDate, endDate);
      if (ohlcv.length < 220) {
        const alt = await krx.getMarketOHLCVFromNaver(
          ticker,
          startDate,
          endDate
        );
        if (alt.length > ohlcv.length) ohlcv = alt;
      }
      if (ohlcv.length < 200) {
        await reply(`❌ 데이터 부족(필요 200봉): ${ticker}`);
        return res.status(200).send("OK");
      }

      const closes = ohlcv.map((d: OHLCV) => d.close);
      const vols = ohlcv.map((d: OHLCV) => d.volume);
      const result = scoreFromIndicators(closes, vols);

      const last = ohlcv[ohlcv.length - 1] as OHLCV;
      const emoji =
        result.signal === "buy" ? "🟢" : result.signal === "sell" ? "🔴" : "🟡";
      const msg =
        `${emoji} ${ticker} 분석 결과\n\n` +
        `가격: ${last.close.toLocaleString()}원\n` +
        `점수: ${result.score} / 100\n` +
        `신호: ${result.signal.toUpperCase()}\n\n` +
        `세부:\n` +
        `• 20SMA: ${result.factors.sma20}\n` +
        `• 50SMA: ${result.factors.sma50}\n` +
        `• 200SMA: ${result.factors.sma200}\n` +
        `• RSI14: ${result.factors.rsi14}\n` +
        `• ROC14: ${result.factors.roc14}\n` +
        `• ROC21: ${result.factors.roc21}\n\n` +
        `추천: ${result.recommendation}`;
      await reply(msg);
    } else {
      await reply(
        "📱 명령어:\n" +
          "/시작 - 시작\n" +
          "/섹터 - 유망 섹터\n" +
          "/종목 <섹터> - 대장주 후보\n" +
          "/점수 <이름|코드> - 점수/신호\n" +
          "/매수 <코드> - 엔트리 제안"
      );
    }
  } catch (e) {
    console.error("[Telegram] handler error:", e);
    await reply("❌ 처리 중 오류 발생");
  }

  return res.status(200).send("OK");
}

// 유틸: 인라인 키보드 생성
function toInlineKeyboard(rows: { text: string; data: string }[][]) {
  return {
    inline_keyboard: rows.map((r) =>
      r.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

// 콜백 응답
async function answerCallbackQuery(id: string, text?: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text: text || "" }),
    });
  } catch {}
}

async function analyzeAndReply(
  code: string,
  reply: (t: string, extra?: any) => Promise<void>
) {
  const krx = new KRXClient();
  const end = new Date();
  const start = new Date(end.getTime() - 420 * 24 * 60 * 60 * 1000);
  const endDate = end.toISOString().slice(0, 10);
  const startDate = start.toISOString().slice(0, 10);

  let ohlcv = await krx.getMarketOHLCV(code, startDate, endDate);
  if (ohlcv.length < 220) {
    const alt = await krx.getMarketOHLCVFromNaver(code, startDate, endDate);
    if (alt.length > ohlcv.length) ohlcv = alt;
  }
  if (ohlcv.length < 200) {
    await reply(`❌ 데이터 부족(필요 200봉): ${code}`);
    return;
  }

  const closes = ohlcv.map((d: any) => d.close);
  const vols = ohlcv.map((d: any) => d.volume);
  const result = scoreFromIndicators(closes, vols);

  const nameMap = await getNamesForCodes([code]);
  const title = `${nameMap[code] || code} (${code})`;
  const last = ohlcv[ohlcv.length - 1] as any;
  const emoji =
    result.signal === "buy" ? "🟢" : result.signal === "sell" ? "🔴" : "🟡";
  const msgHeader = `${emoji} ${title} 분석 결과\n\n`;

  const msg =
    `${msgHeader}` +
    `가격: ${last.close.toLocaleString()}원\n` +
    `점수: ${result.score} / 100\n` +
    `신호: ${result.signal.toUpperCase()}\n\n` +
    `세부:\n` +
    `• 20SMA: ${result.factors.sma20}\n` +
    `• 50SMA: ${result.factors.sma50}\n` +
    `• 200SMA: ${result.factors.sma200}\n` +
    `• RSI14: ${result.factors.rsi14}\n` +
    `• ROC14: ${result.factors.roc14}\n` +
    `• ROC21: ${result.factors.roc21}\n\n` +
    `추천: ${result.recommendation}`;
  await reply(msg);
}

// 섹터→종목 후보(여기서는 거래대금 상위 예시)
async function handleStocksBySector(
  sector: string,
  reply: (t: string, extra?: any) => Promise<void>
) {
  const codes = await getLeadersForSector(sector);
  const nameMap = await getNamesForCodes(codes);
  const rows = codes
    .slice(0, 10)
    .map((code) => [
      { text: `${nameMap[code] || code} (${code})`, data: `score:${code}` },
    ]);
  await reply(`📈 ${sector} 대장주 후보를 선택하세요:`, {
    reply_markup: toInlineKeyboard(rows),
  });
}
