use monero_by_astera_core::{Connection, Engine};
use serde_json::json;
use std::path::PathBuf;
const PASSWORD: &str = "disposable performance test password";

#[test]
#[ignore = "Profiles disposable encrypted wallets only; no user keys"]
fn unlock_benchmark() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = Engine::new(
        dir.path().join("profile"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/monero-wallet-rpc"),
    )
    .unwrap();
    let remote = std::env::var("ASTERA_PERF_NODE").ok();
    e.configure(Connection {
        mode: if remote.is_some() {
            "remote"
        } else {
            "offline"
        }
        .into(),
        node: remote.clone().unwrap_or_else(|| Connection::default().node),
        ..Connection::default()
    })
    .unwrap();
    if remote.is_some() {
        e.confirm_direct(true).unwrap();
    }
    e.open("profile", PASSWORD.into(), None, 0, true).unwrap();
    e.lock().unwrap();
    let mut opens = Vec::new();
    let mut snapshots = Vec::new();
    for _ in 0..5 {
        if remote.is_some() {
            e.confirm_direct(true).unwrap();
        }
        let start = std::time::Instant::now();
        e.open("profile", PASSWORD.into(), None, 0, false).unwrap();
        opens.push(start.elapsed().as_millis());
        println!("PHASES {}", e.control.progress());
        let start = std::time::Instant::now();
        e.snapshot().unwrap();
        snapshots.push(start.elapsed().as_millis());
        e.lock().unwrap();
    }
    println!(
        "BENCH {}",
        json!({"openMs":opens,"snapshotMs":snapshots,"profile":if remote.is_some() {"release/HTTPS/disposable"} else {"release/offline/disposable"}})
    );
}
