// src/lib/base.ts
export function resolveBase(env: NodeJS.ProcessEnv, fallbackHost?: string) {
  // 1순위: 명시 BASE_URL
  if (env.BASE_URL) return env.BASE_URL.replace(/\/$/, "");
  // 2순위: 개발용
  if (fallbackHost) return `https://${fallbackHost}`;
  return "http://localhost:3000";
}
