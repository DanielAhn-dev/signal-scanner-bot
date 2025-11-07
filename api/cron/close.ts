// api/cron/close.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCron } from "../../src/utils/cron";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowCron(req)) return res.status(401).send("unauthorized");
  return res.status(200).send("close ok");
}
