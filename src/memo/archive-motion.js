/**
 * @param {{animate:(frames:Keyframe[],options:KeyframeAnimationOptions)=>{finished:Promise<unknown>,cancel:()=>void}}|null} element
 * @param {Keyframe[]} keyframes
 * @param {{duration:number,reducedMotion?:boolean,signal?:AbortSignal}} options
 * @returns {Promise<void>}
 */
export async function runMemoMotion(element,keyframes,{duration,reducedMotion=false,signal}) {
  if (!element || reducedMotion || signal?.aborted) return;
  let animation;
  try { animation=element.animate(keyframes,{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}); } catch { return; }
  let settle=()=>{};
  const stopped=new Promise(resolve=>{settle=()=>resolve(undefined);});
  const cancel=()=>{animation.cancel();settle();};
  signal?.addEventListener('abort',cancel,{once:true});
  // Background tabs and detached elements must never hold a lifecycle promise.
  const timeout=setTimeout(cancel,duration+100);
  try { await Promise.race([animation.finished.catch(()=>{}),stopped]); }
  finally {clearTimeout(timeout);signal?.removeEventListener('abort',cancel);animation.cancel();}
}
