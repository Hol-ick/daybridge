"""Controlled settings flows and rendered UI; isolated from operational data."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path('test-artifacts/quiet-ui');out.mkdir(parents=True,exist_ok=True)
Path('test-artifacts/quiet-settings.html').write_text('<!doctype html><html lang="ko"><meta charset="UTF-8"><div id="root"></div><script type="module" src="/test-artifacts/quiet-settings.jsx"></script></html>',encoding='utf-8')
Path('test-artifacts/quiet-settings.jsx').write_text('''import React from 'react';import{createRoot}from'react-dom/client';
import '/src/todometer/styles/variables.css';import '/src/todometer/index.css';import '/src/appearance/theme.css';
import {initializeAppearance,useAppearance,setAppearance}from'/src/appearance/theme-store.js';
import {OverlaySettingsModal}from'/src/schedule/NowFocusOverlay.jsx';import {DEFAULT_MEALS}from'/src/schedule/settings-contract.js';
import WindowChrome from '/src/appearance/WindowChrome.jsx';
initializeAppearance();document.body.dataset.surface='dashboard';window.fixture={saved:[],refresh:0};
function Host(){const appearance=useAppearance();const [settings,update]=React.useState({timeConfigured:false,dayStart:'',dayEnd:'',bufferMinutes:10,meals:{breakfast:{...DEFAULT_MEALS.breakfast,enabled:false},lunch:{...DEFAULT_MEALS.lunch,enabled:true},dinner:{...DEFAULT_MEALS.dinner,enabled:false}}});const [routines,setRoutines]=React.useState([{id:'one',title:'메일 확인',enabled:true,estimateMinutes:25,days:[0,1,2,3,4,5,6]}]);
return <><WindowChrome/><OverlaySettingsModal showCloseButton={false} appearance={appearance}onAppearanceChange={setAppearance}scheduleSettings={settings}onScheduleSettingsChange={update}dailyDefaults={routines}onDailyDefaultsChange={setRoutines}storageDirectory='fixture-data' onSubmit={e=>{e.preventDefault();window.fixture.saved.push({settings,routines,privateMode:new FormData(e.currentTarget).get('privateOverlay')==='on'});}}onRefreshWidget={()=>window.fixture.refresh++}/></>;}
createRoot(document.getElementById('root')).render(<Host/>);
''',encoding='utf-8')
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width,palette in [(960,'paper'),(660,'paper'),(420,'paper'),(960,'plum'),(660,'plum'),(420,'plum')]:
        ctx=browser.new_context(viewport={'width':width,'height':760},reduced_motion='reduce')
        ctx.route('http://127.0.0.1:39393/**',lambda route:route.abort())
        ctx.add_init_script(f"localStorage.setItem('daybridge.appearance.v1',JSON.stringify({{paletteId:'{palette}'}}))")
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:5187/test-artifacts/quiet-settings.html')
        dialog=page.get_by_role('dialog',name='위젯 설정',exact=True)
        expect(dialog.get_by_text('설정',exact=True)).to_be_visible()
        for button in page.get_by_role('navigation',name='설정 메뉴').get_by_role('button').all():
            assert button.evaluate("e=>getComputedStyle(e).borderTopWidth")=='0px'
        expect(page.get_by_role('button',name='설정 닫기',exact=True)).to_have_count(0)
        expect(page.get_by_role('button',name='관리 창 닫기',exact=True)).to_have_count(1)
        expect(page.get_by_label('출근',exact=True)).to_have_count(0)
        assert page.locator('input[type=time]').count()==2  # enabled lunch only
        assert '필요할 때 켜세요' not in dialog.inner_text()
        assert '표시 방식과 매일 반복할 일을 관리합니다.' not in dialog.inner_text()
        page.screenshot(path=str(out/f'schedule-off-{width}-{palette}.png'))
        checkbox=page.get_by_role('checkbox',name='시간표 사용',exact=True)
        checkbox.focus();checkbox.press('Space');expect(checkbox).to_be_checked()
        page.get_by_label('출근',exact=True).fill('08:30');page.get_by_label('퇴근',exact=True).fill('17:30')
        page.get_by_label('작업 사이 간격').fill('5')
        meal=page.get_by_role('checkbox',name='아침',exact=True);meal.focus();meal.press('Space')
        breakfast=page.locator('[class*=mealSettingRow]').filter(has=meal)
        breakfast.get_by_label('시작',exact=True).fill('07:00')
        meal.press('Space');expect(breakfast.get_by_label('시작',exact=True)).to_have_count(0)
        meal.press('Space');expect(breakfast.get_by_label('시작',exact=True)).to_have_value('07:00')
        page.screenshot(path=str(out/f'schedule-on-{width}-{palette}.png'))
        page.get_by_role('button',name='화면',exact=True).click()
        private=page.get_by_role('checkbox',name='위젯에서 작업명 숨기기',exact=True);private.focus();private.press('Space')
        expect(private).to_be_checked()
        page.screenshot(path=str(out/f'display-{width}-{palette}.png'))
        page.get_by_role('button',name='반복 일정',exact=True).click()
        page.get_by_label('메일 확인 기본 일정 제목').fill('회의 준비')
        page.get_by_label('새 매일 기본 일정').fill('문서 검토')
        page.get_by_role('button',name='＋ 추가',exact=True).click()
        expect(page.get_by_label('문서 검토 기본 일정 제목')).to_have_value('문서 검토')
        page.get_by_role('button',name='회의 준비 자동 추가',exact=True).click()
        expect(page.get_by_role('button',name='회의 준비 자동 추가',exact=True)).to_have_attribute('aria-pressed','false')
        page.get_by_role('button',name='문서 검토 삭제',exact=True).click()
        page.get_by_role('button',name='위젯 새로고침',exact=True).click()
        assert page.evaluate('fixture.refresh')==1
        page.get_by_role('button',name='저장',exact=True).click()
        saved=page.evaluate('fixture.saved.at(-1)')
        assert saved['settings']['dayStart']=='08:30' and saved['settings']['bufferMinutes']=='5'
        assert saved['settings']['meals']['breakfast']['start']=='07:00'
        assert saved['privateMode'] and len(saved['routines'])==1
        page.screenshot(path=str(out/f'defaults-{width}-{palette}.png'))
        page.get_by_role('button',name='화면',exact=True).click();expect(page.get_by_role('checkbox',name='위젯에서 작업명 숨기기')).to_be_checked()
        page.get_by_role('button',name='시간표',exact=True).click();expect(page.get_by_label('출근',exact=True)).to_have_value('08:30')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        save=page.get_by_role('button',name='저장',exact=True).bounding_box();assert save['width']<130 and save['height']==36
        assert not errors,errors
        results.append({'width':width,'palette':palette,'controlledInputs':True,'hiddenMealPreserved':True,'privacyAcrossTabs':True,'footer36':True,'pageErrors':0})
        ctx.close()
    browser.close()
(out/'result.json').write_text(json.dumps({'passed':True,'scenarios':results,'nativeVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
print('Quiet UI: six settings layouts and edit/save/keyboard flows passed')
