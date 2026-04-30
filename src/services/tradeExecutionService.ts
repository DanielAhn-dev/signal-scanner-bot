import { createClient } from "@supabase/supabase-js";

const supaService = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export type ExecInput = {
  chatId: number;
  code: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  memo?: string;
  useReal?: boolean;
};

export async function executeOrder(input: ExecInput): Promise<{ ok: boolean; id?: number; message?: string }> {
  const { chatId, code, side, price, quantity, memo, useReal } = input;
  // if real trading requested but not configured, return not-ok
  if (useReal && process.env.REAL_TRADING_ENABLED !== "1") {
    return { ok: false, message: "Real trading not enabled" };
  }

  // For now, implement virtual trade insertion using service_role key
  try {
    const supa = supaService();
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { ok: false, message: "SUPABASE service role key not configured" };
    }

    const gross = Math.round(price * quantity);
    const fee = 0; // placeholder
    const tax = 0;
    const net = gross - fee - tax;

    const { data, error } = await supa
      .from("virtual_trades")
      .insert({
        chat_id: chatId,
        code,
        side: side === "BUY" ? "BUY" : "SELL",
        price,
        quantity,
        gross_amount: gross,
        net_amount: net,
        fee_amount: fee,
        tax_amount: tax,
        memo: memo ?? null,
        traded_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, message: error.message };
    }
    return { ok: true, id: (data as any)?.id };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}

export default { executeOrder };
