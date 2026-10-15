//! Local-only SOCKS diagnostics. A greeting proves neither Tor identity nor bootstrap.
use crate::Result;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};

pub fn local_address(proxy: &str) -> Result<SocketAddr> {
    let address: SocketAddr = proxy.parse().map_err(|_| {
        "Enter a numeric local SOCKS address, such as 127.0.0.1:9050 or [::1]:9050."
    })?;
    if !address.ip().is_loopback() || address.port() == 0 {
        return Err(
            "The Tor SOCKS proxy must use this Mac’s loopback address and a nonzero port.".into(),
        );
    }
    Ok(address)
}

fn probe(address: SocketAddr) -> Result<()> {
    let timeout = Duration::from_millis(900);
    let mut socket = TcpStream::connect_timeout(&address, timeout).map_err(|_| {
        "No local proxy answered. Start Tor, or connect Tor Browser and keep it open."
    })?;
    socket
        .set_read_timeout(Some(timeout))
        .map_err(|_| "Could not set a safe proxy timeout.")?;
    socket
        .set_write_timeout(Some(timeout))
        .map_err(|_| "Could not set a safe proxy timeout.")?;
    // SOCKS5: one offered method, no authentication. Deliberately no CONNECT request.
    socket
        .write_all(&[5, 1, 0])
        .map_err(|_| "Local proxy disconnected during its SOCKS greeting.")?;
    let mut response = [0; 2];
    socket.read_exact(&mut response).map_err(|_| {
        "No complete SOCKS5 response. Check the port and whether Tor is still starting."
    })?;
    match response {
        [5, 0] => Ok(()),
        [5, _] => Err(
            "This proxy requires an unsupported authentication method. Use Tor’s local SOCKS port."
                .into(),
        ),
        _ => Err(
            "This port did not speak SOCKS5. Enter the SOCKS port, not the Tor control port."
                .into(),
        ),
    }
}

pub fn require_proxy(proxy: &str) -> Result<()> {
    probe(local_address(proxy)?).map_err(|message| format!("{message} Use Check local Tor proxies in connection settings. No direct connection was attempted."))
}

pub fn diagnose(proxy: &str) -> Result<Value> {
    let mut addresses = Vec::new();
    if !proxy.trim().is_empty() {
        addresses.push(local_address(proxy.trim())?);
    }
    for candidate in ["127.0.0.1:9050", "127.0.0.1:9150"] {
        let address = local_address(candidate)?;
        if !addresses.contains(&address) {
            addresses.push(address);
        }
    }
    // At most three local sockets, checked concurrently with bounded I/O.
    let results: Vec<Value> = std::thread::scope(|scope| {
        let jobs: Vec<_> = addresses.into_iter().map(|address| scope.spawn(move || {
            let checked = probe(address);
            json!({"proxy":address.to_string(),"ready":checked.is_ok(),"message":checked.err().unwrap_or_else(|| "SOCKS5 responded. Onion connectivity has not been tested.".into())})
        })).collect();
        jobs.into_iter().filter_map(|job| job.join().ok()).collect()
    });
    Ok(json!({"proxies":results}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn fake_proxy(reply: &[u8], expected_ok: bool) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                let (mut socket, _) = server.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut greeting = [0; 3];
                socket.read_exact(&mut greeting).unwrap();
                assert_eq!(greeting, [5, 1, 0]);
                socket.write_all(reply).unwrap();
                // Diagnostic must close without ever asking the proxy for a destination.
                let mut extra = [0; 1];
                assert_eq!(socket.read(&mut extra).unwrap(), 0);
            });
            assert_eq!(probe(address).is_ok(), expected_ok);
            worker.join().unwrap();
        });
    }

    #[test]
    fn local_only_rejects_hosts_remote_addresses_and_zero_port() {
        for input in [
            "example.com:9050",
            "localhost:9050",
            "8.8.8.8:9050",
            "[2001:4860:4860::8888]:9050",
            "127.0.0.1:0",
            "socks5://127.0.0.1:9050",
            "[::ffff:8.8.8.8]:9050",
        ] {
            assert!(local_address(input).is_err(), "{input}");
        }
        assert!(local_address("127.0.0.1:9150").is_ok());
        assert!(local_address("[::1]:9050").is_ok());
        assert!(diagnose("public.example:9050").is_err());
    }

    #[test]
    fn handshake_never_sends_connect_and_rejects_wrong_protocol() {
        fake_proxy(&[5, 0], true);
        fake_proxy(&[5, 2], false);
        fake_proxy(b"HT", false);
    }

    #[test]
    fn absent_or_stalled_proxy_fails_bounded_and_actionable() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        drop(server);
        assert!(require_proxy(&address.to_string())
            .unwrap_err()
            .contains("No direct connection"));
        let stalled = TcpListener::bind("127.0.0.1:0").unwrap();
        let start = std::time::Instant::now();
        assert!(probe(stalled.local_addr().unwrap()).is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
