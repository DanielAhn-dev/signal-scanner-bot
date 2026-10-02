// 로컬 개발 한 번에 실행: API(vercel dev, 3000) + 웹(vite, 5173)을 함께 띄운다.
//   pnpm dev:full
// 웹 개발 서버가 /api 요청을 3000번 포트로 넘기므로(web/vite.config.mts) 둘이 같이 떠야 화면이 동작한다.
// 한쪽이 먼저 죽으면 나머지도 끝낸다. Ctrl+C 한 번으로 둘 다 종료.
import { spawn, spawnSync } from "node:child_process";

const PROCS = [
  { tag: "api", args: ["local"], hint: "http://localhost:3000" },
  { tag: "web", args: ["--dir", "web", "dev"], hint: "http://localhost:5173  ← 브라우저는 이 주소" },
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    // Windows는 shell로 띄운 자식 트리까지 지워야 포트가 풀린다
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

function pipeWithTag(stream, tag, out) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) out.write(`[${tag}] ${line}\n`);
  });
}

console.log("API와 웹을 함께 시작합니다 (종료: Ctrl+C)");
for (const p of PROCS) console.log(`  [${p.tag}] ${p.hint}`);

for (const p of PROCS) {
  const child = spawn("pnpm", p.args, { shell: true, stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
  children.push(child);
  pipeWithTag(child.stdout, p.tag, process.stdout);
  pipeWithTag(child.stderr, p.tag, process.stderr);
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`[${p.tag}] 종료됨 (코드 ${code ?? "?"})`);
    if (p.tag === "api") {
      console.error("API가 시작되지 않았습니다. Vercel 로그인 계정이 이 프로젝트 소유 계정인지 확인하세요: npx vercel logout && npx vercel login");
    }
    stopAll(code ?? 1);
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
