// scripts/setCommands.js
import "dotenv/config";

// ===== Config =====
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");

const BASE = `https://api.telegram.org/bot${TOKEN}`;
const SCOPES = [
  undefined, // default
  { type: "all_private_chats" },
];

// 관리할 커맨드 정의
const COMMANDS = [
  { command: "start", description: "사용법 안내" },
  { command: "sector", description: "유망 섹터 보기" },
  { command: "stocks", description: "섹터별 대장주 보기" },
  { command: "score", description: "종목 점수/신호" },
  { command: "buy", description: "엔트리/손절/익절 제안" },
];

// ===== Utils =====
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tg(method, payload = {}, { timeoutMs = 10000, tries = 2 } = {}) {
  const url = `${BASE}/${method}`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      clearTimeout(t);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(
          `Telegram API error: ${res.status} ${JSON.stringify(json)}`
        );
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

function normalizeCmds(cmds = []) {
  // Telegram은 순서·공백 차이로 매번 갱신되는 것을 방지
  return [...cmds]
    .map((c) => ({
      command: String(c.command).trim(),
      description: String(c.description || "").trim(),
    }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

function diffCmds(a, b) {
  const A = normalizeCmds(a);
  const B = normalizeCmds(b);
  return JSON.stringify(A) !== JSON.stringify(B);
}

// ===== Actions =====
async function getCurrent(scope, language_code) {
  const payload = {
    ...(scope ? { scope } : {}),
    ...(language_code ? { language_code } : {}),
  };
  const res = await tg("getMyCommands", payload);
  return res.result || [];
}

async function setIfChanged(
  scope,
  cmds,
  { dryRun = false, language_code } = {}
) {
  const current = await getCurrent(scope, language_code);
  const changed = diffCmds(current, cmds);
  const scopeName = scope ? scope.type : "default";
  if (!changed) {
    console.log(`✓ ${scopeName}: no changes`);
    return { changed: false };
  }
  if (dryRun) {
    console.log(`~ ${scopeName}: would update`, { from: current, to: cmds });
    return { changed: true };
  }
  const payload = {
    ...(scope ? { scope } : {}),
    ...(language_code ? { language_code } : {}),
    commands: normalizeCmds(cmds),
  };
  await tg("setMyCommands", payload);
  console.log(`✔ ${scopeName}: updated (${cmds.length} commands)`);
  return { changed: true };
}

async function deleteAll({ dryRun = false, language_code } = {}) {
  await Promise.all(
    SCOPES.map(async (scope) => {
      const scopeName = scope ? scope.type : "default";
      if (dryRun) return console.log(`~ ${scopeName}: would delete`);
      await tg("deleteMyCommands", {
        ...(scope ? { scope } : {}),
        ...(language_code ? { language_code } : {}),
      });
      console.log(`✔ ${scopeName}: deleted`);
    })
  );
}

// ===== CLI =====
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");
const doDelete = flags.has("--delete");
const langArg = args.find((a) => a.startsWith("--lang="));
const language_code = langArg ? langArg.split("=")[1] : undefined;

// ===== Main =====
(async function main() {
  if (doDelete) {
    await deleteAll({ dryRun, language_code });
    return;
  }
  await Promise.all(
    SCOPES.map((scope) =>
      setIfChanged(scope, COMMANDS, { dryRun, language_code })
    )
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
