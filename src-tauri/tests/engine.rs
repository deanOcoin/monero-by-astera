use monero_by_astera_core::{Connection, Engine};
use serde_json::{json, Value};
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};
fn binary() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/monero-wallet-rpc")
}
fn port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
const PASSWORD: &str = "a test password never used for funds";
#[test]
#[ignore = "Local self-signed HTTPS rejection test; no external connection or funded wallet"]
fn untrusted_https_rejected_before_wallet_open() {
    let dir = tempfile::tempdir().unwrap();
    let cert = dir.path().join("cert.pem");
    let key = dir.path().join("key.pem");
    assert!(Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-subj",
            "/CN=localhost",
            "-days",
            "1",
            "-keyout"
        ])
        .arg(&key)
        .arg("-out")
        .arg(&cert)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success());
    let port = port();
    let child = Command::new("openssl")
        .args([
            "s_server",
            "-quiet",
            "-www",
            "-accept",
            &port.to_string(),
            "-cert",
        ])
        .arg(&cert)
        .arg("-key")
        .arg(&key)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let _server = Node {
        child,
        url: String::new(),
    };
    for _ in 0..50 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut e = Engine::new(dir.path().join("wallets"), binary()).unwrap();
    e.configure(Connection {
        mode: "remote".into(),
        node: format!("https://127.0.0.1:{port}"),
        ..Connection::default()
    })
    .unwrap();
    e.confirm_direct(true).unwrap();
    let error = e
        .open("never_created", PASSWORD.into(), None, 0, true)
        .unwrap_err();
    assert!(error.contains("verified HTTPS"), "{error}");
    assert!(e.wallets().unwrap().is_empty());
    assert_eq!(e.snapshot().unwrap()["locked"], true);
    println!("PASS: self-signed HTTPS certificate rejected before opening wallet keys");
}
#[test]
#[ignore = "Explicit public HTTPS test with disposable keys; set ASTERA_TEST_PUBLIC_NODE"]
fn public_https_sync() {
    let node = std::env::var("ASTERA_TEST_PUBLIC_NODE").expect("Set an explicit public HTTPS node");
    let c = Connection {
        mode: "remote".into(),
        node,
        ..Connection::default()
    };
    let health = monero_by_astera_core::node::check(&c, true, false).unwrap();
    assert_eq!(health["ready"], true);
    let height = health["height"].as_u64().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut e = Engine::new(dir.path().join("wallets"), binary()).unwrap();
    e.configure(Connection {
        mode: "offline".into(),
        ..Connection::default()
    })
    .unwrap();
    e.open("disposable", PASSWORD.into(), None, 0, true)
        .unwrap();
    let seed = e.reveal(PASSWORD.into()).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_string();
    e.lock().unwrap();
    e.open(
        "public_probe",
        PASSWORD.into(),
        Some(seed),
        height.saturating_sub(30),
        true,
    )
    .unwrap();
    e.lock().unwrap();
    e.configure(c).unwrap();
    e.confirm_direct(true).unwrap();
    e.open("public_probe", PASSWORD.into(), None, 0, false)
        .unwrap();
    assert!(
        std::fs::read_dir(dir.path().join("wallets"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("client-")),
        "Temporary TLS files must be removed after the engine loads them"
    );
    let result = e.refresh().unwrap();
    assert!(result["height"].as_u64().unwrap() >= height);
    assert!(result["lastSync"].is_u64());
    assert_eq!(result["balance"], "0");
    e.lock().unwrap();
    e.confirm_direct(true).unwrap();
    assert!(e
        .open(
            "public_probe",
            "wrong disposable password".into(),
            None,
            0,
            false
        )
        .is_err());
    assert!(
        std::fs::read_dir(dir.path().join("wallets"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("client-")),
        "A failed unlock must clean temporary TLS files"
    );
    println!(
        "PASS: disposable wallet scanned public mainnet over verified HTTPS; no funded wallet used"
    );
}
struct Node {
    child: Child,
    url: String,
}
impl Drop for Node {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Node {
    fn call(&self, method: &str, params: Value) -> Value {
        let r: Value = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap()
            .post(format!("{}/json_rpc", self.url))
            .json(&json!({"jsonrpc":"2.0","id":"test","method":method,"params":params}))
            .send()
            .unwrap()
            .json()
            .unwrap();
        assert!(r.get("error").is_none(), "{r}");
        r["result"].clone()
    }
}
#[test]
#[ignore = "Runs the verified real Monero wallet engine"]
fn offline_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = Engine::new(dir.path().join("wallets"), binary()).unwrap();
    e.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    e.configure(Connection {
        mode: "offline".into(),
        ..Connection::default()
    })
    .unwrap();
    let first = e.open("original", PASSWORD.into(), None, 0, true).unwrap();
    assert_eq!(first["balance"], "0");
    assert_eq!(first["addresses"].as_array().unwrap().len(), 2);
    assert!(e.reveal("wrong".into()).is_err());
    let seed = e.reveal(PASSWORD.into()).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(seed.split_whitespace().count(), 25);
    let words: Vec<_> = seed.split_whitespace().collect();
    assert!(e
        .backup_confirm(PASSWORD.into(), vec!["wrong".into(); 3])
        .is_err());
    e.backup_confirm(
        PASSWORD.into(),
        [2, 10, 19].iter().map(|&i| words[i].into()).collect(),
    )
    .unwrap();
    let a = e.address("Coffee & friends <safe>", None).unwrap();
    assert_eq!(a["addresses"].as_array().unwrap().len(), 3);
    assert_eq!(a["addresses"][2]["label"], "Coffee & friends <safe>");
    let root = a["addresses"][0]["address"].clone();
    let sub = a["addresses"][1]["address"].clone();
    e.lock().unwrap();
    assert!(e.snapshot().unwrap()["locked"].as_bool().unwrap());
    assert!(e.prepare("x", "1", 0, None).is_err());
    assert!(e.open("original", "wrong".into(), None, 0, false).is_err());
    let reopened = e.open("original", PASSWORD.into(), None, 0, false).unwrap();
    assert_eq!(reopened["addresses"][2]["label"], "Coffee & friends <safe>");
    assert_eq!(reopened["backedUp"], true);
    e.change_password(PASSWORD.into(), "a new long test password".into())
        .unwrap();
    assert!(e.verify(PASSWORD).is_err());
    e.lock().unwrap();
    assert!(e.open("original", PASSWORD.into(), None, 0, false).is_err());
    e.open(
        "original",
        "a new long test password".into(),
        None,
        0,
        false,
    )
    .unwrap();
    e.lock().unwrap();
    let restored = e
        .open("restored", PASSWORD.into(), Some(seed), 0, true)
        .unwrap();
    assert_eq!(restored["addresses"][0]["address"], root);
    assert_eq!(restored["addresses"][1]["address"], sub);
    e.lock().unwrap();
    println!("PASS: real offline creation, encrypted reopen, wrong password rejection, backup challenge, labels, password change, seed restore and subaddress derivation");
}
#[test]
#[ignore = "Mines local regtest coins and sends a real signed transaction; never uses real XMR"]
fn regtest_send_receive() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../work/monero-aarch64-apple-darwin11-v0.18.5.1/monerod");
    let rpc_port = port();
    let url = format!("http://127.0.0.1:{rpc_port}");
    let child = Command::new(daemon)
        .args([
            "--regtest",
            "--offline",
            "--fixed-difficulty",
            "1",
            "--no-zmq",
            "--p2p-bind-ip",
            "127.0.0.1",
            "--p2p-bind-port",
            &port().to_string(),
            "--rpc-bind-ip",
            "127.0.0.1",
            "--rpc-bind-port",
            &rpc_port.to_string(),
            "--rpc-ssl",
            "disabled",
            "--non-interactive",
            "--disable-dns-checkpoints",
            "--check-updates",
            "disabled",
            "--data-dir",
        ])
        .arg(dir.path().join("node"))
        .args(["--log-file", "/dev/null", "--log-level", "0"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let node = Node {
        child,
        url: url.clone(),
    };
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap();
    for i in 0..100 {
        if client.get(format!("{url}/get_height")).send().is_ok() {
            break;
        }
        assert!(i < 99, "node startup timeout");
        std::thread::sleep(Duration::from_millis(200));
    }
    let c = Connection {
        node: url,
        ..Connection::default()
    };
    let mut sender = Engine::new(dir.path().join("sender"), binary()).unwrap();
    sender.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    sender.regtest = true;
    sender.configure(c.clone()).unwrap();
    let s = sender
        .open("miner", PASSWORD.into(), None, 0, true)
        .unwrap();
    let miner = s["addresses"][0]["address"].as_str().unwrap();
    let mut receiver = Engine::new(dir.path().join("receiver"), binary()).unwrap();
    receiver.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    receiver.regtest = true;
    receiver.configure(c).unwrap();
    let r = receiver
        .open("recipient", PASSWORD.into(), None, 0, true)
        .unwrap();
    let recipient = r["addresses"][1]["address"].as_str().unwrap();
    let seed = sender.reveal(PASSWORD.into()).unwrap();
    let words: Vec<_> = seed["key"].as_str().unwrap().split_whitespace().collect();
    sender
        .backup_confirm(
            PASSWORD.into(),
            [2, 10, 19].iter().map(|&i| words[i].to_string()).collect(),
        )
        .unwrap();
    println!("Mining 90 local blocks for mature regtest outputs…");
    node.call(
        "generateblocks",
        json!({"wallet_address":miner,"amount_of_blocks":90}),
    );
    sender.refresh().unwrap();
    assert!(sender.prepare("bad address", "1", 0, None).is_err());
    assert!(sender.prepare(recipient, "99999999", 0, None).is_err());
    assert!(sender
        .prepare(recipient, "1", 0, Some(999))
        .unwrap_err()
        .contains("does not belong"));
    assert!(
        sender.prepare(recipient, "1", 0, Some(1)).is_err(),
        "An empty selected address must never fall back to funded address 0"
    );
    let canceled = sender.prepare(recipient, "1", 0, Some(0)).unwrap();
    sender.cancel();
    assert!(sender
        .send(canceled["id"].as_str().unwrap(), PASSWORD.into())
        .is_err());
    let review = sender
        .prepare(recipient, "1.000000000001", 0, Some(0))
        .unwrap();
    assert_eq!(review["amount"], "1000000000001");
    assert!(review["fee"].as_str().unwrap().parse::<u64>().unwrap() > 0);
    let id = review["id"].as_str().unwrap();
    assert!(sender.send(id, "incorrect".into()).is_err());
    assert!(sender.send("stale-review", PASSWORD.into()).is_err());
    let result = sender.send(id, PASSWORD.into()).unwrap();
    assert_eq!(result["status"], "sent");
    assert!(sender.send(id, PASSWORD.into()).is_err());
    node.call(
        "generateblocks",
        json!({"wallet_address":miner,"amount_of_blocks":11}),
    );
    let received = receiver.refresh().unwrap();
    assert_eq!(received["balance"], "1000000000001");
    assert_eq!(received["addresses"][1]["balance"], "1000000000001");
    assert_eq!(received["addresses"][1]["unlocked"], "1000000000001");
    assert_eq!(received["transactions"][0]["id"], result["txid"]);
    sender.lock().unwrap();
    receiver.lock().unwrap();
    let restored = receiver
        .open("recipient", PASSWORD.into(), None, 0, false)
        .unwrap();
    assert_eq!(restored["balance"], "1000000000001");
    println!("PASS: exact 1.000000000001 XMR regtest send, fee review, password authorization, duplicate prevention, chain confirmation, per-subaddress balance and persistence");
}

#[test]
#[ignore = "Checks guardian cleanup using the real bundled wallet process"]
fn guardian_shutdown_and_rpc_authentication() {
    let dir = tempfile::tempdir().unwrap();
    let rpc_port = port();
    let mut guardian = Command::new(env!("CARGO_BIN_EXE_monero-by-astera"))
        .arg("--guard-wallet-engine")
        .arg(binary())
        .args(["--wallet-dir"])
        .arg(dir.path())
        .args([
            "--offline",
            "--no-dns",
            "--rpc-bind-ip",
            "127.0.0.1",
            "--rpc-bind-port",
            &rpc_port.to_string(),
            "--rpc-login",
            "monero-by-astera:disposable-integration-credential",
            "--rpc-ssl",
            "disabled",
            "--log-file",
            "/dev/null",
            "--shared-ringdb-dir",
        ])
        .arg(dir.path().join("rings"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap();
    let endpoint = format!("http://127.0.0.1:{rpc_port}/json_rpc");
    let mut ready = false;
    for _ in 0..100 {
        if let Ok(r) = client
            .post(&endpoint)
            .json(&json!({"jsonrpc":"2.0","id":"test","method":"get_version"}))
            .send()
        {
            assert_eq!(r.status(), 401);
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(ready, "Engine never became ready");
    // EOF is exactly what happens to this pipe on a UI-process crash/SIGKILL.
    drop(guardian.stdin.take());
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while guardian.try_wait().unwrap().is_none() {
        assert!(
            std::time::Instant::now() < deadline,
            "Guardian did not terminate"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        client.post(&endpoint).send().is_err(),
        "Wallet engine survived loss of UI liveness pipe"
    );
    println!(
        "PASS: wallet RPC rejects unauthenticated requests and engine stops on guardian pipe EOF"
    );
}

#[test]
#[ignore = "Verifies missing SOCKS proxy fails closed with the real wallet engine"]
fn tor_missing_proxy_fails_closed() {
    let dir = tempfile::tempdir().unwrap();
    let mut wallet = Engine::new(dir.path().join("tor-wallet"), binary()).unwrap();
    wallet.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    wallet
        .configure(Connection {
            network: "stagenet".into(),
            mode: "tor".into(),
            node: format!("http://{}.onion:38081", "a".repeat(56)),
            proxy: format!("127.0.0.1:{}", port()),
        })
        .unwrap();
    wallet
        .open("tor-test", PASSWORD.into(), None, 0, true)
        .unwrap();
    assert!(wallet.refresh().is_err());
    assert!(wallet.last_sync.is_none());
    wallet.lock().unwrap();
    println!("PASS: unavailable local SOCKS proxy prevents wallet sync");
}

fn engine_at(path: PathBuf, c: Connection) -> Engine {
    let mut e = Engine::new(path, binary()).unwrap();
    e.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    e.regtest = true;
    e.configure(c).unwrap();
    e
}
fn backup_seed(e: &mut Engine) {
    let seed = e.reveal(PASSWORD.into()).unwrap();
    let words: Vec<_> = seed["key"].as_str().unwrap().split_whitespace().collect();
    e.backup_confirm(
        PASSWORD.into(),
        [2, 10, 19].iter().map(|&i| words[i].into()).collect(),
    )
    .unwrap();
}
fn move_packet(from: &Engine, to: &Engine, result: &Value) -> String {
    let file = result["file"].as_str().unwrap();
    std::fs::copy(
        from.exchange_dir().unwrap().join(file),
        to.exchange_dir().unwrap().join(file),
    )
    .unwrap();
    file.into()
}
fn start_node(dir: &std::path::Path) -> Node {
    let daemon = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../work/monero-aarch64-apple-darwin11-v0.18.5.1/monerod");
    let rpc_port = port();
    let url = format!("http://127.0.0.1:{rpc_port}");
    let child = Command::new(daemon)
        .args([
            "--regtest",
            "--offline",
            "--fixed-difficulty",
            "1",
            "--no-zmq",
            "--p2p-bind-ip",
            "127.0.0.1",
            "--p2p-bind-port",
            &port().to_string(),
            "--rpc-bind-ip",
            "127.0.0.1",
            "--rpc-bind-port",
            &rpc_port.to_string(),
            "--rpc-ssl",
            "disabled",
            "--non-interactive",
            "--disable-dns-checkpoints",
            "--check-updates",
            "disabled",
            "--data-dir",
        ])
        .arg(dir.join("node"))
        .args(["--log-file", "/dev/null", "--log-level", "0"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let node = Node { child, url };
    let c = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap();
    for i in 0..100 {
        if c.get(format!("{}/get_height", node.url)).send().is_ok() {
            return node;
        }
        assert!(i < 99);
        std::thread::sleep(Duration::from_millis(100));
    }
    unreachable!()
}
#[test]
#[ignore = "Real Monero Polyseed recovery, accounts, encrypted backup and packet boundary tests"]
fn polyseed_accounts_and_backup() {
    let dir = tempfile::tempdir().unwrap();
    let c = Connection {
        mode: "offline".into(),
        ..Connection::default()
    };
    let mut e = engine_at(dir.path().join("source"), c.clone());
    let phrase="raven tail swear infant grief assist regular lamp duck valid someone little harsh puppy airport language";
    let expected = monero_by_astera_core::polyseed::recover(phrase, "", "mainnet")
        .unwrap()
        .address;
    let s = e
        .restore_polyseed("poly", PASSWORD.into(), phrase.into(), "".into(), 0)
        .unwrap();
    assert_eq!(s["addresses"][0]["address"], expected);
    let accounts = e.account(None, Some("Savings <private>")).unwrap();
    assert_eq!(accounts["account"], 1);
    assert_eq!(accounts["accounts"][1]["label"], "Savings <private>");
    let savings = accounts["addresses"][0]["address"].clone();
    assert_ne!(savings, expected);
    e.address("Income", None).unwrap();
    e.account(Some(0), None).unwrap();
    assert!(e.account(Some(99), None).is_err());
    let saved = e.backup_files(PASSWORD.into()).unwrap();
    let mut restored = engine_at(dir.path().join("restored"), c.clone());
    for entry in std::fs::read_dir(e.exchange_dir().unwrap()).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(
            entry.path(),
            restored.exchange_dir().unwrap().join(entry.file_name()),
        )
        .unwrap();
    }
    let restored_snapshot = restored
        .restore_backup(
            "recovered",
            PASSWORD.into(),
            saved["file"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(restored_snapshot["addresses"][0]["address"], expected);
    let a = restored.account(Some(1), None).unwrap();
    assert_eq!(a["addresses"][0]["address"], savings);
    assert_eq!(a["addresses"][1]["label"], "Income");
    let legacy = e.reveal(PASSWORD.into()).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_string();
    e.lock().unwrap();
    let s = e
        .open("legacy", PASSWORD.into(), Some(legacy), 0, true)
        .unwrap();
    assert_eq!(s["addresses"][0]["address"], expected);
    assert!(e
        .review_exchange("sign-offline", "../outside.json")
        .is_err());
    std::os::unix::fs::symlink("/etc/hosts", e.exchange_dir().unwrap().join("symlink.json"))
        .unwrap();
    assert!(e.review_exchange("sign-offline", "symlink.json").is_err());
    println!("PASS: Polyseed ↔ legacy recovery, independent accounts, encrypted label-preserving backup restore, path traversal and symlink rejection");
}
#[test]
#[ignore = "Real offline signer/watch-only round trip on isolated regtest"]
fn cold_wallet_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path());
    let c = Connection {
        node: node.url.clone(),
        mode: "trusted-local".into(),
        ..Connection::default()
    };
    let mut cold = engine_at(
        dir.path().join("cold"),
        Connection {
            mode: "offline".into(),
            ..Connection::default()
        },
    );
    let s = cold.open("cold", PASSWORD.into(), None, 0, true).unwrap();
    backup_seed(&mut cold);
    let miner = s["addresses"][0]["address"].as_str().unwrap();
    node.call(
        "generateblocks",
        json!({"wallet_address":miner,"amount_of_blocks":90}),
    );
    let mut watch = engine_at(dir.path().join("watch"), c.clone());
    let packet = cold
        .exchange_operation("export-watch", vec![], PASSWORD.into())
        .unwrap();
    let file = move_packet(&cold, &watch, &packet);
    watch
        .create_watch("companion", PASSWORD.into(), &file)
        .unwrap();
    assert!(watch.reveal(PASSWORD.into()).is_err());
    watch.refresh().unwrap();
    cold.lock().unwrap();
    cold.configure(Connection {
        mode: "offline".into(),
        ..Connection::default()
    })
    .unwrap();
    cold.open("cold", PASSWORD.into(), None, 0, false).unwrap();
    let p = watch
        .exchange_operation("export-outputs", vec![], PASSWORD.into())
        .unwrap();
    let f = move_packet(&watch, &cold, &p);
    cold.exchange_operation("import-outputs", vec![f], PASSWORD.into())
        .unwrap();
    let p = cold
        .exchange_operation("export-images", vec![], PASSWORD.into())
        .unwrap();
    let f = move_packet(&cold, &watch, &p);
    watch
        .exchange_operation("import-images", vec![f], PASSWORD.into())
        .unwrap();
    let mut receiver = engine_at(dir.path().join("receiver"), c);
    let r = receiver
        .open("recipient", PASSWORD.into(), None, 0, true)
        .unwrap();
    let destination = r["addresses"][1]["address"].as_str().unwrap();
    let review = watch
        .prepare(destination, "2.000000000001", 0, None)
        .unwrap();
    assert_eq!(review["operation"], "unsigned");
    let unsigned = watch
        .send(review["id"].as_str().unwrap(), PASSWORD.into())
        .unwrap();
    let file = move_packet(&watch, &cold, &unsigned);
    let review = cold.review_exchange("sign-offline", &file).unwrap();
    assert_eq!(
        review["descriptions"]["transactions"][0]["recipients"][0]["amount"],
        "2000000000001"
    );
    let signed = cold
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "")
        .unwrap();
    assert!(cold.review_exchange("sign-offline", &file).is_err());
    let file = move_packet(&cold, &watch, &signed);
    let review = watch.review_exchange("broadcast-signed", &file).unwrap();
    assert!(watch
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "wrong")
        .is_err());
    let signed_bytes = std::fs::read(watch.exchange_dir().unwrap().join(&file)).unwrap();
    std::fs::write(
        watch.exchange_dir().unwrap().join(&file),
        b"file replaced after review",
    )
    .unwrap();
    let sent = watch
        .confirm_exchange(
            review["id"].as_str().unwrap(),
            PASSWORD.into(),
            signed["fingerprint"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(sent["status"], "sent");
    std::fs::write(watch.exchange_dir().unwrap().join(&file), signed_bytes).unwrap();
    assert!(watch.review_exchange("broadcast-signed", &file).is_err());
    node.call(
        "generateblocks",
        json!({"wallet_address":miner,"amount_of_blocks":11}),
    );
    assert_eq!(receiver.refresh().unwrap()["balance"], "2000000000001");
    println!("PASS: watch-only outputs/key images, real unsigned payment, offline decoded review/signature, fingerprint-authenticated broadcast, exact recipient amount and replay prevention");
}
#[test]
#[ignore = "Real 2-of-2 multisig setup and funded signing on regtest"]
fn multisig_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path());
    let c = Connection {
        mode: "trusted-local".into(),
        node: node.url.clone(),
        ..Connection::default()
    };
    let mut a = engine_at(dir.path().join("alice"), c.clone());
    let mut b = engine_at(dir.path().join("bob"), c.clone());
    let mut pa = a.create_multisig("alice", PASSWORD.into(), 2, 2).unwrap();
    let mut pb = b.create_multisig("bob", PASSWORD.into(), 2, 2).unwrap();
    for _ in 0..4 {
        if a.snapshot().unwrap()["multisig"]["ready"] == true
            && b.snapshot().unwrap()["multisig"]["ready"] == true
        {
            break;
        }
        let fa = move_packet(&b, &a, &pb);
        let fb = move_packet(&a, &b, &pa);
        pa = a.multisig_step(vec![fa], PASSWORD.into()).unwrap();
        pb = b.multisig_step(vec![fb], PASSWORD.into()).unwrap();
    }
    let s = a.snapshot().unwrap();
    assert_eq!(s["multisig"]["ready"], true);
    let shared = s["addresses"][0]["address"].as_str().unwrap();
    assert_eq!(b.snapshot().unwrap()["addresses"][0]["address"], shared);
    a.backup_files(PASSWORD.into()).unwrap();
    b.backup_files(PASSWORD.into()).unwrap();
    node.call(
        "generateblocks",
        json!({"wallet_address":shared,"amount_of_blocks":90}),
    );
    a.refresh().unwrap();
    b.refresh().unwrap();
    let pa = a
        .exchange_operation("export-multisig-info", vec![], PASSWORD.into())
        .unwrap();
    let pb = b
        .exchange_operation("export-multisig-info", vec![], PASSWORD.into())
        .unwrap();
    let fa = move_packet(&b, &a, &pb);
    let fb = move_packet(&a, &b, &pa);
    a.exchange_operation("import-multisig-info", vec![fa], PASSWORD.into())
        .unwrap();
    b.exchange_operation("import-multisig-info", vec![fb], PASSWORD.into())
        .unwrap();
    let mut receiver = engine_at(dir.path().join("receiver"), c);
    let r = receiver
        .open("recipient", PASSWORD.into(), None, 0, true)
        .unwrap();
    let review = a
        .prepare(
            r["addresses"][1]["address"].as_str().unwrap(),
            "3.000000000001",
            0,
            None,
        )
        .unwrap();
    assert_eq!(review["operation"], "multisig");
    let unsigned = a
        .send(review["id"].as_str().unwrap(), PASSWORD.into())
        .unwrap();
    let file = move_packet(&a, &b, &unsigned);
    let review = b.review_exchange("sign-multisig", &file).unwrap();
    let signed = b
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "")
        .unwrap();
    let file = move_packet(&b, &a, &signed);
    let review = a.review_exchange("broadcast-multisig", &file).unwrap();
    let sent = a
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "")
        .unwrap();
    assert_eq!(sent["status"], "sent");
    node.call(
        "generateblocks",
        json!({"wallet_address":shared,"amount_of_blocks":11}),
    );
    assert_eq!(receiver.refresh().unwrap()["balance"], "3000000000001");
    println!("PASS: 2-of-2 multisig exchange, common address, encrypted backups, funded transaction, second signature and broadcast");
}
#[test]
#[ignore = "Real 2-of-3 quorum: any two participants can complete a payment"]
fn multisig_two_of_three() {
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path());
    let c = Connection {
        mode: "trusted-local".into(),
        node: node.url.clone(),
        ..Connection::default()
    };
    let mut wallets: Vec<Engine> = (0..3)
        .map(|i| engine_at(dir.path().join(format!("signer{i}")), c.clone()))
        .collect();
    let mut packets: Vec<Value> = wallets
        .iter_mut()
        .enumerate()
        .map(|(i, w)| {
            w.create_multisig(&format!("signer{i}"), PASSWORD.into(), 2, 3)
                .unwrap()
        })
        .collect();
    for _ in 0..5 {
        if wallets
            .iter()
            .all(|w| w.snapshot().unwrap()["multisig"]["ready"] == true)
        {
            break;
        }
        let previous = packets.clone();
        for i in 0..3 {
            let files = (0..3)
                .filter(|&j| j != i)
                .map(|j| move_packet(&wallets[j], &wallets[i], &previous[j]))
                .collect();
            packets[i] = wallets[i].multisig_step(files, PASSWORD.into()).unwrap();
        }
    }
    let s = wallets[0].snapshot().unwrap();
    assert_eq!(s["multisig"]["ready"], true);
    let shared = s["addresses"][0]["address"].as_str().unwrap();
    for w in &mut wallets {
        assert_eq!(w.snapshot().unwrap()["addresses"][0]["address"], shared);
        w.backup_files(PASSWORD.into()).unwrap();
    }
    node.call(
        "generateblocks",
        json!({"wallet_address":shared,"amount_of_blocks":90}),
    );
    for w in &mut wallets {
        w.refresh().unwrap();
    }
    let infos: Vec<_> = wallets
        .iter_mut()
        .map(|w| {
            w.exchange_operation("export-multisig-info", vec![], PASSWORD.into())
                .unwrap()
        })
        .collect();
    for i in 0..3 {
        let files = (0..3)
            .filter(|&j| j != i)
            .map(|j| move_packet(&wallets[j], &wallets[i], &infos[j]))
            .collect();
        wallets[i]
            .exchange_operation("import-multisig-info", files, PASSWORD.into())
            .unwrap();
    }
    let mut receiver = engine_at(dir.path().join("receiver"), c);
    let r = receiver
        .open("recipient", PASSWORD.into(), None, 0, true)
        .unwrap();
    let review = wallets[0]
        .prepare(
            r["addresses"][1]["address"].as_str().unwrap(),
            "4.000000000001",
            0,
            None,
        )
        .unwrap();
    let unsigned = wallets[0]
        .send(review["id"].as_str().unwrap(), PASSWORD.into())
        .unwrap();
    let file = move_packet(&wallets[0], &wallets[2], &unsigned);
    let review = wallets[2].review_exchange("sign-multisig", &file).unwrap();
    let signed = wallets[2]
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "")
        .unwrap();
    let file = move_packet(&wallets[2], &wallets[0], &signed);
    let review = wallets[0]
        .review_exchange("broadcast-multisig", &file)
        .unwrap();
    let sent = wallets[0]
        .confirm_exchange(review["id"].as_str().unwrap(), PASSWORD.into(), "")
        .unwrap();
    assert_eq!(sent["status"], "sent");
    node.call(
        "generateblocks",
        json!({"wallet_address":shared,"amount_of_blocks":11}),
    );
    assert_eq!(receiver.refresh().unwrap()["balance"], "4000000000001");
    println!("PASS: 2-of-3 setup and sync, payment signed by participants 1 and 3, confirmed exact recipient balance");
}

#[test]
#[ignore = "Real split transactions on an isolated regtest chain; no real funds"]
fn multi_source_round_trip() {
    use monero_by_astera_core::{SourcePlan, SourceShare};
    let dir = tempfile::tempdir().unwrap();
    let node = start_node(dir.path());
    let config = Connection {
        node: node.url.clone(),
        ..Connection::default()
    };
    let mut sender = engine_at(dir.path().join("sender"), config.clone());
    let snapshot = sender
        .open("sender", PASSWORD.into(), None, 0, true)
        .unwrap();
    backup_seed(&mut sender);
    let miner = snapshot["addresses"][0]["address"]
        .as_str()
        .unwrap()
        .to_owned();
    sender.address("Second source", None).unwrap();
    let mut receiver = engine_at(dir.path().join("receiver"), config);
    let destination = receiver
        .open("receiver", PASSWORD.into(), None, 0, true)
        .unwrap()["addresses"][1]["address"]
        .as_str()
        .unwrap()
        .to_owned();
    node.call(
        "generateblocks",
        json!({"wallet_address":miner,"amount_of_blocks":90}),
    );
    sender.refresh().unwrap();
    for round in 0..2 {
        let snap = sender.snapshot().unwrap();
        for index in [1, 2] {
            let address = snap["addresses"][index]["address"].as_str().unwrap();
            let review = sender.prepare(address, "10", 0, Some(0)).unwrap();
            assert_eq!(
                sender
                    .send(review["id"].as_str().unwrap(), PASSWORD.into())
                    .unwrap()["status"],
                "sent"
            );
        }
        node.call(
            "generateblocks",
            json!({"wallet_address":miner,"amount_of_blocks":11}),
        );
        sender.refresh().unwrap();
        if round == 0 {
            let auto = sender
                .prepare_with_sources(
                    &destination,
                    "15",
                    0,
                    SourcePlan {
                        indices: vec![1, 2],
                        ..SourcePlan::default()
                    },
                )
                .unwrap();
            assert_eq!(auto["sources"], json!([1, 2]));
            sender.cancel();
            assert!(sender
                .send(auto["id"].as_str().unwrap(), PASSWORD.into())
                .is_err());
            assert!(
                sender
                    .prepare_with_sources(
                        &destination,
                        "21",
                        0,
                        SourcePlan {
                            indices: vec![1, 2],
                            ..SourcePlan::default()
                        }
                    )
                    .is_err(),
                "Must not use funded primary address"
            );
        }
        let plan = if round == 0 {
            SourcePlan {
                indices: vec![2, 1],
                allocation: "equal".into(),
                shares: vec![],
            }
        } else {
            SourcePlan {
                indices: vec![1, 2],
                allocation: "custom".into(),
                shares: vec![
                    SourceShare {
                        index: 1,
                        amount: "1".into(),
                    },
                    SourceShare {
                        index: 2,
                        amount: "2".into(),
                    },
                ],
            }
        };
        let amount = if round == 0 { "3.000000000001" } else { "3" };
        let review = sender
            .prepare_with_sources(&destination, amount, 0, plan)
            .unwrap();
        assert_eq!(review["parts"].as_array().unwrap().len(), 2);
        if round == 0 {
            assert_eq!(review["parts"][0]["amount"], "1500000000001");
            assert_eq!(review["parts"][1]["amount"], "1500000000000");
        }
        let id = review["id"].as_str().unwrap();
        assert!(sender.send(id, "wrong-password".into()).is_err());
        let result = sender.send(id, PASSWORD.into()).unwrap();
        assert_eq!(result["status"], "sent", "{result}");
        assert!(result["parts"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["status"] == "sent"));
        assert!(sender.send(id, PASSWORD.into()).is_err());
        node.call(
            "generateblocks",
            json!({"wallet_address":miner,"amount_of_blocks":11}),
        );
        let balance = receiver.refresh().unwrap();
        assert_eq!(
            balance["balance"],
            if round == 0 {
                "3000000000001"
            } else {
                "6000000000001"
            }
        );
        sender.lock().unwrap();
        let reopened = sender
            .open("sender", PASSWORD.into(), None, 0, false)
            .unwrap();
        assert_eq!(reopened["lastPayment"]["parts"], result["parts"]);
    }
    println!("PASS: multiple-source restriction, equal/custom real split transactions, exact settlement, duplicate/cancel protection and encrypted receipt persistence");
}

#[test]
#[ignore = "Explicit public node discovery; no wallet keys opened"]
fn live_node_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let e = Engine::new(dir.path().join("discovery"), binary()).unwrap();
    let mut c = Connection {
        mode: "remote".into(),
        ..Connection::default()
    };
    let epoch = e.control.epoch();
    assert!(
        monero_by_astera_core::node::discover(&c, false, false, &e.control, epoch)
            .unwrap_err()
            .contains("Accept")
    );
    c.mode = "vpn".into();
    assert!(
        monero_by_astera_core::node::discover(&c, true, false, &e.control, epoch)
            .unwrap_err()
            .contains("Confirm")
    );
    c.mode = "remote".into();
    let result = monero_by_astera_core::node::discover(&c, true, false, &e.control, epoch).unwrap();
    assert_eq!(result["tested"], 4);
    let nodes = result["nodes"].as_array().unwrap();
    assert!(!nodes.is_empty(), "No live candidates: {result}");
    for node in nodes {
        assert_eq!(node["ready"], true);
        assert_eq!(node["network"], "mainnet");
        assert_eq!(node["certificateSha256"].as_str().unwrap().len(), 64);
    }
    println!("DISCOVERY {result}");
}

#[test]
#[ignore = "Disposable wallet and local HTTP trap; no external network"]
fn opening_wallet_does_not_start_a_background_scan() {
    use std::{
        io::{Read, Write},
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::Instant,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut e = Engine::new(dir.path().join("no-background-scan"), binary()).unwrap();
    e.configure(Connection {
        mode: "offline".into(),
        ..Connection::default()
    })
    .unwrap();
    e.open("disposable", PASSWORD.into(), None, 0, true)
        .unwrap();
    e.lock().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let hits = calls.clone();
    let finished = stop.clone();
    let server = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !finished.load(Ordering::SeqCst) && Instant::now() < deadline {
            if let Ok((mut socket, _)) = listener.accept() {
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request);
                hits.fetch_add(1, Ordering::SeqCst);
                let _ = socket.write_all(
                    b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    e.configure(Connection {
        node: url,
        ..Connection::default()
    })
    .unwrap();
    let open = e.open("disposable", PASSWORD.into(), None, 0, false);
    std::thread::sleep(Duration::from_millis(300)); // Cross the RPC server's idle-handler tick.
    let before = calls.load(Ordering::SeqCst);
    let sync = e.refresh();
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    assert!(open.is_ok(), "{open:?}");
    assert_eq!(before, 0, "Opening must not trigger an automatic scan");
    assert!(sync.is_err());
    assert!(
        calls.load(Ordering::SeqCst) > 0,
        "Explicit sync should contact the selected node"
    );
    e.lock().unwrap();
    println!("PASS: unlock made no daemon request; explicit sync contacted the local trap");
}

#[test]
#[ignore = "Uses a disposable offline wallet and verified Monero engine"]
fn unlabeled_addresses_and_late_labels_persist() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = Engine::new(dir.path().join("wallets"), binary()).unwrap();
    e.guardian = Some(PathBuf::from(env!("CARGO_BIN_EXE_monero-by-astera")));
    e.configure(Connection {
        mode: "offline".into(),
        ..Connection::default()
    })
    .unwrap();
    e.open("labels", PASSWORD.into(), None, 0, true).unwrap();
    let created = e.address("", None).unwrap();
    assert_eq!(created["addresses"].as_array().unwrap().len(), 3);
    assert_eq!(created["addresses"][2]["label"], "");
    let address = created["addresses"][2]["address"].clone();
    let labeled = e.address("Optional later label", Some(2)).unwrap();
    assert_eq!(labeled["addresses"][2]["address"], address);
    e.lock().unwrap();
    let reopened = e.open("labels", PASSWORD.into(), None, 0, false).unwrap();
    assert_eq!(reopened["addresses"][2]["label"], "Optional later label");
    let cleared = e.address("", Some(2)).unwrap();
    assert_eq!(cleared["addresses"][2]["address"], address);
    assert_eq!(cleared["addresses"].as_array().unwrap().len(), 3);
    e.lock().unwrap();
    let reopened = e.open("labels", PASSWORD.into(), None, 0, false).unwrap();
    assert_eq!(reopened["addresses"][2]["label"], "");
    assert_eq!(reopened["addresses"][2]["address"], address);
    e.lock().unwrap();
}
