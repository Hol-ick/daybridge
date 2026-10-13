/** @param {{label:string,onClick:()=>void,disabled?:boolean,className?:string}} props */
export default function CloseButton({label,onClick,disabled=false,className=""}) {
  return <button type="button" className={`db-close ${className}`} onClick={onClick} disabled={disabled} aria-label={label} title={label} data-tauri-drag-region="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>;
}
