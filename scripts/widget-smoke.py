"""Playwright smoke checks for Daybridge's discreet overlay and dashboard."""

import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_SETTINGS = json.dumps({
    "settings": {
        "dayStart": "",
        "dayEnd": "",
        "timeConfigured": False,
        "defaultFocusMinutes": 50,
        "bufferMinutes": 10,
    }
})
DAILY_DEFAULTS = json.dumps({
    "dailyDefaults": {
        "schemaVersion": 1,
        "routines": [{"id": "supplement", "title": "영양제 먹기", "estimateMinutes": 25, "days": [0, 1, 2, 3, 4, 5, 6], "enabled": True}],
    }
})
CALENDAR_UNCONFIGURED = json.dumps({"calendar": {"state": "unconfigured", "reason": "oauth_client_missing", "canReadBusyBlocks": False}})
EMPTY_SCHEDULE = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "mode": "todo",
        "timeConfigured": False,
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "blocks": [],
        "unscheduled": [],
        "calendar": {"coverage": "attention"},
    },
    "nowFocus": {"state": "free_time", "block": None, "nextFocus": None},
})
TODO_BLOCKS = [
    {"id": "todo-linux", "type": "focus", "questId": "quest-linux", "title": "리눅스 학습", "order": 0, "timed": False, "status": "planned"},
    {"id": "todo-docs", "type": "focus", "questId": "quest-docs", "title": "문서 검토", "order": 1, "timed": False, "status": "in_progress"},
]
TODO_DISCARDED_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "mode": "todo", "timeConfigured": False, "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": [TODO_BLOCKS[1]], "discardedBlocks": [{"blockId": "todo-linux", "questId": "quest-linux", "title": "리눅스 학습", "units": 1}], "unscheduled": [], "calendar": {"coverage": "attention"}},
    "nowFocus": {"state": "todo_list", "block": None, "nextFocus": None},
})
TODO_REORDERED_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "mode": "todo", "timeConfigured": False, "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": [{**TODO_BLOCKS[1], "order": 0}, {**TODO_BLOCKS[0], "order": 1}], "unscheduled": [], "calendar": {"coverage": "attention"}},
    "nowFocus": {"state": "todo_list", "block": None, "nextFocus": None},
})
TODO_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "mode": "todo", "timeConfigured": False, "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": TODO_BLOCKS, "unscheduled": [], "calendar": {"coverage": "attention"}},
    "nowFocus": {"state": "todo_list", "block": None, "nextFocus": None},
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
    {"id": "drag-a", "type": "focus", "title": "메일 확인", "displayTitle": "메일 확인", "startAt": "2026-08-24T09:00:00+09:00", "endAt": "2026-08-24T09:50:00+09:00", "status": "planned"},
    {"id": "drag-b", "type": "focus", "title": "리눅스 학습", "displayTitle": "리눅스 학습", "startAt": "2026-08-24T10:00:00+09:00", "endAt": "2026-08-24T10:50:00+09:00", "status": "planned"},
    {"id": "drag-c", "type": "focus", "title": "내일 계획", "displayTitle": "내일 계획", "startAt": "2026-08-24T13:00:00+09:00", "endAt": "2026-08-24T13:50:00+09:00", "status": "planned"},
]
DRAG_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": DRAG_BLOCKS, "unscheduled": [], "calendar": {"coverage": "fresh"}},
    "nowFocus": {"state": "focus", "block": DRAG_BLOCKS[0], "nextFocus": DRAG_BLOCKS[1]},
})
TALL_SCHEDULE = json.dumps({
    "schedule": {
        "schemaVersion": 1,
        "date": "2026-08-24",
        "timezone": "Asia/Seoul",
        "generatedAt": "2026-08-24T00:00:00+09:00",
        "blocks": [
            {**DRAG_BLOCKS[index % len(DRAG_BLOCKS)], "id": f"tall-{index}", "startAt": f"2026-08-24T{9 + index:02d}:00:00+09:00", "endAt": f"2026-08-24T{9 + index:02d}:50:00+09:00"}
            for index in range(8)
        ],
        "unscheduled": [],
        "calendar": {"coverage": "fresh"},
    },
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
DRAG_STATUS_BLOCKS = [{**block, "status": "in_progress" if block["id"] == "drag-b" else block["status"]} for block in DRAG_MOVED_BLOCKS]
DRAG_STATUS_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": DRAG_STATUS_BLOCKS, "unscheduled": [], "calendar": {"coverage": "fresh"}},
    "nowFocus": {"state": "focus", "block": DRAG_STATUS_BLOCKS[0], "nextFocus": DRAG_STATUS_BLOCKS[1]},
})
DRAG_DISCARDED_BLOCKS = [block for block in DRAG_STATUS_BLOCKS if block["id"] != "drag-a"]
DRAG_DISCARDED_SCHEDULE = json.dumps({
    "schedule": {"schemaVersion": 1, "date": "2026-08-24", "timezone": "Asia/Seoul", "generatedAt": "2026-08-24T00:00:00+09:00", "blocks": DRAG_DISCARDED_BLOCKS, "discardedBlocks": [{"blockId": "drag-a", "questId": "quest-drag-a", "title": "메일 확인", "units": 1}], "unscheduled": [], "calendar": {"coverage": "fresh"}},
    "nowFocus": {"state": "focus", "block": DRAG_DISCARDED_BLOCKS[0], "nextFocus": DRAG_DISCARDED_BLOCKS[1]},
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


def freeze_page_date(context, iso_timestamp: str) -> None:
    """Keep fixture dates and the UI's local activity date in the same day."""
    context.add_init_script(f"""
        (() => {{
            const RealDate = Date;
            const fixed = RealDate.parse({json.dumps(iso_timestamp)});
            class FixedDate extends RealDate {{
                constructor(...args) {{ super(...(args.length ? args : [fixed])); }}
                static now() {{ return fixed; }}
            }}
            window.Date = FixedDate;
        }})();
    """)


def check_dashboard(browser) -> None:
    context = browser.new_context(viewport={"width": 960, "height": 760}, device_scale_factor=1)
    daily_defaults_calls: list[dict] = []
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=EMPTY_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
    )
    def handle_daily_defaults(route) -> None:
        if route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=DAILY_DEFAULTS)
            return
        payload = json.loads(route.request.post_data or "{}")
        daily_defaults_calls.append(payload)
        response = json.loads(DAILY_DEFAULTS)
        response.update(json.loads(EMPTY_SCHEDULE))
        response["dailyDefaults"] = payload.get("dailyDefaults", response["dailyDefaults"])
        route.fulfill(status=200, content_type="application/json", body=json.dumps(response))

    context.route("http://127.0.0.1:39393/api/daily-defaults", handle_daily_defaults)
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
    page.wait_for_selector('form[aria-label="위젯 설정"]')
    assert page.get_by_label("오버레이에서 작업명 숨기기").is_visible()
    settings_box = page.locator('form[aria-label="위젯 설정"]').bounding_box()
    assert settings_box and round(settings_box["width"]) == 288
    assert page.get_by_text("매일 기본 일정", exact=True).is_visible()
    page.get_by_label("새 매일 기본 일정").fill("오전 메일 확인")
    page.get_by_role("button", name="＋ 추가").click()
    assert page.get_by_label("오전 메일 확인 기본 일정").input_value() == "오전 메일 확인"

    artifact = Path("test-artifacts/daybridge-schedule-dashboard.png")
    artifact.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(artifact), full_page=True)
    refresh_button = page.locator('[data-testid="schedule-widget-refresh"]')
    assert refresh_button.is_visible()
    refresh_button.click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('위젯을 새로고침했어요')")
    assert refresh_button.inner_text() == "위젯 새로고침"
    page.get_by_role("button", name="저장", exact=True).click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('매일 기본 일정을 저장했어요')")
    assert daily_defaults_calls and daily_defaults_calls[0]["dailyDefaults"]["routines"][-1]["title"] == "오전 메일 확인"
    assert_no_page_errors(errors)
    context.close()


