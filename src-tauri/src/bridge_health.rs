use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Eq)]
pub enum BridgeProbe {
    Ready,
    ForeignListener,
    Unavailable,
}

fn valid_version(version: &str) -> bool {
    let Some((release, hash)) = version.split_once('+') else {
        return false;
    };
    let parts: Vec<_> = release.split('.').collect();
    version.len() <= 128
        && parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && hash.len() == 12
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_health(body: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    let id = value["instanceId"].as_str().unwrap_or("");
    let started = value["startedAt"].as_str().unwrap_or("");
    value["service"] == "daybridge"
        && value["schemaVersion"] == 1
        && value["status"] == "ok"
        && value["bridgeVersion"].as_str().is_some_and(valid_version)
        && id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
        && started.len() == 24
        && started
            .bytes()
            .enumerate()
            .all(|(index, byte)| match index {
                4 | 7 => byte == b'-',
                10 => byte == b'T',
                13 | 16 => byte == b':',
                19 => byte == b'.',
                23 => byte == b'Z',
                _ => byte.is_ascii_digit(),
            })
}

fn health_body(response: &[u8]) -> Option<Vec<u8>> {
    let split = response.windows(4).position(|part| part == b"\r\n\r\n")?;
    let headers = std::str::from_utf8(&response[..split]).ok()?;
    if !headers.starts_with("HTTP/1.1 ") && !headers.starts_with("HTTP/1.0 ") {
        return None;
    }
    let status = headers.lines().next()?.split_whitespace().nth(1)?;
    if status != "200" {
        return None;
    }
    let body = &response[split + 4..];
    let chunked = headers
        .lines()
        .any(|line| line.to_ascii_lowercase().trim() == "transfer-encoding: chunked");
    if !chunked {
        return Some(body.to_vec());
    }
    let mut cursor = 0;
    let mut decoded = Vec::new();
    loop {
        let end = body[cursor..].windows(2).position(|part| part == b"\r\n")? + cursor;
        let size_line = std::str::from_utf8(&body[cursor..end])
            .ok()?
            .split(';')
            .next()?;
        let size = usize::from_str_radix(size_line, 16).ok()?;
        cursor = end + 2;
        if size == 0 {
            return Some(decoded);
        }
        let next = cursor.checked_add(size)?;
        if next.checked_add(2)? > body.len() || &body[next..next + 2] != b"\r\n" {
            return None;
        }
        decoded.extend_from_slice(&body[cursor..next]);
        cursor = next + 2;
    }
}

pub fn probe_bridge(endpoint: SocketAddr) -> BridgeProbe {
    let timeout = Duration::from_millis(500);
    let Ok(mut stream) = TcpStream::connect_timeout(&endpoint, timeout) else {
        return BridgeProbe::Unavailable;
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return BridgeProbe::ForeignListener;
    }
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        endpoint
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return BridgeProbe::ForeignListener;
    }
    let deadline = Instant::now() + timeout;
    let mut response = Vec::new();
    let mut chunk = [0_u8; 2048];
    loop {
        if Instant::now() >= deadline {
            return BridgeProbe::ForeignListener;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if stream.set_read_timeout(Some(remaining)).is_err() {
            return BridgeProbe::ForeignListener;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                response.extend_from_slice(&chunk[..size]);
                if response.len() > 16_384 {
                    return BridgeProbe::ForeignListener;
                }
            }
            Err(_) => return BridgeProbe::ForeignListener,
        }
    }
    if health_body(&response).is_some_and(|body| valid_health(&body)) {
        BridgeProbe::Ready
    } else {
        BridgeProbe::ForeignListener
    }
}

pub fn bridge_is_reachable_at(endpoint: SocketAddr) -> bool {
    probe_bridge(endpoint) == BridgeProbe::Ready
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    const HEALTH: &str = r#"{"service":"daybridge","schemaVersion":1,"status":"ok","bridgeVersion":"0.1.0+0123456789ab","instanceId":"12345678-1234-1234-1234-123456789abc","startedAt":"2099-01-05T00:00:00.000Z"}"#;

    #[test]
    fn unrelated_tcp_listener_is_not_a_daybridge_bridge() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let started = Instant::now();
        assert!(!bridge_is_reachable_at(listener.local_addr().unwrap()));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    fn response_probe(body: &str, chunked: bool) -> BridgeProbe {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = listener.local_addr().unwrap();
        let body = body.to_owned();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0_u8; 512];
            stream.read(&mut request).unwrap();
            let response = if chunked {
                format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n", body.len(), body)
            } else {
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
            };
            stream.write_all(response.as_bytes()).unwrap();
        });
        let result = probe_bridge(endpoint);
        server.join().unwrap();
        result
    }

    #[test]
    fn verifies_daybridge_identity_with_fixed_and_chunked_http_bodies() {
        assert_eq!(response_probe(HEALTH, false), BridgeProbe::Ready);
        assert_eq!(response_probe(HEALTH, true), BridgeProbe::Ready);
    }

    #[test]
    fn rejects_foreign_legacy_and_incompatible_http_identities() {
        for body in [
            r#"{"status":"ok"}"#,
            r#"{"status":"ok","dataDir":"fixture"}"#,
            "{broken",
        ] {
            assert_eq!(response_probe(body, false), BridgeProbe::ForeignListener);
        }
        assert_eq!(
            response_probe(
                &HEALTH.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
                false
            ),
            BridgeProbe::ForeignListener
        );
    }

    #[test]
    fn rejects_malformed_http_and_chunk_sizes_without_panicking() {
        for response in [
            b"no HTTP".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nffffffffffffffff\r\n",
            b"HTTP/1.1 503 Error\r\n\r\n{}",
        ] {
            assert!(health_body(response).is_none());
        }
    }
}
