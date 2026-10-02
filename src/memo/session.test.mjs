import test from "node:test";
import assert from "node:assert/strict";
import { createMemoSession } from "./session.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let active = null, sequence = 0, now = 0, timerId = 0;
  const timers = new Map();
  const clock = {set(fn, ms) { const id = ++timerId; timers.set(id, {fn, at: now + ms}); return id; }, clear(id) { timers.delete(id); }};
  const api = {
    archives: [], saves: [], hidden: 0, failSave: false, failFinish: false, failHide: false,
    async begin() { active ??= {id:`m-${++sequence}`,revision:0,text:"",createdAtUnixMs:0,updatedAtUnixMs:0}; return {draft:{...active},recovered:false}; },
    async save(draft) { if (api.failSave) throw Error("write_failed"); api.saves.push({...draft}); active = {...draft}; return {id:draft.id,revision:draft.revision}; },
    async finish(draft) { if (api.failFinish) throw Error("write_failed"); if (draft.text.trim()) api.archives.push({...draft}); active = null; return {id:draft.id,revision:draft.revision,archived:!!draft.text.trim()}; },
    async hide() { if (api.failHide) throw Error("hide_failed"); api.hidden++; },
  };
  const session = createMemoSession(api, {clock});
  return {api, session, async advance(ms) { now += ms; for (const [id,timer] of [...timers]) if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); } await tick(); }};
}
test("immediate close flushes final Unicode and next open is blank", async () => {
  const {api,session} = fixture(); const first = await session.open(); session.edit("한글 최종 줄\n");
  await Promise.all([session.close("escape"), session.close("x")]);
  assert.equal(api.archives.length,1); assert.equal(api.archives[0].text,"한글 최종 줄\n"); assert.equal(api.hidden,1);
  const next = await session.open(); assert.equal(next.draft.text,""); assert.notEqual(next.draft.id,first.draft.id);
});
test("debounce coalesces typing and continuous typing saves within one second", async () => {
  const f = fixture(); await f.session.open();
  for (let i=0;i<5;i++) { f.session.edit(`내용${i}`); await f.advance(200); }
  assert.equal(f.api.saves.length,1); assert.equal(f.api.saves[0].text,"내용4");
  f.session.edit("마지막"); await f.advance(299); assert.equal(f.api.saves.length,1);
  await f.advance(1); assert.equal(f.api.saves.length,2);
});
test("save or finalize failure never hides or clears input and retry succeeds", async () => {
  for (const failure of ["failSave","failFinish"]) {
    const {api,session} = fixture(); await session.open(); session.edit("보존할 입력"); api[failure] = true;
    await assert.rejects(session.close("x")); assert.equal(api.hidden,0); assert.equal(session.draft.text,"보존할 입력");
    api[failure] = false; await session.close("retry"); assert.equal(api.archives.length,1);
  }
});
test("failed hide retries without repeating a completed archive", async () => {
  const {api,session} = fixture(); await session.open(); session.edit("한 번만 보관"); api.failHide = true;
  await assert.rejects(session.close("x")); assert.equal(api.archives.length,1); assert.equal(session.edit("새 입력"),false);
  api.failHide = false; await session.close("retry"); assert.equal(api.archives.length,1);
});
test("open while already open returns same session; open during close waits for new one", async () => {
  const {api,session} = fixture(); const first = await session.open(); session.edit("메모"); assert.equal((await session.open()).draft.id,first.draft.id);
  const closing = session.close("x"); const next = session.open(); await closing;
  assert.equal((await next).draft.text,""); assert.equal(api.archives.length,1);
});
test("blank close produces no archived file", async () => {
  const {api,session} = fixture(); await session.open(); session.edit(" \n\t"); await session.close("x"); assert.equal(api.archives.length,0);
});
test("close waits for in-flight write and archives the newest snapshot", async () => {
  const f = fixture(); let release;
  const barrier = new Promise(resolve => { release = resolve; }); const originalSave = f.api.save;
  let writes = 0;
  f.api.save = async draft => { if (++writes === 1) await barrier; return originalSave(draft); };
  await f.session.open(); f.session.edit("초기 입력"); await f.advance(300);
  f.session.edit("닫기 직전 최종 입력"); const closing = f.session.close("x");
  assert.equal(f.api.hidden,0); assert.equal(f.api.archives.length,0);
  release(); await closing;
  assert.equal(f.api.archives[0].text,"닫기 직전 최종 입력"); assert.equal(f.api.saves.at(-1).text,"닫기 직전 최종 입력");
});
test("wrong acknowledgement cannot hide the window", async () => {
  const f = fixture(); f.api.save = async draft => ({id:draft.id,revision:draft.revision - 1});
  await f.session.open(); f.session.edit("응답 검증");
  await assert.rejects(f.session.close("x"), /stale_session/);
  assert.equal(f.api.hidden,0); assert.equal(f.api.archives.length,0); assert.equal(f.session.draft.text,"응답 검증");
});
