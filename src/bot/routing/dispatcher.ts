import { COMMAND_ROUTE_SPECS } from "./commandRoutes";
import type { ChatContext, CommandRouteSpec } from "./types";

const SEND_ERR = (cmd: string) =>
  `⚠️ ${cmd} 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;

async function runWithUserError(
  ctx: ChatContext,
  tgSend: any,
  commandLabel: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: SEND_ERR(commandLabel),
    });
  }
}

const COMMAND_ROUTE_INDEX = new Map<string, CommandRouteSpec[]>();

for (const route of COMMAND_ROUTE_SPECS) {
  for (const token of route.tokens ?? []) {
    const normalized = token.toLowerCase();
    const existing = COMMAND_ROUTE_INDEX.get(normalized);
    if (existing) {
      existing.push(route);
    } else {
      COMMAND_ROUTE_INDEX.set(normalized, [route]);
    }
  }
}

function extractPrimaryToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/, 1)[0] ?? "";
  if (!first) return null;
  return first.replace(/^\//, "").toLowerCase();
}

async function executeMatchedRoute(
  route: CommandRouteSpec,
  match: RegExpMatchArray,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  if (route.userErrorLabel) {
    await runWithUserError(ctx, tgSend, route.userErrorLabel, () =>
      route.run(match, ctx, tgSend)
    );
    return;
  }

  await route.run(match, ctx, tgSend);
}

export async function dispatchCommandRoutes(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<boolean> {
  const token = extractPrimaryToken(text);
  const indexedRoutes = token ? COMMAND_ROUTE_INDEX.get(token) : undefined;
  const tried = new Set<CommandRouteSpec>();

  for (const route of indexedRoutes ?? []) {
    tried.add(route);
    const match = text.match(route.pattern);
    if (!match) continue;

    await executeMatchedRoute(route, match, ctx, tgSend);
    return true;
  }

  for (const route of COMMAND_ROUTE_SPECS) {
    if (tried.has(route)) continue;
    const match = text.match(route.pattern);
    if (!match) continue;

    await executeMatchedRoute(route, match, ctx, tgSend);
    return true;
  }

  return false;
}
