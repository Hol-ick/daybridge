import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

/** Discover every regression suite, including nested calendar and scheduling suites. */
export async function discoverTestFiles(root = projectRoot) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !["node_modules", "test-artifacts", "dist", "target"].includes(entry.name)) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(path);
    }
  }
  await visit(join(root, "src"));
  await visit(join(root, "scripts"));
  return files.sort();
}

export function runTestFiles(files, {cwd = projectRoot, stdio = "inherit"} = {}) {
  if (!files.length) throw new Error("No Daybridge regression suites found");
  // A runner invoked by a regression test must be an independent Node runner.
  // Inheriting child-v8 switches its output/exit handling to the parent harness.
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {cwd, stdio, env});
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await discoverTestFiles();
  console.log(`Daybridge regression: ${files.length} suites (sequential, isolated fixtures)`);
  process.exitCode = runTestFiles(files);
}
