"""Actual settings flow using isolated responses and browser storage only."""
import importlib.util
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

os.environ['DAYBRIDGE_PREVIEW_URL']='http://127.0.0.1:5187'
spec=importlib.util.spec_from_file_location('widget_smoke',Path(__file__).with_name('widget-smoke.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
out=Path('test-artifacts/overlay-recovery');out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width,palette in [(960,'plum'),(420,'paper')]:
        context=fixture.fixture_context(browser,viewport={'width':width,'height':760},reduced_motion='reduce')
        context.add_init_script(f"localStorage.setItem('daybridge.appearance.v1',JSON.stringify({{paletteId:'{palette}'}}))")
        context.route(re.compile(r'http://127\.0\.0\.1:39393/api/schedule(?:\?|$)'),lambda r:r.fulfill(status=200,content_type='application/json',body=fixture.EMPTY_SCHEDULE))
        def settings(r):
            body=json.loads(fixture.DEFAULT_SETTINGS) if r.request.method=='GET' else {'settings':r.request.post_data_json,**json.loads(fixture.EMPTY_SCHEDULE)}
            r.fulfill(status=200,content_type='application/json',body=json.dumps(body))
        context.route('http://127.0.0.1:39393/api/schedule-settings',settings)
        context.route('http://127.0.0.1:39393/api/calendar/status',lambda r:r.fulfill(status=200,content_type='application/json',body=fixture.CALENDAR_UNCONFIGURED))
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def open_display():
            page.get_by_test_id('schedule-settings').click()
            page.get_by_role('button',name='화면',exact=True).click()
            expect(page.get_by_label('복구 대기')).to_be_visible()
        page.goto(fixture.BASE_URL+'/?surface=dashboard');open_display()
        delay=page.get_by_label('복구 대기');toggle=page.get_by_role('checkbox',name='자동 전면 복구',exact=True)
        expect(delay).to_have_value('10');expect(toggle).to_be_checked()
        delay.fill('25');page.get_by_text('자동 전면 복구',exact=True).click();expect(toggle).not_to_be_checked()
        page.get_by_role('button',name='반복 일정',exact=True).click()
        page.get_by_role('button',name='저장',exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')||'null')?.delaySeconds===25")
        assert page.evaluate("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')).enabled") is False
        page.reload();open_display();expect(delay).to_have_value('25');expect(toggle).not_to_be_checked()
        delay.fill('0');page.get_by_role('button',name='저장',exact=True).click()
        assert delay.evaluate('e=>!e.validity.valid')
        assert page.evaluate("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')).delaySeconds")==25
        delay.fill('40')
        page.evaluate("()=>{window.recoveryOriginalWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='daybridge.overlay-recovery.v1')throw new Error('복구 설정 저장 실패');return window.recoveryOriginalWrite.call(this,k,v)}}")
        page.get_by_role('button',name='저장',exact=True).click()
        page.get_by_test_id('daybridge-settings-toast').filter(has_text='복구 설정 저장 실패').wait_for()
        assert page.evaluate("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')).delaySeconds")==25
        page.screenshot(path=str(out/f'error-{width}.png'))
        page.evaluate('()=>{Storage.prototype.setItem=window.recoveryOriginalWrite}')
        delay.fill('30');toggle.focus();toggle.press('Space');page.get_by_role('button',name='저장',exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')||'null')?.delaySeconds===30")
        assert page.evaluate("JSON.parse(localStorage.getItem('daybridge.overlay-recovery.v1')).enabled") is True
        page.get_by_test_id('daybridge-settings-toast').filter(has_text='설정 저장됨').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(out/f'settings-{width}.png'))
        assert not errors,errors
        results.append({'width':width,'palette':palette,'saveAcrossTabs':True,'reload':True,'disabled':True,'invalidRejected':True,'writeFailurePreserved':True,'retry':True,'pageErrors':0})
        fixture.close_fixture_context(context)
    browser.close()
(out/'result.json').write_text(json.dumps({'passed':True,'scenarios':results,'realKakaoNotificationVerified':False},ensure_ascii=False,indent=2),encoding='utf8')
print('Recovery settings save/reload/off/invalid/failure/retry passed at 960 and 420 pixels')
