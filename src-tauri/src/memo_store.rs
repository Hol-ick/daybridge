use serde_json::{json, Value};
use std::{fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};

pub const MAX_MEMO_BYTES: usize = 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
type Result<T> = std::result::Result<T, String>;

pub struct MemoRepository {
    root: PathBuf,
    #[cfg(test)]
    fail_at: std::cell::Cell<Option<&'static str>>,
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn write_sync(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = File::create(path).map_err(|_| "write_failed")?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "write_failed".into())
}

impl MemoRepository {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("archive")).map_err(|_| "write_failed")?;
        fs::create_dir_all(root.join("pending")).map_err(|_| "write_failed")?;
        Ok(Self { root, #[cfg(test)] fail_at: std::cell::Cell::new(None) })
    }

    fn fault(&self, _stage: &str) -> Result<()> {
        #[cfg(test)]
        if self.fail_at.get() == Some(_stage) { return Err("write_failed".into()); }
        Ok(())
    }

    fn lock(&self) -> Result<File> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        options.open(self.root.join(".store.lock")).map_err(|_| "store_busy".into())
    }

    fn read_state(&self) -> Result<Value> {
        let path = self.root.join("state.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({"schemaVersion":1,"active":null,"pendingArchive":null,"lastClosed":null,"legacyImported":false})),
            Err(_) => return Err("corrupt_state".into()),
        };
        let state: Value = serde_json::from_slice(&bytes).map_err(|_| "corrupt_state")?;
        if state["schemaVersion"] != 1 || !state["legacyImported"].is_boolean() || state.get("active").is_none() || state.get("pendingArchive").is_none() { return Err("corrupt_state".into()); }
        for key in ["active", "pendingArchive"] {
            if !state[key].is_null() { Self::validate_draft(&state[key])?; }
        }
        Ok(state)
    }

    fn validate_draft(draft: &Value) -> Result<()> {
        let id = draft["id"].as_str().ok_or("corrupt_state")?;
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') || draft["revision"].as_u64().is_none() || draft["text"].as_str().is_none() || draft["createdAtUnixMs"].as_u64().is_none() || draft["updatedAtUnixMs"].as_u64().is_none() { return Err("corrupt_state".into()); }
        if draft["text"].as_str().unwrap().len() > MAX_MEMO_BYTES { return Err("size_limit".into()); }
        Ok(())
    }

    fn persist(&self, state: &Value) -> Result<()> {
        let temporary = self.root.join("state.tmp");
        write_sync(&temporary, &serde_json::to_vec(state).map_err(|_| "write_failed")?)?;
        fs::rename(temporary, self.root.join("state.json")).map_err(|_| "write_failed".into())
    }

    fn archive_bytes(draft: &Value) -> Vec<u8> {
        // A machine-readable first line supports exact recovery comparison; the body remains ordinary UTF-8.
        let metadata = json!({"id":draft["id"],"revision":draft["revision"],"createdAtUnixMs":draft["createdAtUnixMs"],"updatedAtUnixMs":draft["updatedAtUnixMs"]});
        format!("<!-- daybridge-memo {} -->\n{}", metadata, draft["text"].as_str().unwrap()).into_bytes()
    }

    fn publish(&self, draft: &Value) -> Result<()> {
        Self::validate_draft(draft)?;
        let id = draft["id"].as_str().unwrap();
        let destination = self.root.join("archive").join(format!("{id}.md"));
        let bytes = Self::archive_bytes(draft);
        if destination.exists() {
            return if fs::read(destination).map_err(|_| "write_failed")? == bytes { Ok(()) } else { Err("archive_conflict".into()) };
        }
        let temporary = self.root.join("pending").join(format!("{id}.tmp"));
        self.fault("before_archive_write")?;
        write_sync(&temporary, &bytes)?;
        self.fault("before_archive_publish")?;
        // Publishing a hard link is atomic and fails if the destination exists. It never replaces an archive.
        match fs::hard_link(&temporary, &destination) {
            Ok(()) => {},
            Err(_) if destination.exists() && fs::read(&destination).map_err(|_| "write_failed")? == bytes => {},
            Err(_) => return Err(if destination.exists() { "archive_conflict" } else { "write_failed" }.into()),
        }
        // The published file is durable even if removing our temporary link fails.
        let _ = fs::remove_file(temporary);
        Ok(())
    }

    fn recover_state(&self, state: &mut Value) -> Result<bool> {
        if state["pendingArchive"].is_null() { return Ok(false); }
        let draft = state["pendingArchive"].clone();
        let archived = !draft["text"].as_str().unwrap().trim().is_empty();
        if archived { self.publish(&draft)?; }
        self.fault("after_archive_publish")?;
        state["active"] = Value::Null;
        state["pendingArchive"] = Value::Null;
        state["lastClosed"] = json!({"id":draft["id"],"revision":draft["revision"],"archived":archived});
        self.fault("before_close_commit")?;
        self.persist(state)?;
        Ok(true)
    }

    pub fn import_legacy_once(&self, legacy: &Path) -> Result<bool> {
        let _lock = self.lock()?;
        let mut state = self.read_state()?;
        self.recover_state(&mut state)?;
        if state["legacyImported"] == true { return Ok(false); }
        let text = match fs::read_to_string(legacy) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(_) => return Err("write_failed".into()),
        };
        let imported = !text.trim().is_empty();
        if imported {
            // Fixed metadata makes a retry after publication byte-for-byte idempotent.
            let draft = json!({"id":"legacy-quick-memo-v1","revision":0,"text":text,"createdAtUnixMs":0,"updatedAtUnixMs":0});
            self.publish(&draft)?;
        }
        state["legacyImported"] = json!(true);
        self.persist(&state)?;
        Ok(imported)
    }

    pub fn begin(&self) -> Result<Value> {
        let _lock = self.lock()?;
        let mut state = self.read_state()?;
        self.recover_state(&mut state)?;
        let recovered = !state["active"].is_null();
        if !recovered {
            let id = loop {
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
                let id = format!("m-{stamp}-{}-{}", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed));
                if !self.root.join("archive").join(format!("{id}.md")).exists() { break id; }
            };
            state["active"] = json!({"id":id,"revision":0,"text":"","createdAtUnixMs":now_ms(),"updatedAtUnixMs":now_ms()});
            self.persist(&state)?;
        }
        Ok(json!({"draft":state["active"],"recovered":recovered}))
    }

    fn update(state: &mut Value, id: &str, revision: u64, text: &str) -> Result<()> {
        if text.len() > MAX_MEMO_BYTES { return Err("size_limit".into()); }
        if state["active"]["id"].as_str() != Some(id) { return Err("stale_session".into()); }
        let previous = state["active"]["revision"].as_u64().ok_or("corrupt_state")?;
        if revision < previous || (revision == previous && state["active"]["text"].as_str() != Some(text)) { return Err("stale_session".into()); }
        if revision > previous {
            state["active"]["revision"] = json!(revision);
            state["active"]["text"] = json!(text);
            state["active"]["updatedAtUnixMs"] = json!(now_ms());
        }
        Ok(())
    }

    pub fn save(&self, id: &str, revision: u64, text: &str) -> Result<Value> {
        let _lock = self.lock()?;
        let mut state = self.read_state()?;
        self.recover_state(&mut state)?;
        Self::update(&mut state, id, revision, text)?;
        self.persist(&state)?;
        Ok(json!({"id":id,"revision":revision}))
    }

    pub fn finish(&self, id: &str, revision: u64, text: &str) -> Result<Value> {
        let _lock = self.lock()?;
        let mut state = self.read_state()?;
        self.recover_state(&mut state)?;
        if state["lastClosed"]["id"].as_str() == Some(id) && state["lastClosed"]["revision"].as_u64() == Some(revision) { return Ok(state["lastClosed"].clone()); }
        Self::update(&mut state, id, revision, text)?;
        state["pendingArchive"] = state["active"].clone();
        self.fault("before_close_intent")?;
        self.persist(&state)?;
        self.recover_state(&mut state)?;
        Ok(state["lastClosed"].clone())
    }

    pub fn archive_directory(&self) -> PathBuf { self.root.join("archive") }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self { Self(std::env::temp_dir().join(format!("daybridge-sticky-{}-{}-{}", std::process::id(), now_ms(), SEQUENCE.fetch_add(1, Ordering::Relaxed)))) }
        fn repo(&self) -> MemoRepository { MemoRepository::open(self.0.clone()).unwrap() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn id(session: &Value) -> &str { session["draft"]["id"].as_str().unwrap() }

    #[test]
    fn close_archives_exact_unicode_and_next_session_is_empty() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
        let text = "한글 마지막 줄 📝\n  ";
        repo.save(id(&session), 1, text).unwrap();
        let ack = repo.finish(id(&session), 1, text).unwrap();
        assert_eq!(ack["archived"], true);
        assert_eq!(repo.finish(id(&session), 1, text).unwrap(), ack);
        assert!(repo.save(id(&session), 2, "늦은 저장").is_err());
        let next = repo.begin().unwrap(); assert_eq!(next["draft"]["text"], ""); assert_ne!(id(&next), id(&session));
        let files = fs::read_dir(repo.archive_directory()).unwrap().collect::<Vec<_>>(); assert_eq!(files.len(), 1);
        assert!(fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap().ends_with(text));
        repo.finish(id(&next), 1, text).unwrap(); assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 2);
    }

    #[test]
    fn crash_restores_acknowledged_draft_and_rejects_stale_or_oversized_edits() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
        repo.save(id(&session), 2, "저장된 초안").unwrap();
        assert!(repo.save(id(&session), 1, "오래된 초안").is_err());
        assert!(repo.save(id(&session), 2, "같은 번호 다른 값").is_err());
        assert!(repo.save(id(&session), 3, &"a".repeat(MAX_MEMO_BYTES + 1)).is_err());
        let restored = fixture.repo().begin().unwrap(); assert_eq!(restored["recovered"], true); assert_eq!(restored["draft"]["text"], "저장된 초안");
        repo.save(id(&session), 3, &"a".repeat(MAX_MEMO_BYTES)).unwrap();
    }

    #[test]
    fn blank_closes_without_archive_and_corrupt_state_is_preserved() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
        assert_eq!(repo.finish(id(&session), 1, " \n\t").unwrap()["archived"], false);
        assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 0);
        fs::write(fixture.0.join("state.json"), b"broken").unwrap();
        assert_eq!(repo.begin().unwrap_err(), "corrupt_state");
        assert_eq!(fs::read(fixture.0.join("state.json")).unwrap(), b"broken");
    }

    #[test]
    fn interrupted_archive_recovers_before_new_begin_without_duplicates() {
        for published in [false, true] {
            let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
            repo.save(id(&session), 1, "중단된 닫기").unwrap();
            let mut state = repo.read_state().unwrap(); state["pendingArchive"] = state["active"].clone(); repo.persist(&state).unwrap();
            if published { repo.publish(&state["pendingArchive"]).unwrap(); }
            assert_eq!(fixture.repo().begin().unwrap()["draft"]["text"], "");
            assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 1);
            assert_eq!(repo.finish(id(&session), 1, "중단된 닫기").unwrap()["archived"], true);
        }
    }

    #[test]
    fn archive_conflict_keeps_draft_and_pending_intent() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
        let destination = repo.archive_directory().join(format!("{}.md", id(&session)));
        fs::write(&destination, "원본 보관 파일").unwrap();
        assert_eq!(repo.finish(id(&session), 1, "새 입력").unwrap_err(), "archive_conflict");
        assert_eq!(repo.read_state().unwrap()["active"]["text"], "새 입력");
        assert_eq!(fs::read_to_string(destination).unwrap(), "원본 보관 파일");
    }

    #[test]
    fn legacy_import_is_once_and_never_mutates_original() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let legacy = fixture.0.join("quick-memo.txt");
        fs::write(&legacy, "기존 메모\n").unwrap();
        assert!(repo.import_legacy_once(&legacy).unwrap()); assert!(!repo.import_legacy_once(&legacy).unwrap());
        assert_eq!(fs::read_to_string(&legacy).unwrap(), "기존 메모\n"); assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 1);
        assert_eq!(repo.begin().unwrap()["draft"]["text"], "");
    }

    #[cfg(windows)]
    #[test]
    fn another_instance_cannot_take_live_store_lock() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let lock = repo.lock().unwrap();
        assert_eq!(fixture.repo().begin().unwrap_err(), "store_busy");
        drop(lock); assert!(repo.begin().is_ok());
    }

    #[test]
    fn close_io_failures_preserve_saved_text_and_retry_exactly_once() {
        for stage in ["before_close_intent", "before_archive_write", "before_archive_publish", "after_archive_publish", "before_close_commit"] {
            let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
            repo.save(id(&session), 1, "최종 확인된 입력\n").unwrap();
            repo.fail_at.set(Some(stage));
            assert_eq!(repo.finish(id(&session), 1, "최종 확인된 입력\n").unwrap_err(), "write_failed", "{stage}");
            assert_eq!(repo.read_state().unwrap()["active"]["text"], "최종 확인된 입력\n", "{stage}");
            repo.fail_at.set(None);
            let ack = fixture.repo().finish(id(&session), 1, "최종 확인된 입력\n").unwrap();
            assert_eq!(ack["archived"], true); assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 1);
            assert_eq!(repo.begin().unwrap()["draft"]["text"], "");
        }
    }

    #[test]
    fn legacy_publish_before_marker_recovers_without_second_archive() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let legacy = fixture.0.join("quick-memo.txt");
        fs::write(&legacy, "이관 원본").unwrap();
        let draft = json!({"id":"legacy-quick-memo-v1","revision":0,"text":"이관 원본","createdAtUnixMs":0,"updatedAtUnixMs":0});
        repo.publish(&draft).unwrap();
        assert!(fixture.repo().import_legacy_once(&legacy).unwrap());
        assert_eq!(fs::read_dir(repo.archive_directory()).unwrap().count(), 1);
        assert_eq!(fs::read_to_string(legacy).unwrap(), "이관 원본");
    }

    #[test]
    fn blocked_state_write_preserves_previous_acknowledged_draft() {
        let fixture = Fixture::new(); let repo = fixture.repo(); let session = repo.begin().unwrap();
        repo.save(id(&session), 1, "이전 저장").unwrap();
        fs::create_dir(fixture.0.join("state.tmp")).unwrap();
        assert_eq!(repo.save(id(&session), 2, "실패한 입력").unwrap_err(), "write_failed");
        assert_eq!(fixture.repo().begin().unwrap()["draft"]["text"], "이전 저장");
    }
}
