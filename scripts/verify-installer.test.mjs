import test from "node:test";
import assert from "node:assert/strict";
import {archiveMembers} from "./verify-installer.mjs";

const files = ["daybridge.exe", "bridge-runtime\\node.exe", "bridge-runtime\\package.json", "bridge-runtime\\runtime-manifest.json", "bridge-runtime\\scripts\\local-bridge.mjs", "bridge-runtime\\THIRD_PARTY_NOTICES.txt"];
const inventory = names => "Type = Nsis\n----------\n" + names.map(name => `Path = ${name}\nSize = 1\n`).join("\n");

test("installer inventory rejects escaping, duplicate and incomplete payloads before extraction", () => {
  assert.deepEqual(archiveMembers(inventory(files)), files);
  for (const unsafe of ["..\\outside.txt", "C:\\outside.txt", "\\server\\outside.txt", "runtime:stream", "runtime.\\outside.txt"]) {
    assert.throws(() => archiveMembers(inventory([...files, unsafe])), /forbidden/);
  }
  assert.throws(() => archiveMembers(inventory([...files, "DAYBRIDGE.EXE"])), /Duplicate/);
  assert.throws(() => archiveMembers(inventory(files.slice(1))), /missing a required/);
  assert.throws(() => archiveMembers(inventory(files).replace("Type = Nsis", "Type = zip")), /not an NSIS/);
});
