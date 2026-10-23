import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {compareVersions, updateManifest, prepareVersion} from "./release-update.mjs";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
const installer = Buffer.from("isolated signed installer fixture");
const valid = () => ({version:"0.2.12", previousVersion:"0.2.9", installer,
  signature:Buffer.alloc(180, 7).toString("base64"),
  receipt:{state:"payload_verified", installerSha256:createHash("sha256").update(installer).digest("hex"), packageExecution:{checks:Object.fromEntries(Array.from({length:10},(_,i)=>[i,true]))}},
  url:"https://github.com/Hol-ick/daybridge/releases/download/v0.2.12/Daybridge_0.2.12_x64-setup.exe"});
test("only verified payloads can become a newer signed Windows release", () => {
  assert.equal(updateManifest(valid()).platforms["windows-x86_64"].url,valid().url);
  assert.equal(compareVersions("0.2.10","0.2.9"),1);
  for (const mutate of [v=>v.version="0.2.9",v=>v.signature="",v=>v.installer=Buffer.from("changed"),
    v=>v.receipt.state="failed",v=>v.receipt.packageExecution.checks[0]=false,
    v=>v.url=v.url.replace("github.com","example.com"),v=>v.url=v.url.replace("v0.2.12/","v0.2.9/")]) {
    const value=valid(); mutate(value); assert.throws(()=>updateManifest(value));
  }
});
test("CI version changes agree across JSON, Cargo and CRLF lockfiles", async()=>{
  const root=await mkdtemp(join(tmpdir(),"daybridge-release-version-"));
  try {
    await mkdir(join(root,"src-tauri"));
    await writeFile(join(root,"package.json"),'{"version":"0.2.0"}');
    await writeFile(join(root,"src-tauri/tauri.conf.json"),'{"version":"0.2.0"}');
    await writeFile(join(root,"src-tauri/Cargo.toml"),'[package]\r\nname = "daybridge"\r\nversion = "0.2.0"\r\n');
    await writeFile(join(root,"src-tauri/Cargo.lock"),'[[package]]\r\nname = "daybridge"\r\nversion = "0.2.0"\r\n');
    assert.equal(await prepareVersion(root,"217"),"0.2.217");
    for(const path of ["package.json","src-tauri/tauri.conf.json","src-tauri/Cargo.toml","src-tauri/Cargo.lock"]){
      assert((await readFile(join(root,path),"utf8")).includes("0.2.217"));
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
