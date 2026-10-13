import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PALETTES,normalizeAppearance,paletteFor} from './palettes.js';
function luminance(hex){const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('palette settings accept only known IDs and preserve safe legacy choices',()=>{
  assert.deepEqual(normalizeAppearance({accent:'#62dca5'}),{paletteId:'ocean'});
  for(const value of [null,[], 'rose', {paletteId:'missing'}, {paletteId:'url(secrets)'}])assert.deepEqual(normalizeAppearance(value),{paletteId:'midnight'});
  for(const p of PALETTES)assert.equal(paletteFor({paletteId:p.id}).id,p.id);
});
test('every palette keeps normal text, muted text, paper and action labels readable',()=>{
  assert.equal(new Set(PALETTES.map(p=>p.id)).size,6);
  for(const p of PALETTES)for(const [a,b] of [['ink','canvas'],['ink','surface'],['muted','surface'],['accent','surface'],['onAccent','accent'],['paperInk','paper']]){
    assert.ok(contrast(p[a],p[b])>=4.5,`${p.id}: ${a}/${b} ${contrast(p[a],p[b])}`);
  }
});
test('management chrome has one app title bar and keeps native dismissal semantics',()=>{
  const config=JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json',import.meta.url)));
  assert.equal(config.app.windows.find(w=>w.label==='dashboard').decorations,false);
  const main=readFileSync(new URL('../../src-tauri/src/main.rs',import.meta.url),'utf8');
  assert.match(main,/\.title\("Daybridge 관리"\)\s*\.decorations\(false\)/);
  assert.match(main,/Window dismissal must leave the tray and global memo shortcut alive/);
  const permissions=JSON.parse(readFileSync(new URL('../../src-tauri/capabilities/default.json',import.meta.url))).permissions;
  for(const method of ['close','minimize','toggle-maximize','start-dragging'])assert(permissions.includes(`core:window:allow-${method}`));
});
