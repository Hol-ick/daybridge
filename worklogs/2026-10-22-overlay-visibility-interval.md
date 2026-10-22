# Overlay visibility recovery interval

The user requested increasing the interval that raises the widget to the front to approximately ten seconds. The native overlay visibility watchdog previously reasserted visibility/topmost state every three seconds. It now uses a shared ten-second constant for both its timer and startup event. Explicit recovery actions and the separate bridge/process watchdogs are unchanged.

Validation: all 43 Rust regressions passed. The source diff is limited to the visibility watchdog interval and its log value. Operational installation, preserved data and the observed startup interval are verified separately; no Windows reboot is required.
