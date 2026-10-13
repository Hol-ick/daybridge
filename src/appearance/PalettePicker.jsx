import { useState } from "react";
import { PALETTES } from "./palettes.js";
/** @param {{appearance?:{paletteId?:string},onChange?:(value:{paletteId:string})=>void}} props */
export default function PalettePicker({ appearance, onChange }) {
  const [error,setError] = useState("");
  return <><div className="palette-grid" role="group" aria-label="앱 색상 팔레트">
    {PALETTES.map(p => <button key={p.id} type="button" className="palette-card" aria-label={`${p.label} 팔레트`} aria-pressed={appearance?.paletteId === p.id} onClick={()=>{try{onChange?.({paletteId:p.id});setError("");}catch{setError("색상을 저장하지 못했습니다. 다시 선택해 주세요.");}}}>
      <span className="palette-preview" aria-hidden="true" style={{"--preview-canvas":p.canvas,"--preview-ink":p.ink,"--preview-accent":p.accent,"--preview-paper":p.paper,"--preview-paper-ink":p.paperInk}}><span className="palette-preview-sidebar"><i/><i/><i/></span><span className="palette-preview-paper"><i/><i/></span></span>
      <span className="palette-name">{p.label}{appearance?.paletteId===p.id?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>:null}</span>
    </button>)}
  </div>{error?<p className="palette-feedback palette-error" role="alert">{error}</p>:<span className="palette-feedback">자동 저장</span>}</>;
}
