import {invoke,isTauri} from '@tauri-apps/api/core';
import {PREVIEW_KEY} from './preview.js';

/** @returns {import('./archive-controller.js').Api} */
export function createArchiveApi() {
  if(isTauri()) return {
    list:offset=>invoke('list_memo_archives',{offset}), read:id=>invoke('read_memo_archive',{id}),
    remove:id=>invoke('delete_memo_archive',{id}),restore:id=>invoke('restore_memo_archive',{id}),export:id=>invoke('export_memo_archive',{id}),
  };
  /** @returns {{archives:import('./archive-controller.js').Memo[],trash?:import('./archive-controller.js').Memo[]}} */
  const read=()=>JSON.parse(localStorage.getItem(PREVIEW_KEY)||'{"schemaVersion":2,"active":null,"archives":[],"lastClosed":null}');
  /** @param {ReturnType<typeof read>} state */
  const write=state=>localStorage.setItem(PREVIEW_KEY,JSON.stringify(state));
  /** @param {string} id */
  const find=id=>{const memo=read().archives.find(memo=>memo.id===id);if(!memo) throw Error('archive_not_found');return memo;};
  return {
    async list(offset){const items=read().archives.slice().sort((a,b)=>b.createdAtUnixMs-a.createdAtUnixMs).map(memo=>({...memo,title:memo.text.split('\n').find(line=>line.trim())?.slice(0,80)||'빈 메모',preview:memo.text.slice(0,160)}));return {items:items.slice(offset,offset+100),total:items.length,invalidCount:0,nextOffset:offset+100<items.length ? offset+100 : null};},
    async read(id){return find(id);},
    async remove(id){find(id);const state=read();state.trash??=[];state.trash.push(...state.archives.filter(memo=>memo.id===id));state.archives=state.archives.filter(memo=>memo.id!==id);write(state);},
    async restore(id){const state=read();const memo=state.trash?.find(memo=>memo.id===id);if(!memo) throw Error('archive_not_found');state.archives.push(memo);state.trash=state.trash?.filter(memo=>memo.id!==id);write(state);},
    async export(id){const memo=find(id);const url=URL.createObjectURL(new Blob([memo.text],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='daybridge-memo.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {saved:true};},
  };
}
