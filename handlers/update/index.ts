// api/update/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type UpdateResult = {
  total: number;
  inserted: number;
  updated: number;
  changed: number;
  error?: string;
};

function resolveInternalBase(req: VercelRequest): string {
  const override = String(process.env.INTERNAL_API_BASE || process.env.UI_INTERNAL_API_BASE || '').trim();
  if (override) return override.replace(/\/$/, '');

  if (process.env.NODE_ENV !== 'production') {
    const port = String(process.env.PORT || '3000').trim() || '3000';
    return `http://127.0.0.1:${port}`;
  }

  const host = String(req.headers.host || '').trim();
  if (!host) throw new Error('Missing host');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim();
  const proto = forwardedProto || 'https';
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = {
    "x-telegram-bot-secret":
      (req.headers["x-telegram-bot-secret"] as string) ||
      (req.headers["x-cron-secret"] as string) ||
      "",
    "x-ui-key": (req.headers["x-ui-key"] as string) || "",
  };

  const base = resolveInternalBase(req);

  // add short timeout wrapper for internal fetches
  const fetchWithTimeout = async (u: string) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch(u, { method: 'POST', headers, signal: controller.signal });
      clearTimeout(t);
      return r;
    } catch (e:any) {
      clearTimeout(t);
      throw e;
    }
  };

  const [st, sc] = await Promise.all([
    fetchWithTimeout(`${base}/api/update/stocks`),
    fetchWithTimeout(`${base}/api/update/sectors`),
  ]);

  const b1 = (await st.json().catch(() => ({ error: 'invalid json' }))) as UpdateResult;
  const b2 = (await sc.json().catch(() => ({ error: 'invalid json' }))) as UpdateResult;

  const ok = st.ok && sc.ok && !b1.error && !b2.error;

  return res.status(ok ? 200 : 500).json({
    ok,
    stocks: { status: st.status, ...b1 },
    sectors: { status: sc.status, ...b2 },
  });
}
