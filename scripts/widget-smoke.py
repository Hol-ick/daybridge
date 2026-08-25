"""Playwright smoke checks for Daybridge's discreet overlay and dashboard."""

import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_SETTINGS = json.dumps({
    "settings": {
        "dayStart": "09:00",
        "dayEnd": "18:00",
        "defaultFocusMinutes": 50,
        "bufferMinutes": 10,
    }
})
CALENDAR_UNCONFIGURED = json.dumps({"calendar": {"state": "unconfigured", "reason": "oauth_client_missing", "canReadBusyBlocks": False}})
EMPTY_SCHEDULE = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "blocks": [],
        "unscheduled": [],
        "calendar": {"coverage": "attention"},
    },
    "nowFocus": {"state": "free_time", "block": None, "nextFocus": None},
})
FUNCTIONAL_BOARD = json.dumps({
    "board": {
        "schemaVersion": 2,
        "activityDate": "2026-08-24",
        "missions": [],
        "quests": [],
    }
})
FUNCTIONAL_BLOCK = {
    "id": "focus-1",
    "kind": "focus",
    "displayTitle": "리눅스 학습",
    "startAt": "2026-08-24T09:00:00+09:00",
    "endAt": "2026-08-24T09:50:00+09:00",
    "status": "planned",
}
LONG_FUNCTIONAL_BLOCK = {
    **FUNCTIONAL_BLOCK,
    "displayTitle": "GitHub Actions Verify web-buyback 배포 상태와 첫 실패 로그 확인",
}
DRAG_BLOCKS = [
    {"id": "drag-a", "type": "focus", "title": "첫 번째 긴 작업 이름이 아래 줄에 표시됩니다", "displayTitle": "첫 번째 긴 작업 이름이 아래 줄에 표시됩니다", "startAt": "2026-08-24T09:00:00+09:00", "endAt": "2026-08-24T09:50:00+09:00", "status": "planned"},
    {"id": "drag-b", "type": "focus", "title": "두 번째 작업", "displayTitle": "두 번째 작업", "startAt": "2026-08-24T10:00:00+09:00", "endAt": "2026-08-24T10:50:00+09:00", "status": "planned"},
    {"id": "drag-c", "type": "focus", "title": "세 번째 작업", "displayTitle": "세 번째 작업", "startAt": "2026-08-24T13:00:00+09:00", "endAt": "2026-08-24T13:50:00+09:00", "status": "planned"},
]
DRAG_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": DRAG_BLOCKS, "unscheduled": [], "calendar": {"coverage": "fresh"}},
    "nowFocus": {"state": "focus", "block": DRAG_BLOCKS[0], "nextFocus": DRAG_BLOCKS[1]},
})
DRAG_MOVED_BLOCKS = [
    {**DRAG_BLOCKS[1], "startAt": "2026-08-24T09:00:00+09:00", "endAt": "2026-08-24T09:50:00+09:00", "locked": True, "userPositioned": True},
    {**DRAG_BLOCKS[2], "startAt": "2026-08-24T10:00:00+09:00", "endAt": "2026-08-24T10:50:00+09:00", "locked": True, "userPositioned": True},
    {**DRAG_BLOCKS[0], "startAt": "2026-08-24T13:00:00+09:00", "endAt": "2026-08-24T13:50:00+09:00", "locked": True, "userPositioned": True},
]
DRAG_MOVED_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": DRAG_MOVED_BLOCKS, "unscheduled": [], "calendar": {"coverage": "fresh"}},
    "nowFocus": {"state": "focus", "block": DRAG_MOVED_BLOCKS[0], "nextFocus": DRAG_MOVED_BLOCKS[1]},
})
FUNCTIONAL_SCHEDULE = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "label": "오늘 시간표",
        "blocks": [FUNCTIONAL_BLOCK],
        "unscheduled": [],
        "calendar": {"coverage": "fresh"},
    },
    "nowFocus": {"state": "focus", "block": FUNCTIONAL_BLOCK, "nextFocus": None},
})
LONG_FUNCTIONAL_SCHEDULE = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "label": "오늘 시간표",
        "blocks": [LONG_FUNCTIONAL_BLOCK],
        "unscheduled": [],
        "calendar": {"coverage": "fresh"},
    },
    "nowFocus": {"state": "focus", "block": LONG_FUNCTIONAL_BLOCK, "nextFocus": None},
})
FUNCTIONAL_COMPLETED = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "label": "오늘 시간표",
        "blocks": [{**FUNCTIONAL_BLOCK, "status": "completed"}],
        "unscheduled": [],
        "calendar": {"coverage": "fresh"},
    },
    "nowFocus": {"state": "free_time", "block": None, "nextFocus": None},
})
MANUAL_CREATED = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "label": "오늘 시간표",
        "blocks": [
            {**FUNCTIONAL_BLOCK, "id": "focus-manual-1", "questId": "manual-1", "displayTitle": "리눅스 학습"},
            {**FUNCTIONAL_BLOCK, "id": "focus-manual-2", "questId": "manual-1", "displayTitle": "리눅스 학습", "startAt": "2026-08-24T10:00:00+09:00", "endAt": "2026-08-24T10:50:00+09:00"},
        ],
        "unscheduled": [],
        "calendar": {"coverage": "fresh"},
    },
    "nowFocus": {"state": "focus", "block": {**FUNCTIONAL_BLOCK, "id": "focus-manual-1", "questId": "manual-1", "displayTitle": "리눅스 학습"}, "nextFocus": None},
    "quest": {"id": "manual-1", "title": "리눅스 학습", "estimateMinutes": 100},
})


