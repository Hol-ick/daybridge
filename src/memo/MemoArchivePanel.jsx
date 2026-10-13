import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createArchiveController} from './archive-controller.js';
import {createArchiveApi} from './archive-api.js';
import {formatArchiveTime} from './archive-presentation.js';
import {runMemoMotion} from './archive-motion.js';
import './design-tokens.css';
import './archive.css';
import {isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import MemoSurface from '../MemoSurface.jsx';

/** @param {{kind:'close'|'back'|'save'|'calendar'|'trash'|'check'}} props */
function Icon({kind}) {
  const paths={close:'m6 6 12 12M6 18 18 6',back:'m14 6-6 6 6 6',save:'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',calendar:'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',check:'m5 12 4 4L19 6'};
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[kind]}/></svg>;
}

/** @param {{onClose?:()=>void|Promise<void>,onAddTask?:import('../schedule/ui-types').AddManualTask,archiveApi?:import('./archive-controller.js').Api}} props */
export default function MemoArchivePanel({onClose,onAddTask,archiveApi}) {
  const [view,setView]=useState(/** @type {import('./archive-controller.js').View} */({items:[],selected:null,loading:false,busy:false,error:'',nextOffset:null,invalidCount:0}));
  const [api]=useState(()=>archiveApi||createArchiveApi());
  const [controller]=useState(()=>createArchiveController(api,setView));
  const [scheduleTitle,setScheduleTitle]=useState(''),[scheduleOpen,setScheduleOpen]=useState(false),[notice,setNotice]=useState('');
  const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 559px)').matches);
  const [compactPage,setCompactPage]=useState('list');
  const [reading,setReading]=useState(false),[opening,setOpening]=useState(0),[closing,setClosing]=useState(false);
  const [editing,setEditing]=useState(true),[switching,setSwitching]=useState(false),[closeFailure,setCloseFailure]=useState('');
  const editor=useRef(/** @type {{open:()=>Promise<void>,close:(reason:string)=>Promise<void>,isComposing:()=>boolean}|null} */(null));
  const listRef=useRef(/** @type {HTMLElement|null} */(null));
  const panelRef=useRef(/** @type {HTMLElement|null} */(null));
  const backRef=useRef(/** @type {HTMLButtonElement|null} */(null));
  const selectedId=useRef(''),listScroll=useRef(0);
  const rows=useRef(/** @type {Map<string,{rect:DOMRect,top:number,node:HTMLElement}>} */(new Map()));
  const animations=useRef(new AbortController());
  const closeMotion=useRef(/** @type {AbortController|null} */(null));
  const nativeClose=useRef(/** @type {()=>Promise<void>} */(async()=>{}));
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** @param {import('react').MouseEvent<HTMLElement>} event */
  const drag=event=>{
    if(event.button!==0||event.target instanceof Element&&event.target.closest('button')||!isTauri())return;
    void getCurrentWindow().startDragging().catch(()=>{});
  };
  const returnToList=()=>{setCompactPage('list');requestAnimationFrame(()=>{
    const list=listRef.current;if(!list)return;list.scrollTop=listScroll.current;
    const target=Array.from(list.querySelectorAll('button[data-memo-id]')).find(node=>node.getAttribute('data-memo-id')===selectedId.current);
    if(target instanceof HTMLElement)target.focus();
  });};
  const close=async()=>{
    if(view.busy||closing||switching)return;
    setClosing(true);const abort=new AbortController();closeMotion.current=abort;
    try {
      await editor.current?.close('archive-close');
      if(abort.signal.aborted)return;
      await runMemoMotion(panelRef.current,[{opacity:1},{opacity:0}],{duration:100,reducedMotion:reduced(),signal:abort.signal});
      if(!abort.signal.aborted){await onClose?.();setClosing(false);setCloseFailure('');}
    } catch {setClosing(false);setEditing(true);setCompactPage('detail');setCloseFailure('보관하지 못했습니다. 내용을 유지하고 있습니다. 다시 닫아 주세요.');}
  };
  const compose=async()=>{
    closeMotion.current?.abort();setClosing(false);setEditing(true);setCompactPage('detail');setScheduleOpen(false);setCloseFailure('');setNotice('');
    await editor.current?.open();void controller.load();
  };
  nativeClose.current=close;
  const newMemo=async()=>{
    if(view.busy||switching||closing)return;
    setSwitching(true);
    try {await editor.current?.close('new-memo');await compose();}
    catch {setEditing(true);setCompactPage('detail');setCloseFailure('보관하지 못했습니다. 내용을 유지하고 있습니다.');}
    finally {setSwitching(false);}
  };
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 559px)');
    const changed=()=>setCompact(query.matches);query.addEventListener('change',changed);
    return()=>query.removeEventListener('change',changed);
  },[]);
  useEffect(()=>{
    controller.activate();animations.current=new AbortController();void controller.load();let disposed=false;const stops=/** @type {(()=>void)[]} */([]);
    if(isTauri()){
      const subscriptions=[listen('memo-archive-open',()=>{setOpening(n=>n+1);void compose();}),listen('memo-focus',()=>void compose()),listen('memo-close-request',()=>void nativeClose.current())];
      for(const subscription of subscriptions)void subscription.then(unlisten=>{if(disposed)unlisten();else stops.push(unlisten);});
      void Promise.all(subscriptions).then(async()=>{if(!disposed&&await getCurrentWindow().isVisible())await compose();}).catch(()=>{});
    }else {void editor.current?.open();if(location.search.includes('compose=1'))setCompactPage('detail');}
    return()=>{disposed=true;for(const stop of stops)stop();controller.dispose();closeMotion.current?.abort();animations.current.abort();rows.current.clear();};
  },[controller]);
  useEffect(()=>{
    const abort=new AbortController();
    void runMemoMotion(panelRef.current,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:200,reducedMotion:reduced(),signal:abort.signal});
    return()=>abort.abort();
  },[opening]);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed=()=>{if(query.matches){animations.current.abort();animations.current=new AbortController();}};
    query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);
  },[]);
  useEffect(()=>{setScheduleOpen(false);},[view.selected?.id]);
  useEffect(()=>{
    /** @param {KeyboardEvent} event */
    const dismiss=event=>{
      if(event.key!=='Escape'||event.isComposing||editor.current?.isComposing()||view.busy||switching)return;
      event.preventDefault();if(scheduleOpen){setScheduleOpen(false);return;}
      if(!editing&&compact&&compactPage==='detail')returnToList();else void close();
    };
    window.addEventListener('keydown',dismiss);return()=>window.removeEventListener('keydown',dismiss);
  });
  const itemOrder=view.items.map(item=>item.id).join('|');
  useLayoutEffect(()=>{
    const list=listRef.current;if(!list)return;
    const next=new Map();
    const now=new Set(view.items.map(item=>item.id));
    for(const [id,before] of rows.current){
      if(now.has(id)||reduced()||compactPage==='detail'&&compact)continue;
      const ghost=before.node.cloneNode(true);
      if(!(ghost instanceof HTMLElement))continue;
      ghost.classList.add('memo-archive-ghost');ghost.setAttribute('aria-hidden','true');ghost.inert=true;
      Object.assign(ghost.style,{left:`${before.rect.left}px`,top:`${before.rect.top}px`,width:`${before.rect.width}px`,height:`${before.rect.height}px`});
      document.body.appendChild(ghost);
      void runMemoMotion(ghost,[{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-8px)'}],{duration:120,signal:animations.current.signal}).finally(()=>ghost.remove());
    }
    list.querySelectorAll('[data-archive-row]').forEach(node=>{
      if(!(node instanceof HTMLElement))return;
      const id=node.getAttribute('data-archive-row')||'',rect=node.getBoundingClientRect(),before=rows.current.get(id);
      if(before&&Math.abs(before.top-node.offsetTop)>1&&rect.width>0&&before.rect.width>0){
        void runMemoMotion(node,[{transform:`translateY(${before.top-node.offsetTop}px)`},{transform:'translateY(0)'}],{duration:160,reducedMotion:reduced(),signal:animations.current.signal});
      }
      next.set(id,{rect,top:node.offsetTop,node});
    });rows.current=next;
  },[itemOrder,compact,compact?compactPage:'wide']);
  const memo=view.selected;
  useEffect(()=>{if(memo)selectedId.current=memo.id;},[memo?.id]);
  const choose=async(/** @type {string} */ id)=>{
    if(switching||closing)return;
    setEditing(false);
    selectedId.current=id;listScroll.current=listRef.current?.scrollTop||0;setNotice('');setCompactPage('detail');setReading(true);
    try{await controller.select(id);}finally{setReading(false);if(compact)requestAnimationFrame(()=>backRef.current?.focus());}
  };
  useEffect(()=>{
    if(!editing&&!view.busy&&!reading&&!memo&&compactPage==='detail'&&!view.error){
      setCompactPage('list');requestAnimationFrame(()=>{
        const first=listRef.current?.querySelector('button');
        if(first instanceof HTMLElement)first.focus();else panelRef.current?.querySelector('button')?.focus();
      });
    }
  },[editing,view.busy,reading,memo,compactPage,view.error]);
  /** @param {()=>Promise<unknown>} action */
  const act=async action=>{try{await action();}catch{}};
  const remove=async(/** @type {string} */ id)=>{
    const fromList=!!listRef.current?.contains(document.activeElement);
    await act(async()=>{if(await controller.remove(id)){
      setEditing(false);
      setNotice('메모를 삭제했어요');
      if(fromList)requestAnimationFrame(()=>{
        const next=listRef.current?.querySelector('button[aria-pressed=true]');
        const closeButton=panelRef.current?.querySelector('.memo-icon-button');
        if(next instanceof HTMLElement)next.focus();else if(closeButton instanceof HTMLElement)closeButton.focus();
      });
    }});
  };
  return <section ref={panelRef} className={`memo-archive-panel${closing?' memo-archive-closing':''}`} role="dialog" aria-label="메모 보관함" data-page={compactPage}>
    <div className="memo-archive-top-drag" onMouseDown={drag} aria-hidden="true"/>
    <header className="memo-archive-header" onMouseDown={drag}>
      <div className="memo-archive-heading"><h2>메모 보관함</h2><span aria-label={`보관한 메모 ${view.items.length}개`}>{view.items.length}</span></div>
      <button className="memo-icon-button" type="button" onClick={()=>void close()} disabled={view.busy||switching} aria-label="메모 보관함 닫기"><Icon kind="close"/></button>
    </header>
    {view.error?<div role="alert" className="memo-archive-alert">{view.error}<button onClick={()=>void controller.load()}>다시 불러오기</button></div>:null}
    {closeFailure?<div role="alert" className="memo-archive-alert">{closeFailure}</div>:null}
    {view.invalidCount?<p className="memo-archive-warning" role="status">읽을 수 없는 메모 {view.invalidCount}개를 원본 그대로 보존했습니다.</p>:null}
    <div className="memo-archive-layout">
      <nav ref={listRef} aria-label="보관한 메모 목록" className="memo-archive-list">
        <button className="memo-new" type="button" disabled={view.busy||switching||closing} onClick={()=>void newMemo()}>＋ 새 메모</button>
        {view.items.map(item=><div key={item.id} className="memo-archive-row" data-archive-row={item.id} data-selected={!editing&&memo?.id===item.id}>
          <button className="memo-archive-select" data-memo-id={item.id} type="button" disabled={view.busy||switching} aria-label={item.title} aria-pressed={!editing&&memo?.id===item.id} onClick={()=>void choose(item.id)}>
          <strong>{item.title}</strong><span>{item.preview}</span><time title={new Date(item.createdAtUnixMs).toLocaleString('ko-KR')}>{formatArchiveTime(item.createdAtUnixMs)}</time>
          </button><button className="memo-row-delete" type="button" disabled={view.busy} aria-label={`${item.title} 삭제`} title="메모 삭제" onClick={()=>void remove(item.id)}><Icon kind="trash"/></button>
        </div>)}
        {!view.items.length&&!view.loading?<p className="memo-empty">보관한 메모가 없습니다.</p>:null}
        {view.loading?<p className="memo-empty" role="status">불러오는 중…</p>:null}
        {view.nextOffset!==null?<button type="button" onClick={()=>void controller.load(true)}>더 보기</button>:null}
      </nav>
      <article className="memo-archive-detail">
        {compact&&compactPage==='detail'?<button ref={backRef} className="memo-archive-back" type="button" onClick={returnToList}><Icon kind="back"/>목록으로</button>:null}
        <div className="memo-compose" hidden={!editing}><MemoSurface embedded controllerRef={editor}/></div>
        {!editing&&memo?<><pre key={`${opening}-${memo.id}`} tabIndex={0}>{memo.text}</pre><div className="memo-archive-actions">
          <button className="memo-save" type="button" disabled={view.busy} onClick={()=>void act(async()=>{const result=await controller.exportMemo(memo.id);setNotice(result?.removed?'다운로드 폴더에 저장했어요':result?.saved?'파일은 저장했지만 메모를 제거하지 못했어요. 다시 눌러 주세요':'');})}><Icon kind="save"/>로컬에 저장</button>
          <button className="memo-schedule" type="button" disabled={view.busy} onClick={()=>{setScheduleTitle(memo.text.split('\n').find(line=>line.trim())?.slice(0,180)||'메모 작업');setScheduleOpen(true);requestAnimationFrame(()=>panelRef.current?.querySelector('input')?.focus());}}><Icon kind="calendar"/>일정에 등록</button>
          <button className="memo-delete" type="button" disabled={view.busy} onClick={()=>void remove(memo.id)}><Icon kind="trash"/>삭제</button>
        </div>
        {scheduleOpen?<form onSubmit={event=>{event.preventDefault();void act(async()=>{const result=await controller.perform(async()=>{if(!onAddTask)throw Error('schedule_unavailable');const saved=await onAddTask({title:scheduleTitle.trim()});if(saved===false)throw Error('schedule_failed');return true;});if(result){setScheduleOpen(false);setNotice('오늘 일정에 등록했어요');}});}}><label>오늘 일정 제목<input value={scheduleTitle} maxLength={180} disabled={view.busy} onChange={event=>setScheduleTitle(event.target.value)}/></label><button disabled={view.busy||!scheduleTitle.trim()}>등록</button><button type="button" disabled={view.busy} onClick={()=>setScheduleOpen(false)}>취소</button></form>:null}</>:!editing?<p className="memo-empty">{reading?'메모를 읽는 중…':'목록에서 메모를 선택하세요.'}</p>:null}
      </article>
    </div>
    <div key={notice} role="status" className="memo-archive-notice">{notice?<><Icon kind="check"/><span>{notice}</span></>:null}</div>
  </section>;
}
