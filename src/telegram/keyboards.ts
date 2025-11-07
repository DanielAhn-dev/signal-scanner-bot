export type InlineButton = { text: string; callback_data: string; };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export function createInlineKeyboard(buttons: InlineButton[][]): InlineKeyboard { return { inline_keyboard: buttons }; }
export function createMultiRowKeyboard(n: number, btns: InlineButton[]): InlineKeyboard {
  const rows: InlineButton[][] = []; for (let i=0;i<btns.length;i+=n) rows.push(btns.slice(i,i+n)); return { inline_keyboard: rows };
}