def assert_no_page_errors(errors: list[str]) -> None:
    assert not errors, errors


def check_dashboard(browser) -> None:
    context = browser.new_context(viewport={"width": 960, "height": 760}, device_scale_factor=1)
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
    )
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=EMPTY_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/connect",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto("http://127.0.0.1:5173", wait_until="domcontentloaded")
    assert page.locator('[data-testid="schedule-dashboard"]').count() == 1
    assert page.locator('[data-testid="schedule-now-focus"]').count() == 1
    assert page.locator('[data-testid="schedule-timeline"]').count() == 0
    assert page.locator('[data-testid="schedule-empty"]').count() == 1
    assert page.locator('[data-testid="quest-item"]').count() == 0
    page.locator('[data-testid="calendar-connect"]').click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('연결 준비')")
    assert "연결 준비" in page.locator('[role="status"]').inner_text()

    dashboard_artifact = Path("test-artifacts/daybridge-schedule-dashboard-default.png")
    dashboard_artifact.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(dashboard_artifact), full_page=True)

    page.locator('[data-testid="schedule-settings"]').click()
    page.wait_for_selector('form[aria-label="시간표 설정"]')
    assert page.get_by_label("시작 시간").input_value() == "09:00"
    assert page.get_by_label("마감 시간").input_value() == "18:00"
    assert page.get_by_label("오버레이에서 작업명 숨기기").is_visible()
    settings_box = page.locator('form[aria-label="시간표 설정"]').bounding_box()
    assert settings_box and round(settings_box["width"]) == 288

    artifact = Path("test-artifacts/daybridge-schedule-dashboard.png")
    artifact.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(artifact), full_page=True)
    assert_no_page_errors(errors)
    context.close()


