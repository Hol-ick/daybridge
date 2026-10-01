import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {discoverTestFiles, runTestFiles} from "./test-all.mjs";

test("full runner discovers nested suites and propagates an actual failing test exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "daybridge-test-runner-"));
  try {
    await mkdir(join(root, "src", "nested"), {recursive: true});
    await mkdir(join(root, "scripts", "node_modules"), {recursive: true});
    const pass = join(root, "src", "nested", "pass.test.mjs");
    const fail = join(root, "scripts", "fail.test.mjs");
    await writeFile(pass, 'import test from "node:test"; test("fixture passes", () => {});');
    await writeFile(fail, 'import test from "node:test"; test("fixture fails", () => {throw new Error("expected fixture failure")});');
    await writeFile(join(root, "scripts", "node_modules", "excluded.test.mjs"), 'throw new Error("must not run")');
    const files = await discoverTestFiles(root);
    assert.deepEqual(files, [fail, pass].sort());
    assert.equal(runTestFiles([pass], {cwd: root, stdio: "pipe"}), 0);
    assert.equal(runTestFiles(files, {cwd: root, stdio: "pipe"}), 1);
    assert.throws(() => runTestFiles([], {cwd: root, stdio: "pipe"}), /No Daybridge/);
  } finally {await rm(root, {recursive: true, force: true});}
});
