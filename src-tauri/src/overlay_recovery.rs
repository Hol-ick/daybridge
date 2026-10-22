use serde_json::{json, Value};
use std::{path::Path, sync::Mutex};

pub const FILE_NAME: &str = "overlay-recovery.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config { pub enabled: bool, pub delay_seconds: u64 }
impl Default for Config { fn default() -> Self { Self { enabled: true, delay_seconds: 10 } } }
impl Config {
    pub fn from_json(value: &Value) -> Result<Self, String> {
        let enabled = value["enabled"].as_bool().ok_or("자동 전면 복구 설정을 확인해 주세요.")?;
        let delay_seconds = value["delaySeconds"].as_u64().filter(|n| (1..=300).contains(n))
            .ok_or("복구 대기는 1~300초로 입력해 주세요.")?;
        Ok(Self { enabled, delay_seconds })
    }
    pub fn json(self) -> Value { json!({"enabled": self.enabled, "delaySeconds": self.delay_seconds}) }
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => Self::from_json(&serde_json::from_slice(&bytes).map_err(|_| "위젯 복구 설정을 읽지 못했습니다.")?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("위젯 복구 설정을 읽지 못했습니다.".into()),
        }
    }
}
#[derive(Default)]
pub struct Settings(pub Mutex<Config>);
impl Settings {
    pub fn save(&self, path: &Path, value: &Value) -> Result<Config, String> {
        let next = Config::from_json(value)?;
        let mut current = self.0.lock().map_err(|_| "위젯 복구 설정 잠금 오류")?;
        let parent = path.parent().ok_or("위젯 복구 설정 경로 오류")?;
        std::fs::create_dir_all(parent).map_err(|_| "위젯 복구 설정을 저장하지 못했습니다.")?;
        let temporary = path.with_extension("json.tmp");
        let result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut file = std::fs::File::create(&temporary)?;
            file.write_all(next.json().to_string().as_bytes())?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, path)
        })();
        if result.is_err() { let _ = std::fs::remove_file(temporary); return Err("위젯 복구 설정을 저장하지 못했습니다.".into()); }
        *current = next;
        Ok(next)
    }
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Observation {
    pub needs_repair: bool,
    pub blocked: bool,
    pub activity: (u32, usize),
}
#[derive(Default)]
pub struct Policy { pending_since: Option<u64>, config: Option<Config>, activity: Option<(u32, usize)> }
impl Policy {
    pub fn tick(&mut self, now_ms: u64, config: Config, seen: Observation) -> bool {
        if self.config != Some(config) || self.activity != Some(seen.activity) {
            self.pending_since = None;
        }
        self.config = Some(config);
        self.activity = Some(seen.activity);
        if !config.enabled || !seen.needs_repair || seen.blocked {
            self.pending_since = None;
            return false;
        }
        let since = *self.pending_since.get_or_insert(now_ms);
        if now_ms.saturating_sub(since) < config.delay_seconds * 1000 { return false; }
        self.pending_since = None;
        true
    }
}

