import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

test("type checking includes every runtime JS/JSX and does not hide them with file suppression", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const checked = execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "--listFilesOnly", "--pretty", "false"], { cwd: root, encoding: "utf8" }).replaceAll("\\", "/");
  const runtimeFiles = readdirSync(resolve(root, "src"), { recursive: true }).filter(path => /\.(?:jsx?|tsx?)$/.test(path));
  for (const path of runtimeFiles) {
    const absolute = resolve(root, "src", path);
    assert.ok(checked.includes(absolute.replaceAll("\\", "/")), `not checked: src/${path}`);
    assert.ok(!readFileSync(absolute, "utf8").includes("@ts-nocheck"), `suppressed: src/${path}`);
  }
  const options = JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8")).compilerOptions;
  assert.equal(options.allowJs, true);
  assert.equal(options.checkJs, true);
});
