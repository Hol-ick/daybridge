"""Small Playwright smoke check for the Daybridge widget UI."""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACT = Path("test-artifacts/daybridge-todometer-ui.png")


def main() -> None:
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        chrome_path = os.environ.get("DAYBRIDGE_CHROME")
        if chrome_path:
            launch_options["executable_path"] = chrome_path
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context(viewport={"width": 456, "height": 760}, device_scale_factor=1)
        context.route("http://127.0.0.1:39393/**", lambda route: route.abort())
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        page.goto("http://127.0.0.1:5173", wait_until="networkidle")
        quest_cards = page.locator('[data-testid="quest-item"]')
        assert quest_cards.count() >= 2
        assert page.locator('[data-testid="quest-toggle"][aria-expanded="true"]').count() == 0

        first_card = quest_cards.first
        first_card.locator('[data-testid="quest-toggle"]').click()
        page.wait_for_selector('[data-testid="quest-details"][data-open="true"] [data-testid="subquest"]')
        assert page.locator('[data-testid="quest-toggle"][aria-expanded="true"]').count() == 1
        assert first_card.locator('[data-testid="quest-details"][data-open="true"] p').count() == 2
        title_box = first_card.locator('[data-testid="quest-toggle"]').bounding_box()
        details_box = first_card.locator('[data-testid="quest-details"][data-open="true"]').bounding_box()
        assert title_box and details_box and details_box["y"] >= title_box["y"] + title_box["height"] - 1
        assert details_box["width"] >= 300

        first_task = first_card.locator('[data-testid="subquest"]').first
        completed_before = first_card.locator('[data-testid="subquest"][aria-pressed="true"]').count()
        first_task.click()
        page.wait_for_function(
            "expected => document.querySelectorAll('[data-testid=quest-details][data-open=true] [data-testid=subquest][aria-pressed=true]').length === expected",
            arg=completed_before + 1,
        )
        page.wait_for_timeout(700)

        assert page.locator('[data-testid="quest-toggle"][aria-expanded="true"]').count() == 1
        assert first_card.locator('[data-testid="subquest"][aria-pressed="true"]').count() == completed_before + 1
        assert page.locator(".status-deck, .report-card, .source-card, .daily-quest-card").count() == 0
        assert not errors, errors

        ARTIFACT.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(ARTIFACT), full_page=True)
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
