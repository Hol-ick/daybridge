import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyPackage} from "./verify-package.mjs";

export function archiveMembers(listing) {
  assert.match(listing, /^Type = Nsis\r?$/m, "The artifact is not an NSIS installer");
  const separator = listing.indexOf("----------");
  assert(separator >= 0, "Installer inventory is missing");
  const names = [...listing.slice(separator).matchAll(/^Path = (.+)\r?$/gm)].map(match => match[1].trim());
  assert(names.length > 0 && names.length < 5000, "Installer inventory size is invalid");
  const normalized = new Set();
  for (const name of names) {
    const parts = name.replaceAll("\\", "/").split("/");
    assert(!name.startsWith("/") && !name.startsWith("\\") && !name.includes(":"), "Absolute or alternate-stream installer entry is forbidden");
    assert(parts.every(part => part && part !== "." && part !== ".." && !/[ .]$/.test(part)), "Unsafe installer entry is forbidden");
    const key = parts.join("/").toLowerCase();
    assert(!normalized.has(key), "Duplicate installer entry is forbidden");
    normalized.add(key);
  }
  for (const required of ["daybridge.exe", "bridge-runtime/node.exe", "bridge-runtime/package.json", "bridge-runtime/runtime-manifest.json", "bridge-runtime/scripts/local-bridge.mjs", "bridge-runtime/third_party_notices.txt"]) assert(normalized.has(required), "Installer is missing a required runtime file");
  return names;
}

export async function verifyInstaller({installerPath, sevenZipExecutable = join(process.env.ProgramFiles, "7-Zip/7z.exe")}) {
  const installer = resolve(installerPath);
  const bytes = await readFile(installer);
  const listing = execFileSync(sevenZipExecutable, ["l", "-slt", installer], {encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true});
  const members = archiveMembers(listing);
  const root = await mkdtemp(join(tmpdir(), "daybridge-installer-payload-"));
  try {
    execFileSync(sevenZipExecutable, ["x", "-y", `-o${root}`, installer], {encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true});
    const execution = await verifyPackage({executablePath: join(root, "daybridge.exe")});
    return {schemaVersion: 1, state: "payload_verified", installerSha256: createHash("sha256").update(bytes).digest("hex"), installerBytes: bytes.length, memberCount: members.length, packageExecution: execution, installationExecuted: false, loginVerified: false, installerVerified: false};
  } finally {await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/verify-installer.mjs <NSIS-installer>");
  const receipt = await verifyInstaller({installerPath: process.argv[2]});
  await mkdir("test-artifacts", {recursive: true});
  await writeFile("test-artifacts/installer-payload.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}
