import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CloseButton from "./CloseButton.jsx";
import { recordRuntimeEvent } from "../runtime-log.js";
export default function WindowChrome() {
  /** @param {'minimize'|'toggleMaximize'|'close'|'startDragging'} method */
  const act = async method => { if(isTauri())try{await getCurrentWindow()[method]();}catch(error){recordRuntimeEvent("window_control_error",{method,error:String(error)});} };
  const controlTarget = (/** @type {EventTarget|null} */ target) => target instanceof Element && !!target.closest('.db-window-controls');
  return <header className="db-window-chrome" data-tauri-drag-region="false" onMouseDown={event=>{if(event.button===0&&event.detail===1&&!controlTarget(event.target))void act('startDragging');}} onDoubleClick={event=>{if(!controlTarget(event.target))void act('toggleMaximize');}}><div className="db-window-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v14H5zM8 3v6M16 3v6M5 11h14"/></svg>Daybridge</div><div className="db-window-controls" data-tauri-drag-region="false"><button type="button" className="db-window-action" aria-label="관리 창 최소화" title="최소화" onClick={()=>void act('minimize')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12"/></svg></button><button type="button" className="db-window-action" aria-label="관리 창 최대화 또는 복원" title="최대화 / 복원" onClick={()=>void act('toggleMaximize')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="1"/></svg></button><CloseButton label="관리 창 닫기" onClick={()=>void act('close')}/></div></header>;
}