def check_dashboard_actions(browser) -> None:
    """Prove the management surface is wired to command endpoints, not a static mock."""
    context = browser.new_context(viewport={"width": 960, "height": 760}, device_scale_factor=1)
    freeze_page_date(context, "2026-08-24T01:00:00+09:00")
    report_calls: list[dict] = []
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

    page.locator('[data-testid="manual-task-add-toggle"]').click()
    page.locator('[data-testid="manual-task-title"]').fill("리눅스 학습")
    assert page.locator('[data-testid^="manual-task-duration-"]').count() == 0
    page.screenshot(path="test-artifacts/daybridge-schedule-dashboard-manual-form.png", full_page=True)
    page.locator('[data-testid="manual-task-submit"]').click()
    page.wait_for_function("document.querySelector('[role=status]').textContent.includes('오늘 할 일에 추가했어요')")
    assert manual_calls and manual_calls[0]["title"] == "리눅스 학습" and "durationMinutes" not in manual_calls[0]
    page.wait_for_function("document.querySelector('[data-testid=manual-task-form]') === null")

    assert_no_page_errors(errors)
    context.close()


def check_overlay(browser) -> None:
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=EMPTY_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
    )
    context.route(
        "http://127.0.0.1:39393/api/daily-defaults",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DAILY_DEFAULTS),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
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
    assert re.fullmatch(r"\d{2}:\d{2}", leave_timer.locator('[data-testid="now-focus-overlay-leave-time-value"]').inner_text())
    assert leave_timer.locator('[class*=timerLabel]').count() == 1
    idle_label = re.sub(r"\s+", " ", page.locator('[data-testid="now-focus-overlay-title"]').text_content() or "").strip()
    assert re.fullmatch(r"오늘 할 일(?: · \d+개)?", idle_label), idle_label
    assert page.locator('[data-testid="now-focus-overlay-title"]').get_attribute("aria-label") == idle_label
    title_style = page.locator('[data-testid="now-focus-overlay-title"]').evaluate(
        "element => { const style = getComputedStyle(element); return { fontSize: parseFloat(style.fontSize), fontWeight: parseInt(style.fontWeight, 10), fontFamily: style.fontFamily }; }"
    )
    assert title_style["fontSize"] >= 17 and title_style["fontWeight"] >= 800, title_style
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
    # The countdown is part of the compact widget's primary action area, not
    # decorative text. Clicking it must expand the same way as the title.
    leave_timer.click()
    assert page.evaluate("window.getSelection().rangeCount") == 0
    page.wait_for_timeout(100)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-animation-mid.png", full_page=True)
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().height) === Number(surface.dataset.expandedHeight); })()")
    expanded_box = surface.bounding_box()
    assert expanded_box and round(expanded_box["height"]) == int(surface.get_attribute("data-expanded-height")) and round(expanded_box["height"]) < 520
    summary_box = page.locator('[data-testid="now-focus-overlay-summary"]').bounding_box()
    assert summary_box and abs((summary_box["y"] + summary_box["height"]) - (expanded_box["y"] + expanded_box["height"])) <= 1
    assert page.locator('[data-testid="now-focus-overlay-expanded"]').is_visible()
    page.wait_for_timeout(350)
    add_box = page.locator('[data-testid="manual-task-add-toggle"]').bounding_box()
    settings_box = page.locator('[data-testid="now-focus-overlay-settings"]').bounding_box()
    assert add_box and settings_box and abs(add_box["width"] - settings_box["width"]) <= 1 and abs(add_box["height"] - settings_box["height"]) <= 1, (add_box, settings_box)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-expanded.png", full_page=True)
    transition_duration = page.locator('[data-testid="now-focus-overlay-expanded"]').evaluate("element => parseFloat(getComputedStyle(element).transitionDuration)")
    assert transition_duration > 0
    transform_origin = page.locator('[data-testid="now-focus-overlay-expanded"]').evaluate("element => getComputedStyle(element).transformOrigin")
    expanded_panel_box = page.locator('[data-testid="now-focus-overlay-expanded"]').bounding_box()
    origin_y = float(transform_origin.split()[-1].removesuffix("px"))
    assert expanded_panel_box and abs(origin_y - expanded_panel_box["height"]) <= 1, (transform_origin, expanded_panel_box)
    assert page.get_by_text("여유 시간", exact=True).count() == 0
    page.locator('[data-testid="manual-task-add-toggle"]').click()
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().width) === 288")
    page.locator('[data-testid="manual-task-title"]').fill("리눅스 학습")
    page.wait_for_timeout(240)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-manual-form.png", full_page=True)
    page.mouse.click(1, 1)
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'true'")
    page.wait_for_function("document.querySelector('[data-testid=manual-task-form]') === null")
    assert round(surface.bounding_box()["width"]) == 288
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-expanded]').getAttribute('aria-hidden') === 'false'")
    assert page.locator('[data-testid="manual-task-form"]').count() == 0
    page.locator('[data-testid="manual-task-add-toggle"]').click()
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().width) === 288")
    form_box = page.locator('[data-testid="manual-task-form"]').bounding_box()
    surface_box = surface.bounding_box()
    assert form_box and surface_box and form_box["x"] >= surface_box["x"] and form_box["x"] + form_box["width"] <= surface_box["x"] + surface_box["width"] + 1, (form_box, surface_box)
    page.locator('[data-testid="manual-task-cancel"]').click()
    page.wait_for_function("Math.round(document.querySelector('[data-testid=now-focus-overlay-surface]').getBoundingClientRect().width) === 288")
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
    # This is the modal viewport used by the native overlay while options are
    # open. The compact corner card itself remains 288px wide.
    page.set_viewport_size({"width": 520, "height": 620})
    page.locator('[data-testid="now-focus-overlay-settings"]').click()
    page.wait_for_selector('[data-testid="now-focus-overlay-settings-modal"]')
    page.wait_for_selector('[data-testid="now-focus-overlay-settings-sheet"]')
    settings_sheet = page.locator('[data-testid="now-focus-overlay-settings-sheet"]')
    page.wait_for_function("""() => {
        const sheet = document.querySelector('[data-testid=now-focus-overlay-settings-sheet]');
        if (!sheet) return false;
        const rect = sheet.getBoundingClientRect();
        return Math.abs((rect.x + rect.width / 2) - window.innerWidth / 2) <= 1
          && Math.abs((rect.y + rect.height / 2) - window.innerHeight / 2) <= 1;
    }""")
    settings_box = settings_sheet.bounding_box()
    viewport = page.viewport_size
    assert settings_box and viewport
    assert abs((settings_box["x"] + settings_box["width"] / 2) - viewport["width"] / 2) <= 1, (settings_box, viewport)
    assert abs((settings_box["y"] + settings_box["height"] / 2) - viewport["height"] / 2) <= 1, (settings_box, viewport)
    assert page.locator('[data-testid="now-focus-overlay-settings-modal"] input[name="privateOverlay"]').is_visible()
    assert page.get_by_text("매일 기본 일정", exact=True).is_visible()
    assert page.get_by_label("영양제 먹기 기본 일정").input_value() == "영양제 먹기"
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-settings.png", full_page=True)
    # Losing focus while the options dialog is open must not collapse the
    # underlying card and leave the still-open form clipped to 64px.
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    page.wait_for_timeout(360)
    assert page.locator('[data-testid="now-focus-overlay-settings-modal"]').is_visible()
    settings_box = settings_sheet.bounding_box()
    assert settings_box and settings_box["y"] >= 0 and settings_box["y"] + settings_box["height"] <= viewport["height"], (settings_box, viewport)
    overlay_refresh = page.locator('[data-testid="now-focus-overlay-refresh"]')
    assert overlay_refresh.is_visible()
    overlay_refresh.click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-refresh]')?.textContent?.includes('위젯 새로고침')")
    page.locator('[data-testid="now-focus-overlay-settings-modal"] [aria-label="설정 닫기"]').click()
    assert page.locator('[data-testid="now-focus-overlay-settings-modal"]').count() == 0
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().width) === 288 && Math.round(surface.getBoundingClientRect().height) === 64; })()")
    assert_no_page_errors(errors)
    context.close()


