import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../../services/scoreSyncService";

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export async function handleDataSyncCommand(match: RegExpMatchArray, ctx: ChatContext, tgSend: any) {
  await tgSend("sendMessage", { chat_id: ctx.chatId, text: "데이터 동기화 시작합니다... (스코어 동기화)" });

  const SUPABASE_URL = String(process.env.SUPABASE_URL ?? "").trim();
  const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "서버에 Supabase 서비스 롤키가 설정되어 있지 않습니다. 로컬에서 실행하려면 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정하세요.",
    });
    return;
  }

  const limit = parseLimit(match?.[2]) ?? 200;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  try {
    const summary = await syncScoresFromEngine(supabase, { fastMode: true, limit, concurrency: 6 });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `데이터 동기화 완료: 대상 ${summary.targetCount} / 처리 ${summary.processedCount} / 업sert ${summary.upsertCount} / 실패 ${summary.failedCount}`,
    });
  } catch (err: any) {
    console.error("dataSync error:", err);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `동기화 중 오류가 발생했습니다: ${String(err?.message ?? err)}`,
    });
  }
}

export default handleDataSyncCommand;
