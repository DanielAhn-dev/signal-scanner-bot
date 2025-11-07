import { createMultiRowKeyboard } from '../../telegram/keyboards';
export async function handleSectorCommand(ctx: { chatId: number }, tgSend: any) {
  const sample = ['반도체','2차전지','바이오'].map((n)=>({text:`${n}`,callback_data:`sector:${n}`}));
  await tgSend('sendMessage',{ chat_id: ctx.chatId, text:'유망 섹터(샘플):', reply_markup: createMultiRowKeyboard(2, sample) });
}
