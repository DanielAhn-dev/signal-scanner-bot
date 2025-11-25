import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function safeNumberFormat(n: any) {
  if (n == null) return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString();
}

export async function handleBriefCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  try {
    // --- 1) 가치주: scores 테이블에서 우선 조건으로 코드 목록 조회 ---
    const { data: valueScoreRows, error: errVs } = await supabase
      .from("scores")
      .select("code")
      .gt("value_score", 60)
      .limit(50);

    if (errVs) {
      console.error("Supabase value score 조회 에러:", errVs);
      // 에러가 있으면 관리자에게 알리는 수준의 응답도 고려
    }

    const valueCodes = (valueScoreRows || []).map((r: any) => r.code);
    // --- stocks에서 가져오기 (universe_level core 조건 적용) ---
    let valueStocks: any[] = [];
    if (valueCodes.length > 0) {
      const { data: vs, error: err } = await supabase
        .from("stocks")
        .select("name, close, code, universe_level")
        .in("code", valueCodes)
        .eq("universe_level", "core")
        .limit(5);
      if (err) {
        console.error("Supabase stocks(value) 조회 에러:", err);
      } else {
        valueStocks = vs || [];
      }
    }

    // --- 2) 모멘텀주: 같은 방식으로 scores에서 코드 목록 조회 ---
    const { data: momScoreRows, error: errMs } = await supabase
      .from("scores")
      .select("code")
      .gt("momentum_score", 60)
      .limit(50);

    if (errMs) {
      console.error("Supabase momentum score 조회 에러:", errMs);
    }

    const momCodes = (momScoreRows || []).map((r: any) => r.code);
    let momentumStocks: any[] = [];
    if (momCodes.length > 0) {
      const { data: ms, error: err } = await supabase
        .from("stocks")
        .select("name, close, code, universe_level")
        .in("code", momCodes)
        .eq("universe_level", "core")
        .limit(5);
      if (err) {
        console.error("Supabase stocks(momentum) 조회 에러:", err);
      } else {
        momentumStocks = ms || [];
      }
    }

    // 디버그 로그 (콘솔에 찍어서 작동여부 확인)
    console.log(
      "valueStocks.length=",
      valueStocks.length,
      "momentumStocks.length=",
      momentumStocks.length
    );

    // --- 3) 메시지 생성 (빈 결과 방어) ---
    let msg = `🌅 *[08:30] 장전 대형주 브리핑*\n_(실패 없는 Core 유니버스)_\n\n`;

    msg += `💎 *저평가 가치주 (Value)*\n`;
    if (valueStocks.length === 0) {
      msg += `_추천 종목이 없습니다._\n`;
    } else {
      valueStocks.forEach((s: any) => {
        // 종목 클릭을 위해 /stocks 명령어 + 코드 표기
        msg += `- ${s.name} (${s.code}): ${safeNumberFormat(
          s.close
        )}원 — /stocks ${s.code}\n`;
      });
    }

    msg += `\n🚀 *수급 주도주 (Momentum)*\n`;
    if (momentumStocks.length === 0) {
      msg += `_추천 종목이 없습니다._\n`;
    } else {
      momentumStocks.forEach((s: any) => {
        msg += `- ${s.name} (${s.code}): ${safeNumberFormat(
          s.close
        )}원 — /stocks ${s.code}\n`;
      });
    }

    msg += `\n👇 종목명을 클릭하거나 /stocks {code} 명령어로 상세 확인`;

    // --- 4) Telegram 전송 ---
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("handleBriefCommand 전체 실패:", e);
    // 실패 시 사용자에게 최소한의 알림
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 브리핑 중 오류가 발생했습니다. 관리자에게 문의하세요.",
    });
  }
}
