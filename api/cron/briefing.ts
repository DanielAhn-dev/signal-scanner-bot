// api/cron/briefing.ts
export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET || "";
  const got =
    (req.headers["x-cron-secret"] as string) ||
    (req.query?.secret as string) ||
    "";
  if (!secret || got !== secret) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }
  // TODO: 섹터/유망종목 요약 생성 및 텔레그램 전송(다음 단계)
  res.statusCode = 200;
  res.end("briefing ok");
}
