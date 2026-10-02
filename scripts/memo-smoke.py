"""Isolated browser checks; never contacts the operating Daybridge bridge."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

artifacts = Path("test-artifacts/memo")
artifacts.mkdir(parents=True, exist_ok=True)
base = os.environ.get("DAYBRIDGE_TEST_URL", "http://127.0.0.1:5187")
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 520, "height": 500})
    page = context.new_page()
    errors, bridge_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: bridge_requests.append(request.url) if ":39393" in request.url else None)
    page.goto(base + "/?surface=memo")
    print(page.locator("main").aria_snapshot())
    memo = page.get_by_role("textbox", name="메모 내용")
    expect(memo).to_be_focused()
    page.screenshot(path=str(artifacts / "empty.png"))
    contents = "다음에 이어서 할 일\n\n회의 전 자료 확인\n떠오른 생각을 바로 적어 두기 📝"
    memo.fill(contents)
    expect(page.get_by_role("status")).to_have_text("자동 저장됨")
    page.reload()
    expect(memo).to_have_value(contents)
    page.screenshot(path=str(artifacts / "saved.png"))
    page.set_viewport_size({"width": 340, "height": 320})
    memo.fill("긴 문장과 한글 English 123 " * 60)
    expect(page.get_by_role("status")).to_have_text("자동 저장됨")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(artifacts / "narrow.png"))
    page.evaluate("() => { window.originalMemoSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new Error('quota fixture'); }; }")
    memo.fill("저장 오류 후 복원할 메모")
    expect(page.get_by_role("status")).to_have_text("저장하지 못했습니다")
    page.screenshot(path=str(artifacts / "save-error.png"))
    page.evaluate("() => { Storage.prototype.setItem = window.originalMemoSetItem; }")
    page.get_by_role("button", name="다시 저장").click()
    expect(page.get_by_role("status")).to_have_text("자동 저장됨")
    page.reload()
    expect(memo).to_have_value("저장 오류 후 복원할 메모")
    broken = context.new_page()
    broken.add_init_script("Storage.prototype.getItem = function() { throw new Error('read fixture'); }")
    broken.goto(base + "/?surface=memo")
    expect(broken.get_by_role("alert")).to_contain_text("기존 내용은 변경하지 않았습니다")
    expect(broken.get_by_role("textbox")).to_have_count(0)
    assert not errors, errors
    assert not bridge_requests, bridge_requests
    (artifacts / "result.json").write_text(json.dumps({"passed": True, "checks": ["focus", "unicode persistence", "narrow layout", "save failure and retry", "read failure protection", "bridge independence"], "errors": errors}, ensure_ascii=False, indent=2), encoding="utf-8")
    browser.close()
print("Memo browser checks: 6 passed")
