"""Small Playwright smoke check for the Daybridge widget UI."""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACT = Path("test-artifacts/daybridge-compact-accordion.png")


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
        quest_cards = page.locator(".quest-card")
        assert quest_cards.count() >= 2
        assert page.locator('.quest-card-trigger[aria-expanded="true"]').count() == 0

        first_card = quest_cards.first
        first_card.locator(".quest-card-trigger").click()
        page.wait_for_selector(".quest-card.is-open .subquest-card")
        assert page.locator(".quest-card.is-open").count() == 1
        assert first_card.locator(".quest-summary").count() == 1

        first_task = first_card.locator(".subquest-card").first
        completed_before = first_card.locator(".subquest-card.is-complete").count()
        first_task.click()
        page.wait_for_function(
            "expected => document.querySelectorAll('.quest-card.is-open .subquest-card.is-complete').length === expected",
            arg=completed_before + 1,
        )
        page.wait_for_timeout(700)

        assert page.locator(".quest-card.is-open").count() == 1
        assert first_card.locator(".subquest-card.is-complete").count() == completed_before + 1
        assert page.locator(".status-deck, .report-card, .source-card, .daily-quest-card").count() == 0
        assert not errors, errors

        ARTIFACT.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(ARTIFACT), full_page=True)
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
