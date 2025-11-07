// api/telegram.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { api: { bodyParser: false } };

const TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET || "";
const INTERNAL_SECRET = process.env.CRON_SECRET || ""; // /api/worker 보호
const EXPLICIT_BASE_URL = process.env.BASE_URL || ""; // 예: https://signal-scanner-bot.vercel.app

type TGUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

function getBaseFromReq(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers.host as string) ||
    "";
  return `${proto}://${host}`;
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: any) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  // Telegram secret header 검증
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!TELEGRAM_BOT_SECRET || headerSecret !== TELEGRAM_BOT_SECRET) {
    return res.status(401).json({ ok: false, error: "invalid secret" });
  }

  // 업데이트 파싱
  let update: TGUpdate | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw.toString("utf8"));
  } catch {
    // 파싱 실패도 ACK하여 재시도 루프 방지
    return res.status(200).json({ ok: true });
  }

  // 1) 즉시 ACK (단 한 번)
  res.status(200).json({ ok: true });

  // 2) 워커 트리거 (새 인보케이션에서 실제 처리 수행)
  try {
    const base = EXPLICIT_BASE_URL || getBaseFromReq(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);

    fetch(`${base}/api/worker`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(update),
      signal: controller.signal,
    }).catch(() => {
      /* fire-and-forget */
    });

    clearTimeout(timer);
  } catch {
    // 트리거 실패는 무시 (웹훅은 이미 ACK)
  }
}
