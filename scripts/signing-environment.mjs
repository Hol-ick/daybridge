import {existsSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

export function signingEnvironment(env = process.env) {
  if (env.TAURI_SIGNING_PRIVATE_KEY) return {...env};
  if (process.platform !== "win32") return {...env};
  const protectedKey = join(env.LOCALAPPDATA, "DaybridgeDeveloper", "update-key.dpapi");
  if (!existsSync(protectedKey)) return {...env};
  const script = "$ErrorActionPreference='Stop';$s=Get-Content -LiteralPath $env:DAYBRIDGE_PROTECTED_SIGNING_KEY -Raw|ConvertTo-SecureString;$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}";
  const childEnv={...env,DAYBRIDGE_PROTECTED_SIGNING_KEY:protectedKey};
  delete childEnv.PSModulePath;
  let key;
  try { key = execFileSync(join(env.SystemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoLogo","-NoProfile","-NonInteractive","-Command",script],
    {env:childEnv,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]});
  } catch { throw new Error("Cannot unlock the local update signing key"); }
  return {...env, TAURI_SIGNING_PRIVATE_KEY:key.trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD:""};
}
