import { KO_MESSAGES } from './messages/ko';
import { handleSectorCommand } from './commands/sector';
export async function routeMessage(text: string, ctx: { chatId: number }, tgSend: any) {
  const t = text.trim();
  if (t === '/start') return tgSend('sendMessage', { chat_id: ctx.chatId, text: KO_MESSAGES.START });
  if (t === '/help') return tgSend('sendMessage', { chat_id: ctx.chatId, text: KO_MESSAGES.HELP });
  if (t === '/sector') return handleSectorCommand(ctx, tgSend);
  return tgSend('sendMessage', { chat_id: ctx.chatId, text: KO_MESSAGES.UNKNOWN_COMMAND });
}
export async function routeCallback(data: string, ctx: { chatId: number }, tgSend: any) {
  if (data.startsWith('sector:')) {
    const name = data.split(':').slice(1).join(':');
    return tgSend('sendMessage', { chat_id: ctx.chatId, text: `섹터 "${name}" 선택됨 (다음 단계에서 /stocks 연결)` });
  }
  return tgSend('sendMessage', { chat_id: ctx.chatId, text: '알 수 없는 버튼입니다.' });
}
