import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRecovery, loadRecoveryPreferences, saveRecoveryPreferences, RECOVERY_KEY} from "./preferences.mjs";

test("recovery preferences keep disabled state and reject invalid timer values", () => {
  assert.deepEqual(normalizeRecovery(null), {enabled:true, delaySeconds:10});
  assert.deepEqual(normalizeRecovery({enabled:false, delaySeconds:25}), {enabled:false, delaySeconds:25});
  for (const delaySeconds of [0,301,1.5,NaN,"10"]) assert.throws(()=>normalizeRecovery({enabled:true,delaySeconds}));
});
test("browser persistence reloads preferences and failed writes retain the previous value", async () => {
  const previousStorage=globalThis.localStorage;
  const previousWindow=globalThis.window;
  const values=new Map(); let fail=false;
  globalThis.window=/** @type {Window & typeof globalThis} */ ({});
  globalThis.localStorage=/** @type {Storage} */ ({getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(fail)throw Error("fixture write failure");values.set(key,value);}});
  try {
    await saveRecoveryPreferences({enabled:false,delaySeconds:30});
    assert.deepEqual(await loadRecoveryPreferences(),{enabled:false,delaySeconds:30});
    fail=true;
    await assert.rejects(saveRecoveryPreferences({enabled:true,delaySeconds:15}));
    assert.equal(JSON.parse(values.get(RECOVERY_KEY)).delaySeconds,30);
  } finally {globalThis.localStorage=previousStorage;globalThis.window=previousWindow;}
});
