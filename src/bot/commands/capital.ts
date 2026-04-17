import type { ChatContext } from "../router";
import { fmtInt, LINE } from "../messages/format";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "../../services/userService";

function parseRiskProfile(raw?: string): "safe" | "balanced" | "active" | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (["safe", "안전", "안전형", "보수", "보수형"].includes(value)) return "safe";
  if (["balanced", "균형", "균형형"].includes(value)) return "balanced";
  if (["active", "aggressive", "공격", "공격형"].includes(value)) return "active";
  return null;
}

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

function parseKrwAmount(raw: string): number | null {
  const v = raw.replace(/\s+/g, "").toLowerCase();
  if (!v) return null;

  const plain = Number(v.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(plain) || plain <= 0) return null;

  if (v.includes("억")) return Math.round(plain * 100_000_000);
  if (v.includes("천만")) return Math.round(plain * 10_000_000);
  if (v.includes("백만") || v.includes("m")) return Math.round(plain * 1_000_000);
  if (v.includes("만")) return Math.round(plain * 10_000);

  return Math.round(plain);
}

function parsePositiveInt(raw: string): number | null {
  const n = Number(raw.replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parsePositiveFloat(raw: string): number | null {
  const n = Number(raw.replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseLossLimitPct(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > 30) return null;
  return Number(n.toFixed(1));
}

export async function handleCapitalCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const raw = (input || "").trim();

  if (!raw) {
    const prefs = await getUserInvestmentPrefs(tgId);
    const cap = prefs.capital_krw ?? 0;
    const split = prefs.split_count ?? 3;
    const target = prefs.target_profit_pct ?? 8;
    const profile = prefs.risk_profile ?? "safe";
    const dailyLossLimitPct = prefs.daily_loss_limit_pct ?? 5;

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>내 투자금 설정</b>",
        LINE,
        `투자금 <code>${fmtInt(cap)}원</code>`,
        `분할매수 <code>${split}회</code>`,
        `목표수익률 <code>${target.toFixed(1)}%</code>`,
        `투자성향 <code>${riskProfileLabel(profile)}</code>`,
        `일손실 한도 <code>${dailyLossLimitPct.toFixed(1)}%</code>`,
        "",
        "설정 예시:",
        "• /투자금 300만원",
        "• /투자금 5000000 4 10 안전형 5",
        "  (투자금 분할횟수 목표수익률% 투자성향 일손실한도%)",
        "• /투자금 손실한도 4",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  const lowered = raw.toLowerCase();
  if (lowered.startsWith("손실한도") || lowered.startsWith("한도") || lowered.startsWith("loss")) {
    const pctRaw = raw.split(/\s+/).filter(Boolean)[1];
    const lossLimitPct = parseLossLimitPct(pctRaw);
    if (!lossLimitPct) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /투자금 손실한도 <퍼센트>\n예) /투자금 손실한도 4",
      });
    }

    const savedLimit = await setUserInvestmentPrefs(tgId, {
      daily_loss_limit_pct: lossLimitPct,
    });
    if (!savedLimit.ok) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: savedLimit.message || "일손실 한도 저장 실패",
      });
    }

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "✅ <b>일손실 한도 설정 완료</b>",
        LINE,
        `일손실 한도 <code>${lossLimitPct.toFixed(1)}%</code>`,
        "한도 도달 시 /종목분석 신규 진입 판단은 자동으로 더 보수적으로 조정됩니다.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const amount = parseKrwAmount(parts[0]);

  if (!amount) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /투자금 <금액> [분할횟수] [목표수익률%] [투자성향] [일손실한도%]\n예) /투자금 300만원 3 8 안전형 5",
    });
  }

  const splitCount = parts[1] ? parsePositiveInt(parts[1]) : 3;
  const targetPct = parts[2] ? parsePositiveFloat(parts[2]) : 8;
  const riskProfile = parseRiskProfile(parts[3]) ?? "safe";
  const dailyLossLimitPct = parts[4] ? parseLossLimitPct(parts[4]) : 5;

  if (!splitCount || !targetPct || !dailyLossLimitPct) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "분할횟수/목표수익률/일손실한도 값이 올바르지 않습니다.\n예) /투자금 300만원 3 8 안전형 5",
    });
  }

  const saved = await setUserInvestmentPrefs(tgId, {
    capital_krw: amount,
    split_count: splitCount,
    target_profit_pct: targetPct,
    risk_profile: riskProfile,
    daily_loss_limit_pct: dailyLossLimitPct,
  });

  if (!saved.ok || !saved.prefs) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: saved.message || "투자금 설정 저장 실패",
    });
  }

  return tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "✅ <b>투자금 설정 저장 완료</b>",
      LINE,
      `투자금 <code>${fmtInt(saved.prefs.capital_krw || 0)}원</code>`,
      `분할매수 <code>${saved.prefs.split_count || 3}회</code>`,
      `목표수익률 <code>${(saved.prefs.target_profit_pct || 8).toFixed(1)}%</code>`,
      `투자성향 <code>${riskProfileLabel(saved.prefs.risk_profile)}</code>`,
      `일손실 한도 <code>${(saved.prefs.daily_loss_limit_pct || 5).toFixed(1)}%</code>`,
      "",
      "이제 /종목분석과 추천 후보가 이 성향 기준으로 더 보수적 또는 적극적으로 바뀝니다.",
    ].join("\n"),
    parse_mode: "HTML",
  });
}
