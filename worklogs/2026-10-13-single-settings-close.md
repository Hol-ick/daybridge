# One close button in management settings

The app title bar replaced the Windows caption, but settings kept its own close button. Both appeared in the management window, matching the user's screenshot.

Management now renders settings with `showCloseButton=false`; its title-bar close remains the single X. Standalone overlay settings retain their own close button. The native close/hide path, palette persistence and memo behavior are unchanged.

The browser regression first reproduced the duplicate: expected zero settings-close buttons in management, observed one. After the fix the fixture asserts one management close and zero settings closes, while standalone settings have one functioning settings close and no management close. Management settings are nonmodal to assistive technology so its title-bar controls remain accessible.

Validation: type/frontend build and eight palette/native-chrome contracts passed. All six palettes across three surfaces, reload, failure preservation, memo draft/close, narrow layouts and both close-button contexts passed with no page errors. The light-palette settings screenshot was inspected and contains one X. Operational packaging/deployment and actual Windows input acceptance are separate evidence.