def check_dashboard_actions(browser) -> None:
    """Prove the management surface is wired to command endpoints, not a static mock."""
    context = browser.new_context(viewport={"width": 960, "height": 760}, device_scale_factor=1)
    report_calls: list[dict] = []
    settings_calls: list[dict] = []
    manual_calls: list[dict] = []

    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/board(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=FUNCTIONAL_BOARD),
    )
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=FUNCTIONAL_SCHEDULE),
    )

    def handle_report(route) -> None:
        report_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=FUNCTIONAL_COMPLETED)

    context.route("http://127.0.0.1:39393/api/schedule/block-report", handle_report)

    def handle_manual(route) -> None:
        manual_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=201, content_type="application/json", body=MANUAL_CREATED)

    context.route("http://127.0.0.1:39393/api/quests/manual", handle_manual)

    def handle_settings(route) -> None:
        if route.request.method == "PUT":
            settings_calls.append(json.loads(route.request.post_data or "{}"))
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"settings": {"dayStart": "09:00", "dayEnd": "18:00", "defaultFocusMinutes": 50, "bufferMinutes": 5}}))
        else:
            route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS)

    context.route("http://127.0.0.1:39393/api/schedule-settings", handle_settings)
    context.route(
        "http://127.0.0.1:39393/api/schedule/rebuild",
        lambda route: route.fulfill(status=200, content_type="application/json", body=FUNCTIONAL_COMPLETED),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )

    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173", wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="schedule-timeline"]')
    assert page.get_by_text("리눅스 학습", exact=True).count() >= 1

    page.locator('[data-testid="schedule-block-complete-focus-1"]').click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('집중 시간을 완료했어요')")
    assert report_calls and report_calls[0]["blockId"] == "focus-1" and report_calls[0]["status"] == "completed"

    page.locator('[data-testid="schedule-settings"]').click()
    page.wait_for_selector('form[aria-label="시간표 설정"]')
    page.locator('select[name="bufferMinutes"]').select_option("5")
    page.get_by_role("button", name="저장하고 재배치").click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('시간표 설정을 저장했어요')")
    assert settings_calls and settings_calls[0]["bufferMinutes"] == 5

    page.locator('[data-testid="manual-task-add-toggle"]').click()
    page.locator('[data-testid="manual-task-title"]').fill("리눅스 학습")
    page.locator('[data-testid="manual-task-duration-100"]').click()
    page.screenshot(path="test-artifacts/daybridge-schedule-dashboard-manual-form.png", full_page=True)
    page.locator('[data-testid="manual-task-submit"]').click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('100분으로 배치했어요')")
    assert manual_calls and manual_calls[0]["title"] == "리눅스 학습" and manual_calls[0]["durationMinutes"] == 100
    assert page.locator('[data-testid="manual-task-form"]').count() == 0

    assert_no_page_errors(errors)
    context.close()