def check_overlay_todo_items(browser) -> None:
    """Prove an unconfigured day renders as an untimed actionable list."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=TODO_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
    )
    context.route(
        "http://127.0.0.1:39393/api/calendar/status",
        lambda route: route.fulfill(status=200, content_type="application/json", body=CALENDAR_UNCONFIGURED),
    )
    discard_calls: list[dict] = []
    move_calls: list[dict] = []
    def handle_move(route) -> None:
        move_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=TODO_REORDERED_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-move", handle_move)

    def handle_discard(route) -> None:
        discard_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=TODO_DISCARDED_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-discard", handle_discard)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173/?surface=overlay", wait_until="domcontentloaded")
    page.wait_for_function("(() => { const value = document.querySelector('[data-testid=now-focus-overlay-title]')?.textContent?.trim() || ''; return value && value !== '오늘 할 일'; })()")
    title = page.locator('[data-testid="now-focus-overlay-title"]')
    assert (title.text_content() or "").strip() == "문서 검토"
    leave_timer = page.locator('[data-testid="now-focus-overlay-leave-time"]')
    assert leave_timer.count() == 1
    assert re.fullmatch(r"\d{2}:\d{2}", leave_timer.locator('[data-testid="now-focus-overlay-leave-time-value"]').inner_text())
    page.locator('[data-testid="now-focus-overlay-open"]').click()
    page.wait_for_selector('[data-testid="now-focus-overlay-block-todo-linux"]')
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().height) === Number(surface.dataset.expandedHeight) && Number(surface.dataset.expandedHeight) < 520; })()")
    assert page.locator('[data-testid^="now-focus-overlay-block-"]').count() == 2
    assert page.locator('[data-testid="now-focus-overlay-block-todo-linux"]').get_attribute("data-drag-enabled") == "true"
    assert page.locator('[data-testid="now-focus-overlay-block-todo-linux"] [class*=compactBlockTime]').count() == 0
    assert page.locator('[data-testid="now-focus-overlay-block-todo-linux"] [class*=compactBlockTitle]').inner_text() == "리눅스 학습"
    first = page.locator('[data-testid="now-focus-overlay-block-todo-linux"]')
    second = page.locator('[data-testid="now-focus-overlay-block-todo-docs"]')
    first_box = first.bounding_box()
    second_box = second.bounding_box()
    assert first_box and second_box
    first.dispatch_event("mousedown", {"button": 0, "clientX": first_box["x"] + first_box["width"] / 2, "clientY": first_box["y"] + first_box["height"] / 2})
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": first_box["x"] + first_box["width"] / 2 + 8, "clientY": first_box["y"] + first_box["height"] / 2 + 8})
    page.wait_for_selector('[data-testid="now-focus-overlay-drag-preview"]')
    # Users naturally release near a card boundary or in the small gap between
    # cards. That must still select the adjacent card as the drop target.
    gap_drop_y = second_box["y"] - 2
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": second_box["x"] + second_box["width"] / 2, "clientY": gap_drop_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-todo-docs]')?.getAttribute('data-drop-target') === 'true'")
    page.wait_for_timeout(100)
    first.dispatch_event("mouseup", {"button": 0, "buttons": 0, "clientX": second_box["x"] + second_box["width"] / 2, "clientY": gap_drop_y})
    assert move_calls and move_calls[0]["blockId"] == "todo-linux" and move_calls[0]["targetBlockId"] == "todo-docs", move_calls
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-todo-docs]')?.getBoundingClientRect().top < document.querySelector('[data-testid=now-focus-overlay-block-todo-linux]')?.getBoundingClientRect().top")
    first = page.locator('[data-testid="now-focus-overlay-block-todo-linux"]')
    first_box = first.bounding_box()
    assert first_box
    first.dispatch_event("mousedown", {"button": 0, "clientX": first_box["x"] + first_box["width"] / 2, "clientY": first_box["y"] + first_box["height"] / 2})
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": first_box["x"] + first_box["width"] / 2 + 8, "clientY": first_box["y"] + first_box["height"] / 2 + 8})
    page.wait_for_selector('[data-testid="now-focus-overlay-trash"]')
    trash = page.locator('[data-testid="now-focus-overlay-trash"]')
    trash_box = trash.bounding_box()
    footer_box = page.locator('[aria-label="시간표 도구"]').bounding_box()
    assert trash_box and footer_box
    assert trash_box["y"] >= footer_box["y"] + footer_box["height"] + 4, (trash_box, footer_box)
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": trash_box["x"] + trash_box["width"] / 2, "clientY": trash_box["y"] + trash_box["height"] / 2})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-trash]')?.getAttribute('data-trash-active') === 'true'")
    first.dispatch_event("mouseup", {"button": 0, "buttons": 0, "clientX": trash_box["x"] + trash_box["width"] / 2, "clientY": trash_box["y"] + trash_box["height"] / 2})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-todo-linux]') === null")
    assert discard_calls and discard_calls[0]["blockId"] == "todo-linux"
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-todo-items.png", full_page=True)
    assert_no_page_errors(errors)
    context.close()


def check_overlay_compact_expansion(browser) -> None:
    """Prove short schedules stop at their content instead of a blank 520px panel."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=DRAG_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
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
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().height) === Number(surface.dataset.expandedHeight); })()")
    page.wait_for_timeout(350)
    surface = page.locator('[data-testid="now-focus-overlay-surface"]')
    blocks = page.locator('[data-testid^="now-focus-overlay-block-"]')
    assert blocks.count() == 3
    surface_box = surface.bounding_box()
    footer_box = page.locator('[aria-label="시간표 도구"]').bounding_box()
    last_box = blocks.nth(2).bounding_box()
    assert surface_box and footer_box and last_box
    assert round(surface_box["height"]) == int(surface.get_attribute("data-expanded-height")) and round(surface_box["height"]) < 520
    assert 0 <= footer_box["y"] - (last_box["y"] + last_box["height"]) <= 8, (last_box, footer_box)
    list_metrics = page.locator('[aria-label="오늘 시간표 관리"] ol').evaluate("element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY })")
    assert list_metrics["scrollHeight"] <= list_metrics["clientHeight"], list_metrics
    assert list_metrics["overflowY"] == "hidden", list_metrics
    add_box = page.locator('[data-testid="manual-task-add-toggle"]').bounding_box()
    settings_box = page.locator('[data-testid="now-focus-overlay-settings"]').bounding_box()
    assert add_box and settings_box and abs(add_box["width"] - settings_box["width"]) <= 1 and abs(add_box["height"] - settings_box["height"]) <= 1, (add_box, settings_box)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-compact-list.png", full_page=True)
    assert_no_page_errors(errors)
    context.close()


