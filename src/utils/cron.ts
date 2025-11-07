// src/utils/cron.ts
import type { VercelRequest } from "@vercel/node";

export function allowCron(req: VercelRequest): boolean {
  const ua = String(req.headers["user-agent"] || "");
  const hasVercelHeader = !!req.headers["x-vercel-cron"];
  const qs = (req.query?.secret as string) || "";
  const hs = (req.headers["x-cron-secret"] as string) || "";
  const secret = process.env.CRON_SECRET || "";
  // Vercel Cron(헤더/UA) 또는 쿼리/헤더 시크릿 일치 시 통과
  return (
    hasVercelHeader ||
    ua.includes("Vercel/1.0") ||
    (!!secret && (qs === secret || hs === secret))
  );
}
