import { rename } from "node:fs/promises";

// Executable files can remain briefly locked after process exit on Windows.
export async function renameRuntime(source, target, { move = rename, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { await move(source, target); return; }
    catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 6) throw error;
      await pause(50 * 2 ** attempt);
    }
  }
}
