"""Sanitized, isolated Daybridge visual and motion verification."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--base-url',default='http://127.0.0.1:5187')
parser.add_argument('--output-dir',default='test-artifacts/memo-design')
args=parser.parse_args();out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
fixtures=Path('test-artifacts');fixtures.mkdir(exist_ok=True)
(fixtures/'memo-design.html').write_text('<!doctype html><html lang="ko"><meta charset="UTF-8"><div id="root"></div><script type="module" src="/test-artifacts/memo-design-host.jsx"></script></html>',encoding='utf-8')
(fixtures/'memo-design-host.jsx').write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import MemoArchivePanel from '/src/memo/MemoArchivePanel.jsx';
import {createArchiveApi} from '/src/memo/archive-api.js';
import NowFocusOverlay from '/src/schedule/NowFocusOverlay.jsx';
window.fixture={failure:false,partial:false,added:[],closed:false};
const api=createArchiveApi();const guarded={...api,export:async id=>{if(window.fixture.failure)throw Error('fixture_write_failure');if(window.fixture.partial)return {saved:true,removed:false};return api.export(id);},remove:async id=>{if(window.fixture.failure)throw Error('fixture_delete_failure');return api.remove(id);}};
function Host(){const [schedule,setSchedule]=React.useState({mode:'todo',timeConfigured:false,blocks:[]});const[open,setOpen]=React.useState(false);React.useEffect(()=>{const update=e=>{if(e.data?.title){setSchedule({mode:'todo',timeConfigured:false,blocks:[{id:'added',kind:'focus',title:e.data.title,status:'planned',questId:'added'}]});}};window.addEventListener('message',update);return()=>window.removeEventListener('message',update);},[]);return <NowFocusOverlay schedule={schedule} nowFocus={{state:'todo_list'}} archiveOpen={open} onOpenMemoArchive={()=>{setOpen(true);window.open('/test-artifacts/memo-design.html?panel=1','design-fixture','width=720,height=680');}} onOpenSettings={()=>{}} onAddManualTask={async()=>true}/>;}
createRoot(document.getElementById('root')).render(<React.StrictMode>{location.search.includes('panel')?<MemoArchivePanel archiveApi={guarded} onClose={()=>{window.fixture.closed=true;document.getElementById('root').style.display='none';}} onAddTask={async task=>{window.fixture.added.push(task);window.opener?.postMessage(task,location.origin);return true;}}/>:<Host/>}</React.StrictMode>);
''',encoding='utf-8')
seed="""localStorage.setItem('daybridge.memo.preview.sessions.v2',JSON.stringify({schemaVersion:2,active:null,lastClosed:null,archives:[{id:'one',text:'회의 준비\\n검토할 항목을 정리하고 다음 일정에 등록합니다.\\n'+ '한글 본문을 길게 읽어도 화면이 잘리지 않아야 합니다. '.repeat(35),revision:1,createdAtUnixMs:1790922000000,updatedAtUnixMs:1790922000000},{id:'two',text:'다운로드 보관\\n텍스트 파일로 저장할 메모입니다.',revision:1,createdAtUnixMs:1790921000000,updatedAtUnixMs:1790921000000}]}));"""
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch()
 for width,scale,reduced in [(720,1,False),(560,1,False),(420,1,False),(720,1.5,False),(720,2,False),(420,2,False),(720,1,True),(420,1,True)]:
  name=f'{width}-{scale}-{reduced}'
  ctx=browser.new_context(viewport={'width':width,'height':680},device_scale_factor=scale,accept_downloads=True,reduced_motion='reduce' if reduced else 'no-preference',record_video_dir=str(out/'video'),record_video_size={'width':720,'height':680})
  ctx.route('http://127.0.0.1:39393/**',lambda r:r.abort());ctx.add_init_script(seed)
  ctx.add_init_script("window.motionRecords=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.motionRecords.push({className:this.className,duration:options.duration});return animate.call(this,frames,options);};")
  host=ctx.new_page();errors=[];host.on('pageerror',lambda e:errors.append(str(e)))
  host.goto(args.base_url+'/test-artifacts/memo-design.html');host.get_by_test_id('now-focus-overlay-leave-time').click()
  with host.expect_popup() as popup:host.get_by_role('button',name='메모 보관함',exact=True).click()
  page=popup.value;page.on('pageerror',lambda e:errors.append(str(e)));page.set_viewport_size({'width':width,'height':680});page.wait_for_timeout(250)
  panel=page.get_by_role('dialog',name='메모 보관함');expect(panel).to_be_visible();page.screenshot(path=str(out/f'list-{name}.png'))
  panel.get_by_role('button',name='회의 준비').click();expect(panel.locator('pre')).to_contain_text('한글 본문');page.wait_for_timeout(150)
  assert panel.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
  if width<560:
   expect(panel.get_by_role('button',name='목록으로')).to_be_visible()
   page.keyboard.press('Escape');expect(panel.get_by_role('button',name='회의 준비')).to_be_focused()
   panel.get_by_role('button',name='회의 준비').click();expect(panel.locator('pre')).to_be_visible()
  page.wait_for_timeout(220);page.screenshot(path=str(out/f'detail-{name}.png'))
  if width<560:
   page.set_viewport_size({'width':720,'height':680});expect(panel.locator('pre')).to_be_visible()
   page.set_viewport_size({'width':width,'height':680});expect(panel.locator('pre')).to_be_visible()
  page.evaluate('fixture.failure=true');panel.get_by_role('button',name='로컬에 저장',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('처리를 확인하지 못했어요');expect(panel.locator('pre')).to_contain_text('회의 준비');assert page.locator('.memo-archive-ghost').count()==0
  page.screenshot(path=str(out/f'failure-{name}.png'));page.evaluate('fixture.failure=false;fixture.partial=true');panel.get_by_role('button',name='로컬에 저장',exact=True).click();expect(panel.get_by_role('status')).to_contain_text('제거하지 못했어요');expect(panel.locator('pre')).to_contain_text('회의 준비');page.evaluate('fixture.partial=false')
  panel.get_by_role('button',name='일정에 등록',exact=True).click();expect(panel.get_by_role('textbox',name='오늘 일정 제목')).to_be_focused();panel.get_by_role('textbox',name='오늘 일정 제목').fill('메모에서 등록한 일정');page.screenshot(path=str(out/f'schedule-{name}.png'));panel.get_by_role('button',name='등록',exact=True).click();expect(host.get_by_test_id('now-focus-overlay-block-added').get_by_text('메모에서 등록한 일정',exact=True)).to_be_visible()
  with page.expect_download() as dl:panel.get_by_role('button',name='로컬에 저장',exact=True).click()
  target=out/f'export-{name}.txt';dl.value.save_as(str(target))
  assert target.read_text(encoding='utf-8').startswith('회의 준비\n검토할 항목')
  # Sample success motion; ghosts are never interactive or in the accessible tree.
  page.screenshot(path=str(out/f'exit-{name}.png'));page.wait_for_timeout(260)
  expect(panel.get_by_role('button',name='회의 준비')).to_have_count(0);assert page.locator('.memo-archive-ghost').count()==0
  panel.get_by_role('button',name='다운로드 보관').click();panel.get_by_role('button',name='삭제',exact=True).click();expect(panel.get_by_text('보관한 메모가 없습니다.')).to_be_visible();page.wait_for_timeout(250);page.screenshot(path=str(out/f'empty-{name}.png'))
  assert page.evaluate("JSON.parse(localStorage.getItem('daybridge.memo.preview.sessions.v2')).archives.length")==0
  expect(panel.get_by_role('button',name='삭제 확인')).to_have_count(0);expect(panel.get_by_role('button',name='삭제 되돌리기')).to_have_count(0)
  page.keyboard.press('Escape');page.wait_for_timeout(250);assert page.evaluate('fixture.closed')
  assert not errors,errors
  motions=page.evaluate('motionRecords')
  if reduced: assert not motions,motions
  elif width>=560:
   assert any('ghost' in m['className'] for m in motions),motions
   assert len([m for m in motions if m['duration']==160])<=2,motions
  else: assert motions
  results.append({'width':width,'scale':scale,'reducedMotion':reduced,'passed':True,'failurePreserved':True,'partialPreserved':True,'scheduleVisible':True,'pageErrors':len(errors),'motionRecords':motions,'video':str(page.video.path())})
  ctx.close()
 browser.close()
(out/'result.json').write_text(json.dumps({'passed':True,'nativeVerified':False,'scenarios':results},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results))
