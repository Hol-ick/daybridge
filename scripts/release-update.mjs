import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {resolve, join} from "node:path";
import {pathToFileURL} from "node:url";

export function compareVersions(a, b) {
  const parse = value => {
    assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    return value.split(".").map(BigInt);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export function updateManifest({version, previousVersion = "0.1.0", signature, receipt, installer, url}) {
  assert(compareVersions(version, previousVersion) > 0, "Release must advance the version");
  assert.equal(receipt.state, "payload_verified");
  assert.equal(receipt.installerSha256, createHash("sha256").update(installer).digest("hex"));
  const checks = Object.values(receipt.packageExecution?.checks ?? {});
  assert(checks.length >= 10 && checks.every(value => value === true), "Package execution has not passed");
  assert(signature.trim().length > 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(signature), "Missing updater signature");
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "github.com");
  assert.equal(parsed.pathname, `/Hol-ick/daybridge/releases/download/v${version}/Daybridge_${version}_x64-setup.exe`);
  assert(!parsed.search && !parsed.hash && !parsed.username && !parsed.password);
  return {version, notes: `Daybridge ${version}`, pub_date: new Date().toISOString(), platforms: {
    "windows-x86_64": {url, signature: signature.trim()},
  }};
}

async function prepare() {
  const count = execFileSync("git", ["rev-list", "--count", "HEAD"], {encoding: "utf8"}).trim();
  console.log(await prepareVersion(process.cwd(), count));
}

export async function prepareVersion(root, count) {
  assert.match(count, /^[1-9]\d*$/);
  const pkg = JSON.parse(await readFile(join(root,"package.json"), "utf8"));
  const [major,minor] = pkg.version.split(".");
  const version = `${major}.${minor}.${count}`;
  pkg.version = version;
  await writeFile(join(root,"package.json"), JSON.stringify(pkg, null, 2) + "\n");
  const config = JSON.parse(await readFile(join(root,"src-tauri/tauri.conf.json"), "utf8"));
  config.version = version;
  await writeFile(join(root,"src-tauri/tauri.conf.json"), JSON.stringify(config, null, 2) + "\n");
  const cargo = (await readFile(join(root,"src-tauri/Cargo.toml"), "utf8")).replaceAll("\r\n","\n");
  await writeFile(join(root,"src-tauri/Cargo.toml"), cargo.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+/, (_,prefix)=>prefix+version));
  const lock = (await readFile(join(root,"src-tauri/Cargo.lock"), "utf8")).replaceAll("\r\n","\n");
  await writeFile(join(root,"src-tauri/Cargo.lock"), lock.replace(/(name = "daybridge"\nversion = ")[^"]+/, (_,prefix)=>prefix+version));
  return version;
}

async function generate() {
  const {version} = JSON.parse(await readFile("package.json", "utf8"));
  const name = `Daybridge_${version}_x64-setup.exe`;
  const path = join("src-tauri/target/package/release/bundle/nsis", name);
  const manifest = updateManifest({version, previousVersion: process.env.PREVIOUS_RELEASE_VERSION || "0.1.0",
    installer: await readFile(path), signature: await readFile(path + ".sig", "utf8"),
    receipt: JSON.parse(await readFile("test-artifacts/installer-payload.json", "utf8")),
    url: `https://github.com/Hol-ick/daybridge/releases/download/v${version}/${name}`});
  await mkdir("test-artifacts/release", {recursive: true});
  await writeFile("test-artifacts/release/latest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Verified update manifest ${version}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === "prepare") await prepare();
  else if (process.argv[2] === "manifest") await generate();
  else throw new Error("Use prepare or manifest");
}