#[cfg(windows)]
pub mod native {
    use super::Observation;
    use windows::{core::BOOL, Win32::{Foundation::{HWND, LPARAM, RECT}, Graphics::{Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED}, Gdi::GetWindowRgnBox}, UI::{Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO}, WindowsAndMessaging::*}}};

    fn intersects(a: RECT, b: RECT) -> bool {
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    }
    fn bounds(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect).ok()?; }
        let mut region = RECT::default();
        if unsafe { GetWindowRgnBox(hwnd, &mut region) }.0 >= 2 {
            rect = RECT { left: rect.left + region.left, top: rect.top + region.top,
                right: rect.left + region.right, bottom: rect.top + region.bottom };
        }
        Some(rect)
    }
    struct Scan { overlay: HWND, own_pid: u32, bounds: RECT, before_overlay: bool, blocked: bool, last_topmost: Option<HWND> }
    unsafe extern "system" fn inspect(hwnd: HWND, context: LPARAM) -> BOOL {
        let scan = &mut *(context.0 as *mut Scan);
        if hwnd == scan.overlay { scan.before_overlay = false; return true.into(); }
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() { return true.into(); }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
        if cloaked != 0 { return true.into(); }
        if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize != 0 { scan.last_topmost = Some(hwnd); }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if scan.before_overlay && pid != scan.own_pid && bounds(hwnd).is_some_and(|b| intersects(scan.bounds, b)) {
            scan.blocked = true;
        }
        true.into()
    }
    fn scan(hwnd: HWND, own_pid: u32) -> Result<Scan, String> {
        let rect = bounds(hwnd).ok_or("위젯 영역을 확인하지 못했습니다.")?;
        let mut state = Scan { overlay: hwnd, own_pid, bounds: rect, before_overlay: true, blocked: false, last_topmost: None };
        unsafe { EnumWindows(Some(inspect), LPARAM((&mut state as *mut Scan) as isize)).map_err(|e| e.to_string())?; }
        Ok(state)
    }
    pub fn observe(hwnd: HWND, off_screen: bool, settings_open: bool) -> Result<Observation, String> {
        let mut input = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, ..Default::default() };
        let input_known = unsafe { GetLastInputInfo(&mut input).as_bool() };
        let foreground = unsafe { GetForegroundWindow() };
        let minimized = unsafe { IsIconic(hwnd).as_bool() };
        let topmost = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0;
        let needs_repair = !unsafe { IsWindowVisible(hwnd).as_bool() } || !topmost || off_screen;
        let blocked = settings_open || minimized || !input_known || foreground.is_invalid()
            || (needs_repair && scan(hwnd, std::process::id())?.blocked);
        Ok(Observation { needs_repair, blocked, activity: (input.dwTime, foreground.0 as usize) })
    }
    pub fn restore(hwnd: HWND) -> Result<bool, String> {
        restore_for_process(hwnd, std::process::id())
    }
    fn restore_for_process(hwnd: HWND, own_pid: u32) -> Result<bool, String> {
        let scan = scan(hwnd, own_pid)?;
        if scan.blocked || unsafe { IsIconic(hwnd).as_bool() } { return Ok(false); }
        let already_topmost = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0;
        let mut flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
        if already_topmost { flags |= SWP_NOZORDER; }
        // Restore a lost topmost flag behind existing topmost windows, including
        // non-activating notifications. Healthy windows never enter this path.
        let after = if already_topmost { None } else { Some(scan.last_topmost.unwrap_or(HWND_TOPMOST)) };
        unsafe { SetWindowPos(hwnd, after, 0, 0, 0, 0, flags).map_err(|e| e.to_string())?; }
        Ok(true)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows::core::w;
        #[test]
        fn nonactivating_notification_blocks_recovery_and_keeps_its_order() {
            unsafe {
                let overlay = CreateWindowExW(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    w!("STATIC"), w!("Daybridge isolated fixture"), WS_POPUP,
                    -30000, -30000, 100, 100, None, None, None, None).unwrap();
                let toast = CreateWindowExW(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    w!("STATIC"), w!("Notification fixture"), WS_POPUP,
                    -30000, -30000, 100, 100, None, None, None, None).unwrap();
                for hwnd in [overlay, toast] { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW).unwrap(); }
                // Treat the off-screen fixture process as external; no real
                // notification, foreground activation, titles or content read.
                let before = scan(overlay, 0).unwrap();
                let blocked = before.blocked && !restore_for_process(overlay, 0).unwrap();
                let remained_above = scan(overlay, 0).unwrap().blocked;
                let _ = DestroyWindow(toast);
                let after = scan(overlay, 0).unwrap();
                let cleared = !after.blocked;
                let _ = DestroyWindow(overlay);
                assert!(blocked && remained_above && cleared);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repair() -> Observation { Observation { needs_repair: true, ..Default::default() } }
    #[test]
    fn healthy_widget_never_moves_at_a_timer_boundary() {
        let mut policy = Policy::default();
        for now in [0, 9999, 10000, 20000, 300000] { assert!(!policy.tick(now, Config::default(), Observation::default())); }
    }
    #[test]
    fn notification_at_deadline_resets_the_entire_wait() {
        let mut policy = Policy::default(); let config = Config::default();
        assert!(!policy.tick(0, config, repair()));
        assert!(!policy.tick(10000, config, Observation { blocked: true, ..repair() }));
        assert!(!policy.tick(20000, config, repair()));
        assert!(!policy.tick(29999, config, repair()));
        assert!(policy.tick(30000, config, repair()));
        assert!(!policy.tick(30001, config, Observation::default()));
    }
    #[test]
    fn input_foreground_settings_and_disable_restart_the_wait() {
        let mut policy = Policy::default(); let config = Config::default();
        assert!(!policy.tick(0, config, repair()));
        let active = Observation { activity: (1, 42), ..repair() };
        assert!(!policy.tick(10000, config, active));
        assert!(policy.tick(20000, config, active));
        let disabled = Config { enabled: false, ..config };
        assert!(!policy.tick(90000, disabled, active));
        assert!(!policy.tick(100000, config, active));
        assert!(!policy.tick(110000, Config { delay_seconds: 30, ..config }, active));
    }
    #[test]
    fn settings_survive_reload_and_failure_preserves_acknowledged_state() {
        let root = std::env::temp_dir().join(format!("daybridge-recovery-settings-{}", std::process::id()));
        let path = root.join(FILE_NAME); let state = Settings::default();
        let config = state.save(&path, &json!({"enabled": false, "delaySeconds": 25})).unwrap();
        assert_eq!(Config::load(&path).unwrap(), config);
        assert!(state.save(&path, &json!({"enabled": true,"delaySeconds": 0})).is_err());
        assert_eq!(Config::load(&path).unwrap(), config);
        std::fs::write(root.join("not-a-folder"), b"fixture").unwrap();
        assert!(state.save(&root.join("not-a-folder").join(FILE_NAME), &Config::default().json()).is_err());
        assert_eq!(*state.0.lock().unwrap(), config);
        std::fs::remove_dir_all(root).unwrap();
    }
}
