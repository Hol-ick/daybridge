import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('packaged memo has one native surface: the large archive',()=>{
  const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  assert.deepEqual(config.app.windows.map(window=>window.label).sort(),['archive','dashboard','overlay']);
  const archive=config.app.windows.find(window=>window.label==='archive');
  assert.ok(archive.width>=900&&archive.height>=720);
  const permission=JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json',import.meta.url),'utf8'));
  assert.equal(permission.windows.includes('memo'),false);
  assert.equal(permission.windows.includes('archive'),true);
});
