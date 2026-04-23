import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

async function runWeeklyCopilot(
  ctx: ReturnType<typeof buildCtx>,
  tgSend: (method: string, payload: any) => Promise<void>,
  rawArg: string,
  deps: Parameters<(typeof import("../src/bot/commands/weeklyCopilot"))["handleWeeklyCopilotCommand"]>[3]
) {
  const mod = await import("../src/bot/commands/weeklyCopilot");
  await mod.handleWeeklyCopilotCommand(ctx, tgSend, rawArg, deps);
}

function buildCtx() {
  return {
    chatId: 1001,
    from: { id: 1001 },
  };
}

function buildSender() {
  const sent: Array<{ method: string; payload: any }> = [];
  const tgSend = async (method: string, payload: any) => {
    sent.push({ method, payload });
  };
  return { tgSend, sent };
}

test("주간코파일럿: 동일일 중복 실행은 차단되고 안내 메시지를 보낸다", async () => {
  const { tgSend, sent } = buildSender();
  let runCount = 0;

  await runWeeklyCopilot(buildCtx(), tgSend, "", {
    getPrefs: async () => ({
      risk_profile: "safe",
      capital_krw: 3_000_000,
      weekly_copilot_last_run_at: new Date().toISOString(),
      weekly_copilot_last_mode: "normal",
      weekly_copilot_last_status: "success",
    }),
    setPrefs: async () => ({ ok: true }),
    runBrief: async () => {
      runCount += 1;
    },
    runPreMarket: async () => {
      runCount += 1;
    },
    runWatchResponse: async () => {
      runCount += 1;
    },
  });

  assert.equal(runCount, 0);
  assert.equal(sent.length, 1);
  assert.match(String(sent[0].payload.text), /이미 주간 코파일럿을 실행/);
});

test("주간코파일럿: 강제 실행은 동일일에도 진행되고 mode/status를 저장한다", async () => {
  const { tgSend } = buildSender();
  const saved: Array<Record<string, unknown>> = [];

  await runWeeklyCopilot(buildCtx(), tgSend, "강제", {
    getPrefs: async () => ({
      risk_profile: "balanced",
      capital_krw: 5_000_000,
      weekly_copilot_last_run_at: new Date().toISOString(),
      weekly_copilot_last_mode: "normal",
      weekly_copilot_last_status: "success",
    }),
    setPrefs: async (_tgId, patch) => {
      saved.push(patch as Record<string, unknown>);
      return { ok: true };
    },
    runBrief: async () => {},
    runPreMarket: async () => {},
    runWatchResponse: async () => {},
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].weekly_copilot_last_mode, "forced");
  assert.equal(saved[0].weekly_copilot_last_status, "success");
  assert.equal(typeof saved[0].weekly_copilot_last_run_at, "string");
});

test("주간코파일럿: 일부 단계 실패 시 partial 상태로 저장된다", async () => {
  const { tgSend, sent } = buildSender();
  const saved: Array<Record<string, unknown>> = [];

  await runWeeklyCopilot(buildCtx(), tgSend, "", {
    getPrefs: async () => ({
      risk_profile: "active",
      capital_krw: 10_000_000,
    }),
    setPrefs: async (_tgId, patch) => {
      saved.push(patch as Record<string, unknown>);
      return { ok: true };
    },
    runBrief: async () => {},
    runPreMarket: async () => {
      throw new Error("forced failure");
    },
    runWatchResponse: async () => {},
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].weekly_copilot_last_mode, "normal");
  assert.equal(saved[0].weekly_copilot_last_status, "partial");

  const lastMessage = sent[sent.length - 1]?.payload?.text ?? "";
  assert.match(String(lastMessage), /부분 완료/);
  assert.match(String(lastMessage), /장전 주문 플랜/);
});

test("주간코파일럿: 선행조건 미설정이면 설정 유도만 수행한다", async () => {
  const { tgSend, sent } = buildSender();
  let setCalled = false;

  await runWeeklyCopilot(buildCtx(), tgSend, "", {
    getPrefs: async () => ({
      risk_profile: "safe",
      capital_krw: 0,
    }),
    setPrefs: async () => {
      setCalled = true;
      return { ok: true };
    },
    runBrief: async () => {},
    runPreMarket: async () => {},
    runWatchResponse: async () => {},
  });

  assert.equal(setCalled, false);
  assert.equal(sent.length, 1);
  assert.match(String(sent[0].payload.text), /설정이 필요합니다/);
});
