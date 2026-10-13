"""Browser-only fixtures for archive row deletion and top drag hit coverage."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out=Path('test-artifacts/memo-archive-actions')
out.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in [720,420]:
        ctx=browser.new_context(viewport={'width':width,'height':680})
        ctx.add_init_script("""localStorage.setItem('daybridge.memo.preview.sessions.v2',JSON.stringify({schemaVersion:2,active:null,lastClosed:null,archives:['첫 메모','다음 메모','마지막 메모'].map((text,i)=>({id:'row-'+i,text,revision:1,createdAtUnixMs:1790922000000-i*1000,updatedAtUnixMs:1790922000000-i*1000}))}));""")
        ctx.route('http://127.0.0.1:39393/**',lambda route:route.abort())
        page=ctx.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:5187/test-artifacts/memo-design.html?panel=1')
        panel=page.get_by_role('dialog',name='메모 보관함')
        expect(panel.locator('.memo-row-delete')).to_have_count(3)
        page.wait_for_timeout(250)
        assert page.evaluate("document.elementFromPoint(innerWidth/2,3).classList.contains('memo-archive-top-drag')")
        page.evaluate('fixture.failure=true')
        panel.get_by_role('button',name='첫 메모 삭제',exact=True).click()
        expect(panel.get_by_role('alert')).to_be_visible()
        expect(panel.get_by_role('button',name='첫 메모',exact=True)).to_have_count(1)
        page.evaluate('fixture.failure=false')
        panel.get_by_role('button',name='첫 메모 삭제',exact=True).click()
        next_memo=panel.get_by_role('button',name='다음 메모',exact=True)
        expect(next_memo).to_have_attribute('aria-pressed','true')
        expect(next_memo).to_be_focused()
        page.wait_for_timeout(180)
        page.screenshot(path=str(out/f'next-{width}.png'))
        next_memo.click()
        expect(panel.locator('pre')).to_have_text('다음 메모')
        for button_name in ['로컬에 저장','일정에 등록','삭제']:
            box=panel.get_by_role('button',name=button_name,exact=True).bounding_box()
            assert box and box['height']>=48 and box['x']>=0 and box['x']+box['width']<=width
        if width<560:panel.get_by_role('button',name='목록으로',exact=True).click()
        panel.get_by_role('button',name='마지막 메모 삭제',exact=True).click()
        expect(next_memo).to_have_attribute('aria-pressed','true')
        panel.get_by_role('button',name='다음 메모 삭제',exact=True).click()
        expect(panel.get_by_text('보관한 메모가 없습니다.')).to_be_visible()
        expect(panel.get_by_role('button',name='메모 보관함 닫기',exact=True)).to_be_focused()
        assert not errors,errors
        results.append({'width':width,'sidebarDeletion':True,'nextSelected':True,'lastUsesPrevious':True,'failurePreserved':True,'focusMoved':True,'topHitCoverage':True,'largeActions':True,'pageErrors':0})
        ctx.close()
    browser.close()
(out/'result.json').write_text(json.dumps({'passed':True,'nativeVerified':False,'scenarios':results},ensure_ascii=False,indent=2),encoding='utf-8')
print('Archive action browser checks: 2 layouts passed')
