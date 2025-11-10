// src/lib/supa.ts
import { createClient } from "@supabase/supabase-js";
export const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
