import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
let stopping = false;

function start(name, args) {
  const child = spawn(pnpm, args, { stdio: "inherit", shell: false });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[${name}] stopped${signal ? ` (${signal})` : ` (exit ${code ?? 0})`}.`);
    shutdown(code && code !== 0 ? code : 0);
  });
  child.on("error", () => {
    if (!stopping) shutdown(1);
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGINT");
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Daybridge 개발 모드: UI http://127.0.0.1:5173 · bridge http://127.0.0.1:39393");
start("ui", ["dev", "--", "--host", "127.0.0.1"]);
start("bridge", ["bridge"]);
