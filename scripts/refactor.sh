# 1) 리네임: packages -> src
git mv packages src 2>/dev/null || mv packages src

# 2) 필요한 하위 폴더 생성
mkdir -p src/adapters/krx \
         src/adapters \
         src/cache \
         src/search \
         src/data \
         src/indicators \
         src/score \
         src/bot/commands \
         src/bot/messages \
         src/telegram

# 3) 파일 이동(존재하는 경우에만)
[ -f src/data/krx-client.ts ] || { [ -f src/data/krx-client.ts ] || true; }
[ -f src/krx-client.ts ] && mv src/krx-client.ts src/adapters/krx/client.ts 2>/dev/null
[ -f src/data/krx-client.ts ] && mv src/data/krx-client.ts src/adapters/krx/client.ts 2>/dev/null
[ -f src/data/adapter.ts ] && mv src/data/adapter.ts src/adapters/index.ts 2>/dev/null
[ -f src/data/cache.ts ] && mv src/data/cache.ts src/cache/memory.ts 2>/dev/null
[ -f src/data/search.ts ] && mv src/data/search.ts src/search/normalize.ts 2>/dev/null
[ -f src/data/types.ts ] || true  # 이미 경로가 맞으면 패스
[ -f src/indicators/index.ts ] || true
[ -d src/indicators ] || true
[ -d src/scoring ] && mv src/scoring src/score 2>/dev/null

# 4) indicators·score 파일 이동(패턴)
for f in avwap.ts roc.ts rsi.ts sma.ts index.ts; do
  [ -f src/indicators/$f ] || { [ -f src/indicators/$f ] || true; }
done
[ -f src/score/engine.ts ] || { [ -f src/scoring/engine.ts ] && mv src/scoring/engine.ts src/score/engine.ts; }

# 5) 불필요 스크립트 삭제
[ -f scripts/setCommands.js ] && git rm -f scripts/setCommands.js || rm -f scripts/setCommands.js

# 6) 새 스텁 파일 생성(없는 경우에만)
[ -f src/telegram/keyboards.ts ] || cat > src/telegram/keyboards.ts <<'TS'
export type InlineButton = { text: string; callback_data: string; };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export function createInlineKeyboard(buttons: InlineButton[][]): InlineKeyboard { return { inline_keyboard: buttons }; }
export function createMultiRowKeyboard(n: number, btns: InlineButton[]): InlineKeyboard {
  const rows: InlineButton[][] = []; for (let i=0;i<btns.length;i+=n) rows.push(btns.slice(i,i+n)); return { inline_keyboard: rows };
}
TS

[ -f src/bot/messages/ko.ts ] || cat > src/bot/messages/ko.ts <<'TS'
export const KO_MESSAGES = {
  START: '구독이 시작되었습니다. /sector, /stocks <섹터>, /score <이름|코드>를 사용할 수 있습니다.',
  HELP: '도움말: /sector, /stocks <섹터>, /score <이름|코드>',
  UNKNOWN_COMMAND: '알 수 없는 명령입니다.',
  SECTOR_ERROR: '섹터 데이터 수집 오류가 발생했습니다.',
};
TS

[ -f src/bot/commands/sector.ts ] || cat > src/bot/commands/sector.ts <<'TS'
import { createMultiRowKeyboard } from '../../telegram/keyboards';
export async function handleSectorCommand(ctx: { chatId: number }, tgSend: any) {
  const sample = ['반도체','2차전지','바이오'].map((n)=>({text:`${n}`,callback_data:`sector:${n}`}));
  await tgSend('sendMessage',{ chat_id: ctx.chatId, text:'유망 섹터(샘플):', reply_markup: createMultiRowKeyboard(2, sample) });
}
TS

[ -f src/bot/router.ts ] || cat > src/bot/router.ts <<'TS'
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
TS

[ -f src/cache/keys.ts ] || cat > src/cache/keys.ts <<'TS'
export const cacheKey = {
  sectorTop: () => `sector:top`,
  stocksBySector: (s:string) => `stocks:${s}`,
  scoreByCode: (c:string) => `score:${c}`,
};
TS

# 7) dist 폴더 정리(커밋 제거 권장)
[ -d dist ] && git rm -r -f dist || rm -rf dist

echo "DONE"
