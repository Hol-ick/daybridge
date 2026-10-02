import {useEffect,useState} from 'react';
import {createArchiveController} from './archive-controller.js';
import {createArchiveApi} from './archive-api.js';
import './archive.css';

/** @param {{onClose?:()=>void,onAddTask?:import('../schedule/ui-types').AddManualTask}} props */
export default function MemoArchivePanel({onClose,onAddTask}) {
  const [view,setView]=useState(/** @type {import('./archive-controller.js').View} */({items:[],selected:null,loading:false,busy:false,error:'',nextOffset:null,invalidCount:0}));
  const [api]=useState(createArchiveApi);
  const [controller]=useState(()=>createArchiveController(api,setView));
  const [confirmDelete,setConfirmDelete]=useState(false),[scheduleTitle,setScheduleTitle]=useState(''),[scheduleOpen,setScheduleOpen]=useState(false),[notice,setNotice]=useState(''),[undoId,setUndoId]=useState('');
  useEffect(()=>{void controller.load();return ()=>controller.dispose();},[controller]);
  useEffect(()=>{setConfirmDelete(false);setScheduleOpen(false);},[view.selected?.id]);
  useEffect(()=>{
    /** @param {KeyboardEvent} event */
    const close=event=>{if(event.key==='Escape'&&!event.isComposing&&!view.busy){event.preventDefault();onClose?.();}};
    window.addEventListener('keydown',close);
    return()=>window.removeEventListener('keydown',close);
  },[onClose,view.busy]);
  const memo=view.selected;
  /** @param {()=>Promise<unknown>} action */
  const act=async action=>{try {await action();}catch{}};
  return <section className="memo-archive-panel" role="dialog" aria-modal="true" aria-label="메모 보관함" data-tauri-drag-region="false">
    <header className="memo-archive-header" data-tauri-drag-region="true"><h2>메모 보관함</h2><button type="button" onClick={onClose} disabled={view.busy} aria-label="메모 보관함 닫기">×</button></header>
    {view.error ? <div role="alert" className="memo-archive-alert">{view.error}<button onClick={()=>void controller.load()}>다시 불러오기</button></div> : null}
    {view.invalidCount ? <p role="status">읽을 수 없는 메모 {view.invalidCount}개를 원본 그대로 보존했습니다.</p> : null}
    <div className="memo-archive-layout">
      <nav aria-label="보관한 메모 목록" className="memo-archive-list">
        {view.items.map(item=><button key={item.id} type="button" disabled={view.busy} aria-pressed={memo?.id===item.id} onClick={()=>void controller.select(item.id)}><strong>{item.title}</strong><time>{new Date(item.createdAtUnixMs).toLocaleString('ko-KR')}</time><span>{item.preview}</span></button>)}
        {!view.items.length && !view.loading ? <p>보관한 메모가 없습니다.</p> : null}
        {view.loading ? <p role="status">불러오는 중…</p> : null}
        {view.nextOffset!==null ? <button type="button" onClick={()=>void controller.load(true)}>더 보기</button> : null}
      </nav>
      <article className="memo-archive-detail">
        {memo ? <><pre tabIndex={0}>{memo.text}</pre><div className="memo-archive-actions">
          <button type="button" disabled={view.busy} onClick={()=>void act(async()=>{const result=await controller.perform(()=>api.export(memo.id));setNotice(result?.cancelled ? '저장을 취소했어요' : result?.saved ? '파일로 저장했어요' : '');})}>로컬에 저장</button>
          <button type="button" disabled={view.busy} onClick={()=>{setScheduleTitle(memo.text.split('\n').find(line=>line.trim())?.slice(0,180)||'메모 작업');setScheduleOpen(true);setConfirmDelete(false);}}>일정에 등록</button>
          <button type="button" disabled={view.busy} onClick={()=>{setConfirmDelete(true);setScheduleOpen(false);}}>삭제</button>
        </div>
        {scheduleOpen ? <form onSubmit={event=>{event.preventDefault();void act(async()=>{const result=await controller.perform(async()=>{if(!onAddTask) throw Error('schedule_unavailable');const saved=await onAddTask({title:scheduleTitle.trim()});if(saved===false) throw Error('schedule_failed');return true;});if(result){setScheduleOpen(false);setNotice('오늘 일정에 등록했어요');}});}}><label>오늘 일정 제목<input value={scheduleTitle} maxLength={180} disabled={view.busy} onChange={event=>setScheduleTitle(event.target.value)} /></label><button disabled={view.busy||!scheduleTitle.trim()}>등록</button><button type="button" disabled={view.busy} onClick={()=>setScheduleOpen(false)}>취소</button></form> : null}
        {confirmDelete ? <div role="alert">이 메모를 보관함에서 삭제할까요?<button disabled={view.busy} onClick={()=>void act(async()=>{const id=memo.id;if(await controller.remove(id)){setUndoId(id);setNotice('메모를 삭제했어요');}})}>삭제 확인</button><button disabled={view.busy} onClick={()=>setConfirmDelete(false)}>취소</button></div> : null}
        </> : <p>목록에서 메모를 선택하세요.</p>}
        <div role="status" className="memo-archive-notice">{notice}{undoId ? <button disabled={view.busy} onClick={()=>void act(async()=>{await controller.restore(undoId);setUndoId('');setNotice('메모를 복원했어요');})}>삭제 되돌리기</button> : null}</div>
      </article>
    </div>
  </section>;
}