def check_overlay(browser) -> None:
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=EMPTY_SCHEDULE),
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto("http://127.0.0.1:5173/?surface=overlay", wait_until="domcontentloaded")
    overlay = page.locator('[data-testid="now-focus-overlay"]')
    assert overlay.count() == 1
    surface = page.locator('[data-testid="now-focus-overlay-surface"]')
    box = surface.bounding_box()
    assert box and round(box["width"]) == 288 and round(box["height"]) == 64
    assert page.locator('[data-testid="now-focus-overlay-title"]').count() == 1
    assert page.get_by_text("시간표 확인", exact=True).count() == 0
    assert page.locator('[data-testid="now-focus-overlay-title"]').evaluate("element => getComputedStyle(element).userSelect") == "none"
    leave_timer = page.locator('[data-testid="now-focus-overlay-leave-time"]')
    assert page.locator('[data-testid="now-focus-overlay-complete"]').count() == 0
    assert page.locator('[data-testid^="now-focus-overlay-defer-"]').count() == 0
    assert leave_timer.count() == 1
    idle_label = re.sub(r"\s+", " ", page.locator('[data-testid="now-focus-overlay-title"]').text_content() or "").strip()
    assert re.fullmatch(r"(근무 시작까지|점심시간까지|오후 시작까지|퇴근시간까지|근무 종료)", idle_label), idle_label
    leave_timer_value = page.locator('[data-testid="now-focus-overlay-leave-time-value"]')
    assert re.fullmatch(r"\d{2}:\d{2}", leave_timer_value.text_content() or "")
    assert page.locator('[data-testid="now-focus-overlay-leave-time"] [class*=timerLabel]').count() == 0
    assert page.locator('[data-testid="now-focus-overlay-title"]').get_attribute("aria-label") == f"{idle_label} {leave_timer_value.text_content().strip()}"
    title_style = page.locator('[data-testid="now-focus-overlay-title"]').evaluate(
        "element => { const style = getComputedStyle(element); return { fontSize: parseFloat(style.fontSize), fontWeight: parseInt(style.fontWeight, 10), fontFamily: style.fontFamily }; }"
    )
    assert title_style["fontSize"] >= 17 and title_style["fontWeight"] >= 800, title_style
    if leave_timer.count():
        leave_style = page.locator('[data-testid="now-focus-overlay-leave-time-value"]').evaluate(
            "element => { const style = getComputedStyle(element); return { fontSize: parseFloat(style.fontSize), fontWeight: parseInt(style.fontWeight, 10), fontFamily: style.fontFamily }; }"
        )
        assert leave_style["fontSize"] >= 27 and leave_style["fontWeight"] >= 800, leave_style
    assert page.locator('[data-testid="now-focus-overlay"] > div').evaluate("element => getComputedStyle(element).cursor") == "grab"
    assert page.locator('[data-testid="schedule-dashboard"]').count() == 0
    assert page.locator('[data-testid="quest-item"]').count() == 0

    artifact = Path("test-artifacts/daybridge-schedule-overlay.png")
    artifact.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(artifact), full_page=True)
    page.evaluate("""() => {
        const element = document.querySelector('[data-testid="now-focus-overlay-title"]');
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }""")
    assert page.evaluate("window.getSelection().rangeCount") == 1
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    assert page.evaluate("window.getSelection().rangeCount") == 0
    page.wait_for_timeout(100)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-animation-mid.png", full_page=True)
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().height) === 520")
    expanded_box = surface.bounding_box()
    assert expanded_box and round(expanded_box["height"]) == 520
    summary_box = page.locator('[data-testid="now-focus-overlay-summary"]').bounding_box()
    assert summary_box and abs((summary_box["y"] + summary_box["height"]) - (expanded_box["y"] + expanded_box["height"])) <= 1
    assert page.locator('[data-testid="now-focus-overlay-expanded"]').is_visible()
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-expanded.png", full_page=True)
    transition_duration = page.locator('[data-testid="now-focus-overlay-expanded"]').evaluate("element => parseFloat(getComputedStyle(element).transitionDuration)")
    assert transition_duration > 0
    transform_origin = page.locator('[data-testid="now-focus-overlay-expanded"]').evaluate("element => getComputedStyle(element).transformOrigin")
    assert transform_origin.split()[-1].startswith("456") or transform_origin.split()[-1].startswith("100%"), transform_origin
    assert page.get_by_text("여유 시간", exact=True).count() == 0
    page.locator('[data-testid="manual-task-add-toggle"]').click()
    page.locator('[data-testid="manual-task-title"]').fill("리눅스 학습")
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-manual-form.png", full_page=True)
    page.locator('[data-testid="manual-task-cancel"]').click()
    compact_block = page.locator('[data-testid^="now-focus-overlay-block-"]').first
    if compact_block.count():
        row_style = compact_block.evaluate(
            "element => { const style = getComputedStyle(element); const title = element.querySelector('[class*=compactBlockTitle]'); const time = element.querySelector('[class*=compactBlockTime]'); return { display: style.display, columns: style.gridTemplateColumns, titleSize: parseFloat(getComputedStyle(title).fontSize), timeSize: parseFloat(getComputedStyle(time).fontSize) }; }"
        )
        assert compact_block.locator('[class*=compactBlockTime]').inner_text().strip().count("–") == 0
        assert row_style["display"] == "grid" and row_style["titleSize"] >= 17 and row_style["timeSize"] >= 17, row_style
    assert page.locator('[data-testid="now-focus-overlay-collapse"]').count() == 0
    page.mouse.click(310, 10)
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'true'")
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'true'")
    page.wait_for_timeout(100)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-animation-close-mid.png", full_page=True)
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().height) === 64")
    collapsed_box = surface.bounding_box()
    assert collapsed_box and round(collapsed_box["height"]) == 64
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    with page.expect_navigation(wait_until="domcontentloaded"):
        page.locator('[data-testid="now-focus-overlay-expanded"]').get_by_role("button", name="전체 시간표").click()
    assert "surface=dashboard" in page.url
    assert page.locator('[data-testid="schedule-dashboard"]').count() == 1
    assert_no_page_errors(errors)
    context.close()


