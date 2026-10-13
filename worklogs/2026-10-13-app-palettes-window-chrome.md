# App palettes and window controls

Users could change only a widget accent; memo paper, archive, settings and schedule surfaces kept independent fixed colors. Settings also appeared beneath a separate Windows title bar with two unrelated close treatments.

Added six coordinated palettes (midnight, ocean, plum, paper, sage, rose), selectable as miniature archive previews in Display/Color settings. Canvas, text, cards, writing paper, action labels and focus states use semantic variables. Preferences persist locally and synchronize across windows with storage events, native notification and focus refresh. Known legacy accents migrate; invalid values fall back safely. Failed persistence preserves the previous palette. Switching palettes preserves an active memo.

Management uses an app title bar with minimize, maximize/restore and close. The native dashboard has no duplicate title bar in either configured or dynamically built windows. Native close still hides management and preserves the widget/hotkey. Shared SVG close buttons have a 40px target, keyboard focus and reduced-motion behavior. Narrow settings move navigation into a horizontal row. Large Korean sans-serif memo text is retained.

Validation: type/frontend build passed; full Node 199/199 and Rust 41/41 passed; palette contrast and native configuration contracts passed. Isolated browser checks exercised all six palettes across settings, archive/editor and widget, synchronization, reload, failed preference persistence, active draft preservation, archive close and narrow layouts. Captures were inspected. Operational packaging/deployment and native control acceptance remain separate pending checks. The earlier unrelated remote outbox lock timeout is not counted as a successful CI run.