def check_overlay_scrolls_only_at_maximum_height(browser) -> None:
    """Prove a long schedule uses the capped viewport before showing its list scrollbar."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=TALL_SCHEDULE),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
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
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().height) === Number(surface.dataset.expandedHeight); })()")
    surface = page.locator('[data-testid="now-focus-overlay-surface"]')
    list_metrics = page.locator('[aria-label="오늘 시간표 관리"] ol').evaluate("element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY })")
    assert int(surface.get_attribute("data-expanded-height")) == 520
    assert list_metrics["scrollHeight"] > list_metrics["clientHeight"], list_metrics
    assert list_metrics["overflowY"] == "auto", list_metrics
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-scroll-limit.png", full_page=True)
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
    """Prove card drag, FLIP swap motion, trash discard, status clicks, and toolbar controls work."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    freeze_page_date(context, "2026-08-24T01:00:00+09:00")
    move_calls: list[dict] = []
    report_calls: list[dict] = []
    discard_calls: list[dict] = []
    context.route(
        re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"),
        lambda route: route.fulfill(status=200, content_type="application/json", body=DRAG_SCHEDULE),
    )

    def handle_move(route) -> None:
        move_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=DRAG_MOVED_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-move", handle_move)
    def handle_report(route) -> None:
        report_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=DRAG_STATUS_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-report", handle_report)
    def handle_discard(route) -> None:
        discard_calls.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body=DRAG_DISCARDED_SCHEDULE)

    context.route("http://127.0.0.1:39393/api/schedule/block-discard", handle_discard)
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
    page.wait_for_function("(() => { const surface = document.querySelector('[data-testid=now-focus-overlay-surface]'); return Math.round(surface.getBoundingClientRect().height) === Number(surface.dataset.expandedHeight) && Number(surface.dataset.expandedHeight) < 520; })()")
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
    first.dispatch_event("mousedown", {"button": 0, "clientX": source_x, "clientY": source_y})
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": source_x + 8, "clientY": source_y + 8})
    page.wait_for_selector('[data-testid="now-focus-overlay-drag-preview"]')
    preview = page.locator('[data-testid="now-focus-overlay-drag-preview"]')
    preview_style = preview.evaluate("element => { const style = getComputedStyle(element); return { position: style.position, opacity: parseFloat(style.opacity), transform: style.transform, pointerEvents: style.pointerEvents }; }")
    assert preview_style["position"] == "absolute" and preview_style["opacity"] >= 0.9 and preview_style["pointerEvents"] == "none", preview_style
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-dragging.png", full_page=True)
    first.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": target_x, "clientY": target_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-b]')?.getAttribute('data-drop-target') === 'true'")
    target_style = second.evaluate("element => { const style = getComputedStyle(element); return { animationName: style.animationName, position: element.getAttribute('data-drop-position') }; }")
    assert "overlay-drop-target-pulse" in target_style["animationName"] and target_style["position"] in {"before", "after"}, target_style
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-drop-target.png", full_page=True)
    first.dispatch_event("mouseup", {"button": 0, "buttons": 0, "clientX": target_x, "clientY": target_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-drag-preview]') === null")
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-a]')?.getAttribute('data-swap-role') === 'source' && document.querySelector('[data-testid=now-focus-overlay-block-drag-b]')?.getAttribute('data-swap-role') === 'target'")
    swap_style = second.evaluate("element => getComputedStyle(element).animationName")
    assert "overlay-swap-target" in swap_style, swap_style
    assert page.evaluate("() => [...document.querySelectorAll('[data-block-id]')].some(element => element.getAnimations?.().some(animation => animation.effect?.getTiming?.().duration === 460))")
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-b]')?.getBoundingClientRect().top < document.querySelector('[data-testid=now-focus-overlay-block-drag-a]')?.getBoundingClientRect().top")
    page.wait_for_timeout(90)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-swap.png", full_page=True)
    page.wait_for_timeout(430)
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-swap-settled.png", full_page=True)
    assert move_calls and move_calls[0]["blockId"] == "drag-a" and move_calls[0]["targetBlockId"] == "drag-b"
    assert move_calls[0]["position"] in {"before", "after"}
    assert page.locator('[data-testid="now-focus-overlay-block-drag-b"]').bounding_box()["y"] < page.locator('[data-testid="now-focus-overlay-block-drag-a"]').bounding_box()["y"]
    page.locator('[data-testid="now-focus-overlay-block-drag-b"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-status-drag-b]').textContent === '진행 중'")
    assert report_calls and report_calls[0]["blockId"] == "drag-b" and report_calls[0]["status"] == "in_progress"

    discard_card = page.locator('[data-testid="now-focus-overlay-block-drag-a"]')
    discard_box = discard_card.bounding_box()
    assert discard_box
    discard_card.dispatch_event("mousedown", {"button": 0, "clientX": discard_box["x"] + discard_box["width"] / 2, "clientY": discard_box["y"] + discard_box["height"] / 2})
    discard_card.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": discard_box["x"] + discard_box["width"] / 2 + 8, "clientY": discard_box["y"] + discard_box["height"] / 2 + 8})
    page.wait_for_selector('[data-testid="now-focus-overlay-trash"]')
    trash = page.locator('[data-testid="now-focus-overlay-trash"]')
    trash_box = trash.bounding_box()
    card_heights = page.evaluate("() => ({ card: document.querySelector('[data-testid=now-focus-overlay-block-drag-a]')?.offsetHeight || 0, trash: document.querySelector('[data-testid=now-focus-overlay-trash]')?.offsetHeight || 0 })")
    assert trash_box and abs(card_heights["trash"] - card_heights["card"]) <= 1, card_heights
    trash_center_x = trash_box["x"] + trash_box["width"] / 2
    trash_center_y = trash_box["y"] + trash_box["height"] / 2
    discard_card.dispatch_event("mousemove", {"button": 0, "buttons": 1, "clientX": trash_center_x, "clientY": trash_center_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-trash]')?.getAttribute('data-trash-active') === 'true'")
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-trash-active.png", full_page=True)
    discard_card.dispatch_event("mouseup", {"button": 0, "buttons": 0, "clientX": trash_center_x, "clientY": trash_center_y})
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-a]') === null")
    assert discard_calls and discard_calls[0]["blockId"] == "drag-a"
    assert page.locator('[data-testid="now-focus-overlay-trash"]').count() == 0
    page.screenshot(path="test-artifacts/daybridge-schedule-overlay-dragged.png", full_page=True)
    assert_no_page_errors(errors)
    context.close()