def check_overlay_long_title(browser) -> None:
    """Prove long card titles stay on one marquee line and removed controls stay absent."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=LONG_FUNCTIONAL_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/?surface=overlay", wait_until="domcontentloaded")
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_selector('[data-testid="now-focus-overlay-block-focus-1"]')
    page.wait_for_selector('[data-testid="now-focus-overlay-block-focus-1"] [class*=compactBlockTitle]')
    assert page.locator('[data-testid="now-focus-overlay-complete"]').count() == 0
    assert page.locator('[data-testid^="now-focus-overlay-defer-"]').count() == 0
    assert page.locator('[data-testid="now-focus-overlay-collapse"]').count() == 0
    title_viewport = page.locator('[data-testid="now-focus-overlay-block-focus-1"] [class*=compactBlockTitle]')
    marquee = title_viewport.locator('[class*=titleTrackMoving]')
    assert marquee.count() == 1
    title_style = page.locator('[data-testid="now-focus-overlay-block-focus-1"] [class*=compactBlockTitle]').evaluate("element => { const style = getComputedStyle(element); return { whiteSpace: style.whiteSpace, display: style.display, lineHeight: style.lineHeight }; }")
    assert title_style["whiteSpace"] == "nowrap" and title_style["display"] == "block", title_style
    animation_name = marquee.evaluate("element => getComputedStyle(element).animationName")
    assert "overlay-title-marquee" in animation_name, animation_name
    initial_transform = marquee.evaluate("element => getComputedStyle(element).transform")
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-marquee.png", full_page=True)
    page.wait_for_timeout(4_500)
    assert marquee.evaluate("element => getComputedStyle(element).transform") != initial_transform
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-marquee-moved.png", full_page=True)
    assert_no_page_errors(errors)
    context.close()


def check_overlay_reorder(browser) -> None:
    """Prove cards expose the top controls/lower title layout and persist drag reorder."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    move_calls: list[dict] = []
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=DRAG_SCHEDULE),
    )

    def handle_move(route) -> None:
        move_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=DRAG_MOVED_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-move", handle_move)
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/?surface=overlay", wait_until="domcontentloaded")
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().height) === 520")
    first = page.locator('[data-testid="now-focus-overlay-block-drag-a"]')
    second = page.locator('[data-testid="now-focus-overlay-block-drag-b"]')
    assert first.get_attribute("data-drag-enabled") == "true"
    card_layout = first.evaluate("element => { const top = element.querySelector('[class*=compactBlockTop]'); const title = element.querySelector('[class*=compactBlockTitle]'); return { display: getComputedStyle(element).display, topDisplay: getComputedStyle(top).display, titleIndex: Array.from(element.children).indexOf(title), titleSize: parseFloat(getComputedStyle(title).fontSize), timeSize: parseFloat(getComputedStyle(element.querySelector('[class*=compactBlockTime]')).fontSize) }; }")
    assert card_layout["display"] == "flex" and card_layout["topDisplay"] == "flex" and card_layout["titleIndex"] == 1, card_layout
    assert card_layout["titleSize"] >= 18 and card_layout["timeSize"] >= 18, card_layout
    first_box = first.bounding_box()
    second_box = second.bounding_box()
    assert first_box and second_box
    manual_box = page.locator('[data-testid="manual-task-add-toggle"]').bounding_box()
    assert manual_box and manual_box["y"] > second_box["y"] + second_box["height"], manual_box
    source_x = first_box["x"] + first_box["width"] / 2
    source_y = first_box["y"] + first_box["height"] / 2
    target_x = second_box["x"] + second_box["width"] / 2
    target_y = second_box["y"] + 10
    pointer_id = 41
    first.dispatch_event("pointerdown", {"pointerId": pointer_id, "pointerType": "mouse", "button": 0, "clientX": source_x, "clientY": source_y})
    first.dispatch_event("pointermove", {"pointerId": pointer_id, "pointerType": "mouse", "button": -1, "clientX": source_x + 8, "clientY": source_y + 8})
    first.dispatch_event("pointermove", {"pointerId": pointer_id, "pointerType": "mouse", "button": -1, "clientX": target_x, "clientY": target_y})
    first.dispatch_event("pointerup", {"pointerId": pointer_id, "pointerType": "mouse", "button": 0, "clientX": target_x, "clientY": target_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-b]')?.getBoundingClientRect().top < document.querySelector('[data-testid=now-focus-overlay-block-drag-a]')?.getBoundingClientRect().top")
    assert move_calls and move_calls[0]["blockId"] == "drag-a" and move_calls[0]["targetBlockId"] == "drag-b"
    assert move_calls[0]["position"] in {"before", "after"}
    assert page.locator('[data-testid="now-focus-overlay-block-drag-b"]').bounding_box()["y"] < page.locator('[data-testid="now-focus-overlay-block-drag-a"]').bounding_box()["y"]
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-dragged.png", full_page=True)
    assert_no_page_errors(errors)
    context.close()


def main() -> None:
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        chrome_path = os.environ.get("DAYBRIDGE_CHROME")
        if chrome_path:
            launch_options["executable_path"] = chrome_path
        browser = playwright.chromium.launch(**launch_options)
        check_dashboard(browser)
        check_dashboard_actions(browser)
        check_overlay(browser)
        check_overlay_long_title(browser)
        check_overlay_reorder(browser)
        browser.close()


if __name__ == "__main__":
    main()
