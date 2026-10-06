// 진입점 맨 위에서 import해 응답 잘림 감지기를 켠다 (src/lib/supabaseTruncationGuard.ts)
import { installSupabaseTruncationGuard } from "./supabaseTruncationGuard";

installSupabaseTruncationGuard();
