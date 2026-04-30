export const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;

export async function sendLongMessage(
  tgSend: (method: string, body: any) => Promise<any>,
  chatId: number,
  text: string,
  opts?: { parse_mode?: string; reply_markup?: any; chunkSize?: number }
): Promise<void> {
  const chunkSize = opts?.chunkSize ?? MAX_TELEGRAM_MESSAGE_LENGTH;
  const raw = String(text ?? "");
  if (raw.length <= chunkSize) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: raw,
      ...(opts?.parse_mode ? { parse_mode: opts.parse_mode } : {}),
      ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    });
    return;
  }

  // Prefer splitting on double-newline or newline boundaries for readability
  const parts: string[] = [];
  let remaining = raw;
  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      parts.push(remaining);
      break;
    }

    // try split at last double newline within chunk
    const candidate = remaining.slice(0, chunkSize);
    let splitAt = candidate.lastIndexOf("\n\n");
    if (splitAt < 0) splitAt = candidate.lastIndexOf("\n");
    if (splitAt < 0) splitAt = chunkSize;

    const part = remaining.slice(0, splitAt).trimEnd();
    parts.push(part);
    remaining = remaining.slice(splitAt).trimStart();
  }

  for (let i = 0; i < parts.length; i++) {
    const body: any = {
      chat_id: chatId,
      text: parts[i],
    };
    if (opts?.parse_mode) body.parse_mode = opts.parse_mode;
    // attach reply_markup only to the last chunk (so buttons appear once)
    if (i === parts.length - 1 && opts?.reply_markup) body.reply_markup = opts.reply_markup;
    await tgSend("sendMessage", body);
  }
}
