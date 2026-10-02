/** @typedef {{id:string,title:string,preview:string,createdAtUnixMs:number,updatedAtUnixMs:number}} Item */
/** @typedef {{id:string,text:string,revision:number,createdAtUnixMs:number,updatedAtUnixMs:number}} Memo */
/** @typedef {{items:Item[],total:number,invalidCount:number,nextOffset:number|null}} Page */
/** @typedef {{list:(offset:number)=>Promise<Page>,read:(id:string)=>Promise<Memo>,remove:(id:string)=>Promise<unknown>,export:(id:string)=>Promise<{saved?:boolean,removed?:boolean}>}} Api */
/** @typedef {{items:Item[],selected:Memo|null,loading:boolean,busy:boolean,error:string,nextOffset:number|null,invalidCount:number}} View */

/** @param {Api} api @param {(view:View)=>void} changed */
export function createArchiveController(api, changed) {
  /** @type {View} */
  let view={items:[],selected:null,loading:false,busy:false,error:"",nextOffset:null,invalidCount:0};
  let epoch=0, disposed=false;
  const publish=()=>{if(!disposed) changed({...view,items:[...view.items]});};
  async function load(more=false) {
    if(view.busy || view.loading) return;
    view.loading=true;view.error="";publish();
    try {const page=await api.list(more ? view.nextOffset ?? 0 : 0);view.items=more ? [...view.items,...page.items] : page.items;view.nextOffset=page.nextOffset;view.invalidCount=page.invalidCount;}
    catch {view.error="메모 목록을 불러오지 못했어요";}
    finally {view.loading=false;publish();}
  }
  /** @param {string} id */
  async function select(id) {
    if(view.busy) return;
    const request=++epoch;view.selected=null;view.error="";publish();
    try {const memo=await api.read(id);if(request===epoch && !disposed){view.selected=memo;publish();}}
    catch {if(request===epoch){view.error="메모를 읽지 못했어요";publish();}}
  }
  /** @template T @param {()=>Promise<T>} action @returns {Promise<T|undefined>} */
  async function perform(action) {
    if(view.busy) return undefined;
    view.busy=true;view.error="";publish();
    try {return await action();}
    catch(error){view.error="처리를 확인하지 못했어요. 다시 시도해 주세요";throw error;}
    finally{view.busy=false;publish();}
  }
  /** @param {string} id */
  async function remove(id) {
    const result=await perform(async()=>{await api.remove(id);++epoch;view.items=view.items.filter(item=>item.id!==id);view.selected=null;return true;});
    if(result) await load();
    return result;
  }
  /** @param {string} id */
  async function exportMemo(id) {
    const result=await perform(()=>api.export(id));
    if(result?.removed){++epoch;view.items=view.items.filter(item=>item.id!==id);view.selected=null;await load();}
    return result;
  }
  return {load,select,perform,remove,exportMemo,activate(){disposed=false;},dispose(){disposed=true;++epoch;}};
}
