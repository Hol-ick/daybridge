import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {rolldown} from "rolldown";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedNode = Object.freeze({version: "v24.19.0", platform: "win32", arch: "x64"});
const nodeLicenseHash = "148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5";
const digest = data => createHash("sha256").update(data).digest("hex");

async function dependencyNotices(moduleIds) {
  const packages = new Map();
  for (const id of moduleIds) {
    if (!id.includes("node_modules") || id.startsWith("\0")) continue;
    let directory = dirname(id);
    while (directory !== dirname(directory)) {
      let info;
      try { info = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
      if (info?.name && info.version) {
        const key = `${info.name}@${info.version}`;
        if (!packages.has(key)) {
          const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name)).sort();
          if (files.length === 0 && key === "data-uri-to-buffer@4.0.1") {
            const readme = await readFile(join(directory, "README.md"), "utf8");
            if (!readme.includes("Copyright (c) 2014 Nathan Rajlich") || !readme.includes("Permission is hereby granted")) throw new Error(`License text missing for ${key}`);
            files.push("README.md");
          }
          if (files.length === 0) throw new Error(`License text missing for ${key}`);
          const texts = await Promise.all(files.map(async name => `${name}\n${await readFile(join(directory, name), "utf8")}`));
          packages.set(key, {name: info.name, version: info.version, license: info.license || "SEE LICENSE", texts});
        }
        break;
      }
      directory = dirname(directory);
    }
  }
  return [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

/** Create a new, explicit output directory. Existing artifacts are never overwritten. */
export async function prepareBridgeRuntime({nodeExecutable, outputDir}) {
  if (!nodeExecutable || !outputDir) throw new TypeError("nodeExecutable and outputDir are required");
  const node = JSON.parse(execFileSync(resolve(nodeExecutable), ["-p", "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})"], {encoding: "utf8", timeout: 5000}));
  if (JSON.stringify(node) !== JSON.stringify(expectedNode)) throw new Error("Bridge packaging requires Node v24.19.0 for Windows x64");
  const license = await readFile(new URL("./packaging/node-v24.19.0-LICENSE.txt", import.meta.url));
  if (digest(license) !== nodeLicenseHash) throw new Error("Node license checksum mismatch");
  const bundler = JSON.parse(await readFile(new URL("../node_modules/rolldown/package.json", import.meta.url), "utf8"));
  if (bundler.version !== "1.2.1") throw new Error("Bridge packaging requires rolldown 1.2.1");
  const executableBytes = await readFile(resolve(nodeExecutable));
  if (executableBytes.subarray(0, 2).toString() !== "MZ") throw new Error("Node executable must be a Windows PE file");
  const root = resolve(outputDir);
  await mkdir(dirname(root), {recursive: true});
  try { await mkdir(root); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Bridge runtime output already exists", {cause: error}); throw error; }
  await mkdir(join(root, "scripts"));
  const build = await rolldown({input: join(projectRoot, "scripts/local-bridge.mjs"), cwd: projectRoot, platform: "node"});
  let output;
  try {
    ({output} = await build.write({file: join(root, "scripts/local-bridge.mjs"), format: "esm", codeSplitting: false, sourcemap: false, comments: {legal: true, annotation: false, jsdoc: false}}));
  } finally { await build.close(); }
  const chunk = output.find(item => item.type === "chunk");
  if (!chunk || output.length !== 1 || chunk.imports.some(id => !id.startsWith("node:"))) throw new Error("Bridge bundle contains unexpected external files or dependencies");
  const dependencies = await dependencyNotices(Object.keys(chunk.modules));
  const info = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  await copyFile(resolve(nodeExecutable), join(root, "node.exe"));
  await writeFile(join(root, "package.json"), JSON.stringify({name: "daybridge-bridge-runtime", version: info.version, private: true, type: "module"}, null, 2) + "\n");
  const attribution = await readFile(join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  const notices = [attribution, `Node.js ${node.version}\nSource: https://github.com/nodejs/node/blob/${node.version}/LICENSE\n\n${license}`, ...dependencies.map(item => `${item.name}@${item.version} (${item.license})\n\n${item.texts.join("\n\n")}`)];
  await writeFile(join(root, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n----------------------------------------\n\n"));
  const files = {};
  for (const name of ["node.exe", "package.json", "scripts/local-bridge.mjs", "THIRD_PARTY_NOTICES.txt"]) {
    const bytes = await readFile(join(root, name));
    files[name] = {sha256: digest(bytes), bytes: bytes.length};
  }
  const manifest = {schemaVersion: 1, applicationVersion: info.version, node, bundler: {name: bundler.name, version: bundler.version}, dependencies: dependencies.map(({texts, ...item}) => item), files};
  await writeFile(join(root, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function verifyGeneratedRuntime(target) {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Existing bridge runtime is not a managed directory");
    if ((await lstat(join(target, "scripts"))).isSymbolicLink() || (await lstat(join(target, "runtime-manifest.json"))).isSymbolicLink()) throw new Error("Existing bridge runtime contains linked metadata or scripts");
    const manifest = JSON.parse(await readFile(join(target, "runtime-manifest.json"), "utf8"));
    const files = ["node.exe", "package.json", "scripts/local-bridge.mjs", "THIRD_PARTY_NOTICES.txt"];
    const names = (await readdir(target)).sort();
    if (manifest.schemaVersion !== 1 || JSON.stringify(names) !== JSON.stringify(["node.exe", "package.json", "runtime-manifest.json", "scripts", "THIRD_PARTY_NOTICES.txt"].sort())) throw new Error("Existing bridge runtime contains unmanaged files");
    if (JSON.stringify((await readdir(join(target, "scripts"))).sort()) !== JSON.stringify(["local-bridge.mjs"])) throw new Error("Existing bridge runtime contains unmanaged scripts");
    for (const name of files) {
      if ((await lstat(join(target, name))).isSymbolicLink()) throw new Error("Existing bridge runtime contains a linked file");
      const data = await readFile(join(target, name));
      if (manifest.files?.[name]?.sha256 !== digest(data) || manifest.files[name].bytes !== data.length) throw new Error("Existing bridge runtime checksum mismatch; preserve it for inspection");
    }
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    if (pkg.name !== "daybridge-bridge-runtime") throw new Error("Existing bridge runtime is not a managed package");
}

/** Replace only a complete, verified artifact that this packager previously generated. */
export async function prepareTauriBridgeRuntime({nodeExecutable, resourceDirectory = join(projectRoot, "src-tauri/resources")}) {
  const resources = resolve(resourceDirectory);
  await mkdir(resources, {recursive: true});
  const target = join(resources, "bridge-runtime");
  let existing = false;
  try {await verifyGeneratedRuntime(target); existing = true;}
  catch (error) {if (error.code !== "ENOENT" || (await lstat(target).catch(() => null))) throw error;}
  const stage = await mkdtemp(join(resources, ".bridge-build-"));
  const next = join(stage, "next");
  const previous = join(stage, "previous");
  let moved = false;
  let published = false;
  try {
    const manifest = await prepareBridgeRuntime({nodeExecutable, outputDir: next});
    if (existing) {
      await rename(target, previous);
      moved = true;
      // Recheck after moving: edits made while bundling must also be preserved.
      await verifyGeneratedRuntime(previous);
    }
    await rename(next, target);
    published = true;
    return manifest;
  } finally {
    if (moved && !published) await rename(previous, target);
    // stage is a fresh child created above; no user-supplied deletion path is used.
    await rm(stage, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const outputDir = process.argv[2];
  if (!outputDir) throw new Error("Usage: node scripts/package-bridge.mjs <new-output-directory> | --tauri");
  const manifest = outputDir === "--tauri"
    ? await prepareTauriBridgeRuntime({nodeExecutable: process.execPath})
    : await prepareBridgeRuntime({nodeExecutable: process.execPath, outputDir});
  console.log(JSON.stringify({node: manifest.node, dependencies: manifest.dependencies.length, files: manifest.files}, null, 2));
}
