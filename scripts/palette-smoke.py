"""Isolated palette, multi-window synchronization and visual acceptance checks."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path('test-artifacts/palettes');out.mkdir(parents=True,exist_ok=True)
Path('test-artifacts/palette.html').write_text('<!doctype html><html lang="ko"><meta charset="UTF-8"><div id="root"></div><script type="module" src="/test-artifacts/palette-host.jsx"></script></html>',encoding='utf-8')
Path('test-artifacts/palette-host.jsx').write_text('''import React from 'react';
import {createRoot} from 'react-dom/client';
import '/src/todometer/styles/variables.css';import '/src/todometer/index.css';import '/src/appearance/theme.css';
import {initializeAppearance,useAppearance,setAppearance} from '/src/appearance/theme-store.js';
import {PALETTES} from '/src/appearance/palettes.js';
import {OverlaySettingsModal} from '/src/schedule/NowFocusOverlay.jsx';
import NowFocusOverlay from '/src/schedule/NowFocusOverlay.jsx';
import MemoArchivePanel from '/src/memo/MemoArchivePanel.jsx';
import ScheduleDashboard from '/src/schedule/ScheduleDashboard.jsx';
import WindowChrome from '/src/appearance/WindowChrome.jsx';
initializeAppearance();window.fixture={closed:false};window.palettes=PALETTES;
function Host(){const appearance=useAppearance();const view=new URLSearchParams(location.search).get('view');
const schedule={date:'2099-01-02',mode:'todo',timeConfigured:false,blocks:[{id:'one',kind:'focus',type:'focus',title:'회의 준비와 검토',status:'planned',questId:'one'}]};
document.body.dataset.surface=view==='overlay'?'overlay':view==='archive'?'archive':'dashboard';
if(view==='archive')return <MemoArchivePanel onClose={()=>{window.fixture.closed=true;}} onAddTask={async()=>true}/>;
if(view==='overlay')return <NowFocusOverlay schedule={schedule} nowFocus={{state:'todo_list'}} appearance={appearance} onOpenSettings={()=>{}} onOpenMemoArchive={()=>{}}/>;
return <>{view==='standalone'?null:<WindowChrome/>}<ScheduleDashboard schedule={schedule} nowFocus={{state:'todo_list'}} onOpenSettings={()=>{}}/>{view==='dashboard'?null:<OverlaySettingsModal showCloseButton={view==='standalone'} appearance={appearance} onAppearanceChange={setAppearance} onClose={()=>{window.fixture.closed=true;}} onSubmit={e=>e.preventDefault()} dailyDefaults={[]} scheduleSettings={{timeConfigured:false}}/>}</>;}
createRoot(document.getElementById('root')).render(<Host/>);
''',encoding='utf-8')
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':960,'height':760})
    context.route('http://127.0.0.1:39393/**',lambda route:route.abort())
    settings=context.new_page();errors=[]
    settings.on('pageerror',lambda e:errors.append(str(e)))
    settings.goto('http://127.0.0.1:5187/test-artifacts/palette.html')
    expect(settings.get_by_role('button',name='설정 닫기',exact=True)).to_have_count(0)
    expect(settings.get_by_role('button',name='관리 창 닫기',exact=True)).to_have_count(1)
    expect(settings.get_by_role('dialog',name='위젯 설정',exact=True)).to_have_attribute('aria-modal','false')
    settings.get_by_role('button',name='표시·색상').click()
    expect(settings.get_by_role('group',name='앱 색상 팔레트')).to_be_visible()
    archive=context.new_page();archive.on('pageerror',lambda e:errors.append(str(e)))
    archive.goto('http://127.0.0.1:5187/test-artifacts/palette.html?view=archive&compose=1')
    editor=archive.get_by_role('textbox',name='메모 내용');expect(editor).to_be_focused()
    editor.fill('색상을 바꿔도 작성 중인 한글 메모가 유지됩니다.\n다음 회의를 준비합니다.')
    expect(archive.locator('.memo-compose').get_by_role('status')).to_have_text('자동 저장됨')
    overlay=context.new_page();overlay.on('pageerror',lambda e:errors.append(str(e)))
    overlay.goto('http://127.0.0.1:5187/test-artifacts/palette.html?view=overlay')
    overlay.get_by_test_id('now-focus-overlay-open').click()
    ids=settings.evaluate('palettes.map(p=>({id:p.id,label:p.label,canvas:p.canvas}))')
    for palette in ids:
        settings.get_by_role('button',name=palette['label']+' 팔레트',exact=True).click()
        for page in [settings,archive,overlay]:
            page.wait_for_function('(id)=>document.documentElement.dataset.palette===id',arg=palette['id'])
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.wait_for_timeout(180)
            page.screenshot(path=str(out/f"{palette['id']}-{['settings','archive','overlay'][[settings,archive,overlay].index(page)]}.png"))
        expect(editor).to_have_value('색상을 바꿔도 작성 중인 한글 메모가 유지됩니다.\n다음 회의를 준비합니다.')
        close=archive.get_by_role('button',name='메모 보관함 닫기',exact=True).bounding_box()
        assert close['width']==40 and close['height']==40
        results.append({'palette':palette['id'],'synced':True,'draftPreserved':True,'close40':True})
    settings.reload();settings.wait_for_function("document.documentElement.dataset.palette==='rose'")
    settings.get_by_role('button',name='표시·색상').click()
    expect(settings.get_by_role('button',name='로즈 팔레트',exact=True)).to_have_attribute('aria-pressed','true')
    settings.evaluate("()=>{window.write=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('fixture_disk_failure')};}")
    settings.get_by_role('button',name='세이지 팔레트',exact=True).click()
    expect(settings.get_by_role('alert')).to_contain_text('저장하지 못했습니다')
    assert settings.evaluate('document.documentElement.dataset.palette')=='rose'
    settings.evaluate('()=>{Storage.prototype.setItem=window.write;}')
    settings.get_by_role('button',name='세이지 팔레트',exact=True).click()
    for page in [settings,archive]:page.wait_for_function("document.documentElement.dataset.palette==='sage'")
    settings.set_viewport_size({'width':420,'height':720})
    settings.screenshot(path=str(out/'settings-narrow.png'))
    assert settings.evaluate('document.documentElement.scrollWidth<=innerWidth')
    archive.set_viewport_size({'width':420,'height':720});archive.screenshot(path=str(out/'archive-narrow.png'))
    archive.get_by_role('button',name='메모 보관함 닫기',exact=True).click();archive.wait_for_function('fixture.closed')
    state=archive.evaluate("JSON.parse(localStorage.getItem('daybridge.memo.preview.sessions.v2'))")
    assert state['active'] is None and any(x['text'].startswith('색상을') for x in state['archives'])
    standalone=context.new_page();standalone.on('pageerror',lambda e:errors.append(str(e)))
    standalone.goto('http://127.0.0.1:5187/test-artifacts/palette.html?view=standalone')
    expect(standalone.get_by_role('button',name='관리 창 닫기',exact=True)).to_have_count(0)
    expect(standalone.get_by_role('button',name='설정 닫기',exact=True)).to_have_count(1)
    expect(standalone.get_by_role('dialog',name='위젯 설정',exact=True)).to_have_attribute('aria-modal','true')
    standalone.get_by_role('button',name='설정 닫기',exact=True).click();standalone.wait_for_function('fixture.closed')
    assert not errors,errors
    context.close();browser.close()
(out/'result.json').write_text(json.dumps({'passed':True,'scenarios':results,'reload':True,'failedSavePreserved':True,'pageErrors':errors,'nativeVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
print('Palette checks passed: six palettes, three surfaces, reload, storage failure, memo retention, narrow layouts')
