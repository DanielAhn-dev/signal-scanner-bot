// api/index.ts
// 헬스체크 + 배포 시 봇 명령어 자동 등록

let commandsRegistered = false;

export default async function handler(_: any, res: any) {
  // 콜드 스타트 시 1회만 명령어 등록
  if (!commandsRegistered && process.env.TELEGRAM_BOT_TOKEN) {
    commandsRegistered = true;
    try {
      const { setCommandsKo } = await import("../src/telegram/api.js");
      const result = await setCommandsKo();
      console.log("[auto-init] setCommandsKo:", result.ok ? "OK" : "FAIL");
    } catch (e) {
      console.error("[auto-init] setCommandsKo error:", e);
    }
  }
  res.status(200).send("ok");
}
