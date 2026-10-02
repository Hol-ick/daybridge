import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createArchiveController} from './archive-controller.js';
import {createArchiveApi} from './archive-api.js';
import './archive.css';
import {isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

/** @param {{onClose?:()=>void,onAddTask?:import('../schedule/ui-types').AddManualTask}} props */
export default function MemoArchivePanel({onClose,onAddTask}) {
  const [view,setView]=useState(/** @type {import('./archive-controller.js').View} */({items:[],selected:null,loading:false,busy:false,error:'',nextOffset:null,invalidCount:0}));
  const [api]=useState(createArchiveApi);
  const [controller]=useState(()=>createArchiveController(api,setView));
  const [scheduleTitle,setScheduleTitle]=useState(''),[scheduleOpen,setScheduleOpen]=useState(false),[notice,setNotice]=useState('');
  const listRef=useRef(/** @type {HTMLElement|null} */(null));
  const positions=useRef(/** @type {Map<string,DOMRect>} */(new Map()));
  const [opening,setOpening]=useState(0),[closing,setClosing]=useState(false);
  const timer=useRef(/** @type {number|undefined} */(undefined));
  const close=()=>{
    if(view.busy||closing)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){onClose?.();return;}
    setClosing(true);timer.current=window.setTimeout(()=>{onClose?.();setClosing(false);},83);
  };
  useEffect(()=>{
    controller.activate();void controller.load();let disposed=false;let stop=()=>{};
    if(isTauri())void listen('memo-archive-open',()=>{setClosing(false);setOpening(n=>n+1);void controller.load();}).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;});
    return()=>{disposed=true;stop();controller.dispose();window.clearTimeout(timer.current);};
  },[controller]);
  useEffect(()=>{setScheduleOpen(false);},[view.selected?.id]);
  useEffect(()=>{
    /** @param {KeyboardEvent} event */
    const dismiss=event=>{if(event.key==='Escape'&&!event.isComposing&&!view.busy){event.preventDefault();close();}};
    window.addEventListener('keydown',dismiss);return()=>window.removeEventListener('keydown',dismiss);
  });
  useLayoutEffect(()=>{
    const next=new Map();
    listRef.current?.querySelectorAll('[data-memo-id]').forEach(node=>{
      const id=node.getAttribute('data-memo-id')||'',rect=node.getBoundingClientRect(),before=positions.current.get(id);
      if(before&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&Math.abs(before.y-rect.y)>1)node.animate([{transform:`translateY(${before.y-rect.y}px)`},{transform:'translateY(0)'}],{duration:167,easing:'cubic-bezier(0,0,0,1)'});
      next.set(id,rect);
    });positions.current=next;
  },[view.items]);
  const memo=view.selected;
  /** @param {()=>Promise<unknown>} action */
  const act=async action=>{try {await action();}catch{}};
  return <section key={opening} className={`memo-archive-panel${closing?" memo-archive-closing":""}`} role="dialog" aria-label="메모 보관함" data-tauri-drag-region="false">
    <header className="memo-archive-header" data-tauri-drag-region="true"><h2>메모 보관함</h2><button type="button" onClick={close} disabled={view.busy} aria-label="메모 보관함 닫기">×</button></header>
    {view.error ? <div role="alert" className="memo-archive-alert">{view.error}<button onClick={()=>void controller.load()}>다시 불러오기</button></div> : null}
    {view.invalidCount ? <p role="status">읽을 수 없는 메모 {view.invalidCount}개를 원본 그대로 보존했습니다.</p> : null}
    <div className="memo-archive-layout">
      <nav ref={listRef} aria-label="보관한 메모 목록" className="memo-archive-list">
        {view.items.map(item=><button key={item.id} data-memo-id={item.id} type="button" disabled={view.busy} aria-pressed={memo?.id===item.id} onClick={()=>{setNotice('');void controller.select(item.id);}}><strong>{item.title}</strong><time>{new Date(item.createdAtUnixMs).toLocaleString('ko-KR')}</time><span>{item.preview}</span></button>)}
        {!view.items.length && !view.loading ? <p>보관한 메모가 없습니다.</p> : null}
        {view.loading ? <p role="status">불러오는 중…</p> : null}
        {view.nextOffset!==null ? <button type="button" onClick={()=>void controller.load(true)}>더 보기</button> : null}
      </nav>
      <article className="memo-archive-detail">
        {memo ? <><pre key={memo.id} tabIndex={0}>{memo.text}</pre><div className="memo-archive-actions">
          <button type="button" disabled={view.busy} onClick={()=>void act(async()=>{const result=await controller.exportMemo(memo.id);setNotice(result?.removed ? '다운로드 폴더에 저장했어요' : result?.saved ? '파일은 저장했지만 메모를 제거하지 못했어요. 다시 눌러 주세요' : '');})}>로컬에 저장</button>
          <button type="button" disabled={view.busy} onClick={()=>{setScheduleTitle(memo.text.split('\n').find(line=>line.trim())?.slice(0,180)||'메모 작업');setScheduleOpen(true);}}>일정에 등록</button>
          <button type="button" disabled={view.busy} onClick={()=>void act(async()=>{if(await controller.remove(memo.id))setNotice('메모를 삭제했어요');})}>삭제</button>
        </div>
        {scheduleOpen ? <form onSubmit={event=>{event.preventDefault();void act(async()=>{const result=await controller.perform(async()=>{if(!onAddTask) throw Error('schedule_unavailable');const saved=await onAddTask({title:scheduleTitle.trim()});if(saved===false) throw Error('schedule_failed');return true;});if(result){setScheduleOpen(false);setNotice('오늘 일정에 등록했어요');}});}}><label>오늘 일정 제목<input value={scheduleTitle} maxLength={180} disabled={view.busy} onChange={event=>setScheduleTitle(event.target.value)} /></label><button disabled={view.busy||!scheduleTitle.trim()}>등록</button><button type="button" disabled={view.busy} onClick={()=>setScheduleOpen(false)}>취소</button></form> : null}
        </> : <p>목록에서 메모를 선택하세요.</p>}
        <div role="status" className="memo-archive-notice">{notice}</div>
      </article>
    </div>
  </section>;
}