def check_overlay_stale_card_is_not_reported_to_today(browser) -> None:
    """A stale card must clear rather than write its status into the new date."""
    context = browser.new_context(viewport={"width": 320, "height": 560}, device_scale_factor=1)
    freeze_page_date(context, "2026-09-02T09:00:00+09:00")
    schedule_requests = 0
    missing_today_board = False
    report_calls: list[dict] = []

    def handle_schedule(route) -> None:
        nonlocal schedule_requests
        schedule_requests += 1
        if missing_today_board:
            route.fulfill(status=404, content_type="application/json", body=json.dumps({"error": "No quest board exists for this date."}))
        else:
            route.fulfill(status=200, content_type="application/json", body=DRAG_SCHEDULE)

    context.route(re.compile(r"http://127\.0\.0\.1:39393/api/schedule(?:\?|$)"), handle_schedule)
    context.route(
        "http://127.0.0.1:39393/api/schedule/block-report",
        lambda route: (report_calls.append(json.loads(route.request.post_data or "{}")), route.fulfill(status=500, content_type="application/json", body="{}")),
    )
    context.route(
        "http://127.0.0.1:39393/api/schedule-settings",
        lambda route: route.fulfill(status=200, content_type="application/json", body=DEFAULT_SETTINGS),
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
    page.wait_for_selector('[data-testid="now-focus-overlay-block-drag-a"]')
    missing_today_board = True
    page.locator('[data-testid="now-focus-overlay-block-drag-a"]').click()
    page.wait_for_function("document.querySelector('[data-testid=now-focus-overlay-block-drag-a]') === null")
    assert page.locator('[data-testid="now-focus-overlay-title"]').text_content() == "오늘 할 일"
    assert page.locator('[data-testid="now-focus-overlay-expanded"]').get_by_text("오늘 할 일이 없습니다.").count() == 1
    assert schedule_requests >= 2
    assert not report_calls
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
        check_overlay_compact_expansion(browser)
        check_overlay_scrolls_only_at_maximum_height(browser)
        check_overlay_todo_items(browser)
        check_overlay_long_title(browser)
        check_overlay_reorder(browser)
        check_overlay_stale_card_is_not_reported_to_today(browser)
        browser.close()


if __name__ == "__main__":
    main()
