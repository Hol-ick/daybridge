"""Isolated browser checks; never contacts operating Daybridge or native memo files."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

artifacts = Path("test-artifacts/memo")
artifacts.mkdir(parents=True, exist_ok=True)
base = os.environ.get("DAYBRIDGE_TEST_URL", "http://127.0.0.1:5187")
key = "daybridge.memo.preview.sessions.v2"
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 360, "height": 360})
    page = context.new_page()
    errors, bridge_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: bridge_requests.append(request.url) if ":39393" in request.url else None)
    page.goto(base + "/?surface=memo")
    memo = page.get_by_role("textbox", name="메모 내용")
    expect(memo).to_be_focused()
    assert page.get_by_role("heading").count() == 0
    assert page.locator("kbd, footer, .memo-brand").count() == 0
    page.screenshot(path=str(artifacts / "empty.png"))
    contents = "회의 전 자료 확인\n떠오른 생각을 바로 적어 두기 📝\n마지막 글자"
    memo.fill(contents)
    # Close before debounce expires; final snapshot must still be archived.
    page.get_by_role("button", name="메모 닫기", exact=True).click()
    expect(page.get_by_role("button", name="메모 열기", exact=True)).to_be_visible()
    state = page.evaluate("key => JSON.parse(localStorage.getItem(key))", key)
    assert state["active"] is None and len(state["archives"]) == 1 and state["archives"][0]["text"] == contents
    page.get_by_role("button", name="메모 열기", exact=True).click()
    expect(memo).to_have_value("")
    memo.fill(contents)
    memo.press("Escape")
    expect(page.get_by_role("button", name="메모 열기", exact=True)).to_be_visible()
    assert len(page.evaluate("key => JSON.parse(localStorage.getItem(key)).archives", key)) == 2
    page.get_by_role("button", name="메모 열기", exact=True).click()
    memo.fill(" \n\t")
    page.get_by_role("button", name="메모 닫기", exact=True).click()
    expect(page.get_by_role("button", name="메모 열기", exact=True)).to_be_visible()
    assert len(page.evaluate("key => JSON.parse(localStorage.getItem(key)).archives", key)) == 2
    page.get_by_role("button", name="메모 열기", exact=True).click()
    memo.fill(contents)
    expect(page.get_by_role("status")).to_have_text("자동 저장됨")
    page.reload()
    expect(memo).to_have_value(contents)
    expect(page.get_by_text("작성 중이던 메모를 복구했습니다.", exact=True)).to_be_visible()
    memo.fill(contents + "\n수정")
    expect(page.get_by_role("status")).to_have_text("자동 저장됨")
    page.screenshot(path=str(artifacts / "saved.png"))
    for scale in [1, 1.5, 2]:
        scaled = browser.new_context(viewport={"width": 280, "height": 220}, device_scale_factor=scale)
        scaled_page = scaled.new_page()
        scaled_page.goto(base + "/?surface=memo")
        narrow = scaled_page.get_by_role("textbox", name="메모 내용")
        expect(narrow).to_be_enabled()
        narrow.fill("긴 문장과 한글 English 123 " * 60)
        expect(scaled_page.get_by_role("status")).to_have_text("자동 저장됨")
        assert scaled_page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight")
        box = scaled_page.get_by_role("button", name="메모 닫기").bounding_box()
        assert box and box["width"] >= 28 and box["height"] >= 28
        scaled_page.screenshot(path=str(artifacts / f"narrow-{scale}.png"))
        scaled.close()
    page.evaluate("() => { window.originalMemoSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new Error('quota fixture'); }; }")
    memo.fill("저장 오류 후 복원할 메모")
    expect(page.get_by_role("status")).to_have_text("저장하지 못했습니다")
    page.get_by_role("button", name="메모 닫기", exact=True).click()
    expect(page.get_by_role("button", name="다시 닫기", exact=True)).to_be_visible()
    expect(memo).to_have_value("저장 오류 후 복원할 메모")
    page.screenshot(path=str(artifacts / "save-error.png"))
    page.evaluate("() => { Storage.prototype.setItem = window.originalMemoSetItem; }")
    page.get_by_role("button", name="다시 닫기", exact=True).click()
    expect(page.get_by_role("button", name="메모 열기", exact=True)).to_be_visible()
    assert page.evaluate("key => JSON.parse(localStorage.getItem(key)).archives.at(-1).text", key) == "저장 오류 후 복원할 메모"
    page.get_by_role("button", name="메모 열기", exact=True).click()
    expect(memo).to_have_value("")
    broken = context.new_page()
    broken.add_init_script("Storage.prototype.getItem = function() { throw new Error('read fixture'); }")
    broken.goto(base + "/?surface=memo")
    expect(broken.get_by_role("alert")).to_contain_text("기존 내용은 변경하지 않았습니다")
    expect(broken.get_by_role("textbox")).to_be_disabled()
    broken.screenshot(path=str(artifacts / "read-error.png"))
    assert not errors, errors
    assert not bridge_requests, bridge_requests
    checks = ["minimal surface and focus", "immediate close snapshot", "blank reopen", "separate repeated notes", "blank no archive", "draft recovery", "narrow and scale layout", "save failure preserves input", "close retry", "read failure protection", "bridge independence"]
    (artifacts / "result.json").write_text(json.dumps({"passed": True, "checks": checks, "errors": errors, "nativeVerified": False}, ensure_ascii=False, indent=2), encoding="utf-8")
    browser.close()
print("Memo browser checks: 11 passed")
