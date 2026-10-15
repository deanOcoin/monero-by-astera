mod payments;
mod progress;
mod tls_identity;
pub use payments::{SourcePlan, SourceShare};
mod advanced;
pub mod clipboard;
mod idle;
pub mod node;
pub mod polyseed;
pub mod tor;
pub mod view;
use argon2::{
    password_hash::{PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use fs2::FileExt;
use rand::{rngs::OsRng, RngCore};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn random() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn private_dir(p: &Path) -> Result<()> {
    if fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Wallet directory cannot be a symbolic link".into());
    }
    fs::create_dir_all(p).map_err(err)?;
    fs::set_permissions(p, fs::Permissions::from_mode(0o700)).map_err(err)
}
fn private_write(p: &Path, data: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(p)
        .map_err(err)?;
    f.write_all(data).map_err(err)
}
fn binary_digest(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(err)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub fn atomic(input: &str) -> Result<u64> {
    if input.is_empty() || input.len() > 21 || input.trim() != input {
        return Err("Enter an XMR amount".into());
    }
    let parts: Vec<_> = input.split('.').collect();
    if parts.len() > 2 || parts[0].is_empty() || !parts[0].bytes().all(|c| c.is_ascii_digit()) {
        return Err("Use a plain decimal amount".into());
    }
    if (parts[0].len() > 1 && parts[0].starts_with('0'))
        || (parts.len() == 2 && parts[1].is_empty())
    {
        return Err("Use a plain decimal amount without leading zeros".into());
    }
    let frac = parts.get(1).copied().unwrap_or("");
    if frac.len() > 12 || !frac.bytes().all(|c| c.is_ascii_digit()) {
        return Err("XMR supports up to 12 decimal places".into());
    }
    let whole = parts[0].parse::<u64>().map_err(|_| "Amount is too large")?;
    let f = format!("{frac:0<12}").parse::<u64>().map_err(err)?;
    whole
        .checked_mul(1_000_000_000_000)
        .and_then(|w| w.checked_add(f))
        .filter(|a| *a > 0)
        .ok_or("Amount must be positive and within range".into())
}
pub fn name_ok(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 48
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err("Use 1–48 letters, numbers, hyphens or underscores for the wallet name".into())
    } else {
        Ok(())
    }
}
fn label_ok(s: &str) -> Result<()> {
    if s.chars().count() > 80 || s.chars().any(char::is_control) {
        Err("Labels must be at most 80 characters without control characters".into())
    } else {
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Connection {
    pub network: String,
    pub mode: String,
    pub node: String,
    pub proxy: String,
}
impl Default for Connection {
    fn default() -> Self {
        Self {
            network: "mainnet".into(),
            mode: "local".into(),
            node: "http://127.0.0.1:18081".into(),
            proxy: "127.0.0.1:9050".into(),
        }
    }
}
impl Connection {
    pub fn validate(&self) -> Result<()> {
        if !["mainnet", "stagenet", "testnet"].contains(&self.network.as_str()) {
            return Err("Unknown Monero network".into());
        }
        if !["local", "trusted-local", "remote", "tor", "vpn", "offline"]
            .contains(&self.mode.as_str())
        {
            return Err("Unknown connection mode".into());
        }
        if self.mode == "offline" {
            return Ok(());
        }
        let u = url::Url::parse(&self.node)
            .map_err(|_| "Enter a full node URL, including http:// or https://")?;
        if !["http", "https"].contains(&u.scheme())
            || u.host_str().is_none()
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != "/"
        {
            return Err("Use a node origin without credentials, paths or query parameters".into());
        }
        let host = u.host_str().unwrap();
        let local = ["127.0.0.1", "localhost", "[::1]"].contains(&host);
        if ["local", "trusted-local"].contains(&self.mode.as_str()) && !local {
            return Err("Local mode requires a loopback node".into());
        }
        if ["remote", "vpn"].contains(&self.mode.as_str()) && u.scheme() != "https" {
            return Err("Direct remote connections require HTTPS".into());
        }
        if self.mode == "tor" {
            if !host.strip_suffix(".onion").is_some_and(|name| {
                name.len() == 56
                    && name
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b))
            }) {
                return Err(
                    "Tor mode requires a full v3 onion node address (56 characters before .onion)"
                        .into(),
                );
            }
            let p = self
                .proxy
                .parse::<std::net::SocketAddr>()
                .map_err(|_| "Use a local SOCKS address such as 127.0.0.1:9050")?;
            if !p.ip().is_loopback() || p.port() == 0 {
                return Err("Tor SOCKS proxy must be on this computer".into());
            }
        }
        if self.mode != "tor" && host.ends_with(".onion") {
            return Err("Onion nodes require Tor mode".into());
        }
        Ok(())
    }
}

pub struct Rpc {
    client: Client,
    url: String,
    password: Zeroizing<String>,
}
impl Rpc {
    pub fn new(port: u16, password: String) -> Result<Self> {
        Ok(Self {
            client: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(err)?,
            url: format!("http://127.0.0.1:{port}/json_rpc"),
            password: Zeroizing::new(password),
        })
    }
    pub fn call(&self, method: &str, params: Value) -> Result<Value> {
        // Never send a wallet password or seed in the unauthenticated challenge request.
        let probe = self
            .client
            .post(&self.url)
            .json(&json!({"jsonrpc":"2.0","id":"0","method":"get_version"}))
            .send()
            .map_err(|_| "Wallet engine is unavailable")?;
        if probe.status() != 401 {
            return Err("Wallet engine did not require authentication; refusing connection".into());
        }
        let header = probe
            .headers()
            .get("www-authenticate")
            .and_then(|h| h.to_str().ok())
            .ok_or("Missing wallet authentication challenge")?;
        let mut challenge =
            digest_auth::parse(header).map_err(|_| "Invalid wallet authentication challenge")?;
        let body = Zeroizing::new(
            json!({"jsonrpc":"2.0","id":"monero-by-astera","method":method,"params":params})
                .to_string(),
        );
        let ctx = digest_auth::AuthContext::new_post(
            "monero-by-astera",
            self.password.as_str(),
            "/json_rpc",
            Some(body.as_bytes()),
        );
        let auth = challenge
            .respond(&ctx)
            .map_err(|_| "Wallet authentication failed")?
            .to_string();
        let response = self
            .client
            .post(&self.url)
            .timeout(Duration::from_secs(if method == "refresh" { 1800 } else { 180 }))
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .map_err(|_| {
                if method == "refresh" {
                    "The scan stopped responding or the wallet was locked. Unlock and retry sync; no payment was sent by syncing."
                } else {
                    "Wallet request failed or timed out. Check activity before retrying a payment."
                }
            })?;
        let data: Value = response
            .error_for_status()
            .map_err(|_| "Wallet engine rejected authentication")?
            .json()
            .map_err(|_| "Invalid wallet engine response")?;
        if let Some(e) = data.get("error") {
            let code = e["code"].as_i64().unwrap_or(0);
            let message = e["message"].as_str().filter(|s| !s.trim().is_empty())
                .unwrap_or("Wallet engine returned an unspecified error. Check the selected node and retry opening the wallet.");
            return Err(format!(
                "Monero {method} ({code}): {}",
                message.chars().take(240).collect::<String>()
            ));
        }
        data.get("result")
            .cloned()
            .ok_or("Missing wallet result".into())
    }
}
pub struct Control {
    child: Mutex<Option<Child>>,
    idle: Mutex<idle::IdleTimer>,
    epoch: AtomicU64,
    progress: Mutex<progress::Progress>,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
impl Control {
    pub fn phase(&self, label: &str) {
        if let Ok(mut p) = self.progress.lock() {
            p.set(label);
        }
    }
    pub fn progress(&self) -> Value {
        self.progress
            .lock()
            .map(|p| p.snapshot())
            .unwrap_or(json!({}))
    }
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }
    pub fn cancel(&self) {
        let mut timer = self.idle.lock().unwrap_or_else(|e| e.into_inner());
        timer.disarm();
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.interrupt();
    }
    fn activate(&self, epoch: u64) -> Result<()> {
        let mut timer = self.idle.lock().map_err(|_| "Idle timer unavailable")?;
        if self.epoch() != epoch {
            return Err("Operation canceled by wallet lock".into());
        }
        timer.arm(idle::now());
        Ok(())
    }
    pub fn touch(&self) -> bool {
        self.idle
            .lock()
            .map(|mut t| t.touch(idle::now()))
            .unwrap_or(false)
    }
    pub fn session_active(&self) -> bool {
        self.idle.lock().map(|t| t.active()).unwrap_or(false)
    }
    fn disarm(&self) {
        if let Ok(mut timer) = self.idle.lock() {
            timer.disarm();
        }
    }
    pub fn expire_if_idle(&self) -> bool {
        self.expire_at(idle::now())
    }
    fn expire_at(&self, now: Duration) -> bool {
        let mut timer = self.idle.lock().unwrap_or_else(|e| e.into_inner());
        if !timer.expired(now) {
            return false;
        }
        // Claim expiry once before interrupting RPC. Input cannot revive this session.
        timer.disarm();
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.interrupt();
        true
    }
    pub fn interrupt(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                // Closing the liveness pipe makes the guardian terminate the engine,
                // even if the UI parent crashed. A process-group kill is the bounded fallback.
                drop(child.stdin.take());
                let deadline = Instant::now() + Duration::from_secs(2);
                while Instant::now() < deadline {
                    if child.try_wait().ok().flatten().is_some() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
struct Process {
    control: Arc<Control>,
    pub rpc: Rpc,
    config: PathBuf,
    tls_identity: Option<tls_identity::EphemeralTls>,
}
impl Drop for Process {
    fn drop(&mut self) {
        self.control.interrupt();
        let _ = fs::remove_file(&self.config);
    }
}
struct Pending {
    id: String,
    operation: String,
    metadata: Zeroizing<String>,
    review: Value,
    created: Instant,
    parts: Vec<payments::PreparedPart>,
}
impl Pending {
    fn matches(&self, id: &str) -> Result<()> {
        if self.id != id {
            return Err("Payment review no longer matches".into());
        }
        Ok(())
    }
    fn expired(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.created) >= Duration::from_secs(120)
    }
}
pub struct Engine {
    #[cfg(debug_assertions)]
    pub regtest: bool,
    pub control: Arc<Control>,
    pub guardian: Option<PathBuf>,
    root: PathBuf,
    binary: PathBuf,
    _lock: File,
    process: Option<Process>,
    pub connection: Connection,
    pub wallet: Option<String>,
    password_hash: Option<Zeroizing<String>>,
    pending: Option<Pending>,
    pub last_sync: Option<u64>,
    pub sync_error: Option<String>,
    backup: bool,
    account: u32,
    vpn_confirmed: bool,
    direct_confirmed: bool,
    operation_epoch: u64,
    kind_cache: Mutex<Option<String>>,
    last_payment: Option<Value>,
}
impl Engine {
    pub fn begin_operation(&mut self, epoch: u64) -> Result<()> {
        if self.control.epoch() != epoch {
            return Err("Operation canceled by wallet lock".into());
        }
        self.operation_epoch = epoch;
        Ok(())
    }
    pub fn new(root: PathBuf, binary: PathBuf) -> Result<Self> {
        private_dir(&root)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(root.join("instance.lock"))
            .map_err(err)?;
        lock.try_lock_exclusive()
            .map_err(|_| "Monero by Astera is already running. Close the other instance first.")?;
        // Only after acquiring the exclusive app lock: remove credentials left by
        // an interrupted startup. Names and locations are generated by Monero by Astera.
        for entry in fs::read_dir(&root).map_err(err)?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.file_type().map_err(err)?.is_file()
                && name.starts_with("rpc-")
                && name.ends_with(".conf")
            {
                let _ = fs::remove_file(entry.path());
            }
            if entry.file_type().map_err(err)?.is_file() && tls_identity::temporary_name(&name) {
                let _ = fs::remove_file(entry.path());
            }
            if entry.file_type().map_err(err)?.is_dir()
                && name
                    .strip_prefix("hardware-")
                    .is_some_and(|n| n.len() == 64 && n.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                let _ = fs::remove_file(entry.path().join("password"));
            }
        }
        let connection = fs::read(root.join("connection.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Connection>(&b).ok())
            .filter(|c| c.validate().is_ok())
            .unwrap_or_default();
        Ok(Self {
            #[cfg(debug_assertions)]
            regtest: false,
            guardian: None,
            control: Arc::new(Control {
                child: Mutex::new(None),
                idle: Mutex::new(idle::IdleTimer::default()),
                epoch: AtomicU64::new(0),
                progress: Mutex::new(progress::Progress::default()),
            }),
            root,
            binary,
            _lock: lock,
            process: None,
            connection,
            wallet: None,
            password_hash: None,
            pending: None,
            last_sync: None,
            sync_error: None,
            backup: false,
            account: 0,
            vpn_confirmed: false,
            direct_confirmed: false,
            operation_epoch: 0,
            kind_cache: Mutex::new(None),
            last_payment: None,
        })
    }
    pub fn wallets(&self) -> Result<Vec<String>> {
        let p = self.root.join(&self.connection.network);
        private_dir(&p)?;
        let mut v = Vec::new();
        for e in fs::read_dir(p).map_err(err)?.flatten() {
            if e.file_type().map_err(err)?.is_file() {
                if let Some(s) = e.file_name().to_str().and_then(|s| s.strip_suffix(".keys")) {
                    if name_ok(s).is_ok() {
                        v.push(s.to_string())
                    }
                }
            }
        }
        v.sort();
        Ok(v)
    }
    pub fn configure(&mut self, c: Connection) -> Result<()> {
        if self.wallet.is_some() {
            return Err("Lock the wallet before changing its connection".into());
        }
        c.validate()?;
        self.process = None;
        let temp = self.root.join(format!("settings-{}.tmp", random()));
        private_write(&temp, &serde_json::to_vec_pretty(&c).map_err(err)?)?;
        fs::rename(temp, self.root.join("connection.json")).map_err(err)?;
        self.vpn_confirmed = false;
        self.direct_confirmed = false;
        self.connection = c;
        Ok(())
    }
    fn start(&mut self) -> Result<()> {
        if self.control.epoch() != self.operation_epoch {
            return Err("Operation canceled by wallet lock".into());
        }
        if self.process.is_some() {
            return Ok(());
        }
        self.connection.validate()?;
        if self.connection.mode == "vpn" && !self.vpn_confirmed {
            return Err("Confirm your external VPN and kill switch before opening a wallet".into());
        }
        if self.connection.mode == "remote" && !self.direct_confirmed {
            return Err("Review the direct-connection privacy notice and confirm this session before connecting".into());
        }
        self.control.phase("Verifying wallet engine");
        let actual = binary_digest(&self.binary)
            .map_err(|_| "Bundled Monero engine is missing or unreadable")?;
        let expected = include_str!("../resources/engine.sha256").trim();
        if actual != expected {
            return Err(
                "Monero engine integrity check failed. Refusing to open wallet keys.".into(),
            );
        }
        // Validate before creating temporary RPC credentials or opening wallet files.
        let fingerprint = if self.connection.mode != "offline"
            && self.connection.node.starts_with("https:")
        {
            self.control.phase("Checking HTTPS node");
            let checked = node::check(&self.connection, self.direct_confirmed, self.vpn_confirmed)?;
            Some(
                checked["certificateSha256"]
                    .as_str()
                    .ok_or("Could not verify the node certificate")?
                    .to_owned(),
            )
        } else {
            None
        };
        // Monero otherwise generates a 4096-bit RSA client identity on every open.
        // Supply a fresh P-384 identity, without changing server trust or TLS ciphers.
        let tls_identity = if fingerprint.is_some() {
            self.control.phase("Preparing private connection");
            Some(tls_identity::EphemeralTls::create(&self.root)?)
        } else {
            None
        };
        self.control.phase("Starting wallet engine");
        let listener = TcpListener::bind("127.0.0.1:0").map_err(err)?;
        let port = listener.local_addr().map_err(err)?.port();
        let wallets = self.root.join(&self.connection.network);
        private_dir(&wallets)?;
        let rings = wallets.join("ringdb");
        private_dir(&rings)?;
        let password = random();
        let config = self.root.join(format!("rpc-{}.conf", random()));
        private_write(
            &config,
            format!("rpc-login=monero-by-astera:{password}\n").as_bytes(),
        )?;
        let mut cmd = if let Some(guardian) = &self.guardian {
            let mut command = Command::new(guardian);
            command.arg("--guard-wallet-engine").arg(&self.binary);
            command
        } else {
            Command::new(&self.binary)
        };
        cmd.args(["--config-file"])
            .arg(&config)
            .args([
                "--rpc-bind-ip",
                "127.0.0.1",
                "--rpc-bind-port",
                &port.to_string(),
                "--rpc-ssl",
                "disabled",
                "--wallet-dir",
            ])
            .arg(&wallets)
            .args([
                "--log-file",
                "/dev/null",
                "--log-level",
                "0",
                "--max-log-files",
                "1",
                if self.connection.mode == "trusted-local" {
                    "--trusted-daemon"
                } else {
                    "--untrusted-daemon"
                },
                "--no-initial-sync",
                "--no-dns",
                "--shared-ringdb-dir",
            ])
            .arg(&rings);
        if self.connection.network != "mainnet" {
            cmd.arg(format!("--{}", self.connection.network));
        }
        if self.connection.mode == "offline" {
            cmd.args(["--offline", "--daemon-ssl", "disabled"]);
        } else {
            cmd.args(["--daemon-address", &self.connection.node]);
            if self.connection.node.starts_with("https:") {
                cmd.args(["--daemon-ssl", "enabled"]);
                let identity = tls_identity
                    .as_ref()
                    .ok_or("Missing temporary TLS identity")?;
                cmd.arg("--daemon-ssl-private-key").arg(&identity.key);
                cmd.arg("--daemon-ssl-certificate")
                    .arg(&identity.certificate);
                // Rustls has checked chain and hostname; pin that exact leaf for Monero, whose
                // user-CA mode skips hostname verification, so a general CA bundle is not enough.
                cmd.args([
                    "--daemon-ssl-allowed-fingerprints",
                    fingerprint
                        .as_deref()
                        .ok_or("Could not verify the node certificate")?,
                ]);
            } else {
                cmd.args(["--daemon-ssl", "disabled"]);
            }
            if self.connection.mode == "tor" {
                cmd.args(["--proxy", &self.connection.proxy]);
            }
        }
        #[cfg(debug_assertions)]
        if self.regtest {
            cmd.arg("--allow-mismatched-daemon-version");
        }
        cmd.current_dir(&self.root)
            .stdin(if self.guardian.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .process_group(0)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        drop(listener);
        let mut slot = self
            .control
            .child
            .lock()
            .map_err(|_| "Engine control unavailable")?;
        if self.control.epoch() != self.operation_epoch {
            return Err("Operation canceled by wallet lock".into());
        }
        *slot = Some(cmd.spawn().map_err(err)?);
        drop(slot);
        let process = Process {
            control: self.control.clone(),
            rpc: Rpc::new(port, password)?,
            config,
            tls_identity,
        };
        for _ in 0..100 {
            if self
                .control
                .child
                .lock()
                .map_err(|_| "Engine control unavailable")?
                .as_mut()
                .map(|c| c.try_wait().map(|s| s.is_some()))
                .transpose()
                .map_err(err)?
                .unwrap_or(true)
            {
                return Err(
                    "Monero engine could not start. Check the bundled engine and node settings."
                        .into(),
                );
            }
            if process.rpc.call("get_version", json!({})).is_ok() {
                // This RPC works before a wallet is open. Disable the server timer
                // now: doing it after open races its first automatic network scan.
                process.rpc.call("auto_refresh", json!({"enable":false}))?;
                fs::remove_file(&process.config).map_err(err)?;
                self.process = Some(process);
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Monero engine startup timed out".into())
    }
    fn rpc(&self) -> Result<&Rpc> {
        self.process
            .as_ref()
            .map(|p| &p.rpc)
            .ok_or("Wallet is locked".into())
    }
    fn unlocked(&self) -> Result<()> {
        if self.wallet.is_none() {
            Err("Wallet is locked".into())
        } else {
            Ok(())
        }
    }
    pub fn open(
        &mut self,
        name: &str,
        password: String,
        seed: Option<String>,
        height: u64,
        create: bool,
    ) -> Result<Value> {
        let password = Zeroizing::new(password);
        let seed = seed.map(Zeroizing::new);
        name_ok(name)?;
        if self.wallet.is_some() {
            return Err("Lock the current wallet first".into());
        }
        if create && password.chars().count() < 12 {
            return Err("Use at least 12 characters for the wallet password".into());
        }
        if password.len() > 1024 {
            return Err("Password is too long".into());
        }
        if create && self.wallets()?.iter().any(|n| n == name) {
            return Err("A wallet with this name already exists".into());
        }
        self.control.phase("Protecting wallet session");
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(err)?
            .to_string();
        self.start()?;
        self.control.phase("Decrypting wallet files");
        let restored = seed.is_some();
        let result = if let Some(seed) = seed {
            if seed.split_whitespace().count() != 25 {
                return Err("This form accepts a 25-word Monero seed. Use More wallet options for Polyseed recovery or hardware wallets.".into());
            }
            self.rpc()?.call("restore_deterministic_wallet",json!({"filename":name,"password":password.as_str(),"seed":seed.as_str(),"restore_height":height,"autosave_current":true}))
        } else if create {
            self.rpc()?.call(
                "create_wallet",
                json!({"filename":name,"password":password.as_str(),"language":"English"}),
            )
        } else {
            self.rpc()?.call(
                "open_wallet",
                json!({"filename":name,"password":password.as_str(),"autosave_current":true}),
            )
        };
        if let Err(e) = result {
            self.process = None;
            return Err(e);
        }
        self.activate(name, hash, create, restored)
    }
    fn activate(
        &mut self,
        name: &str,
        hash: String,
        create: bool,
        restored: bool,
    ) -> Result<Value> {
        // The engine has loaded the client identity; remove its temporary files now.
        if let Some(process) = self.process.as_mut() {
            process.tls_identity = None;
        }
        self.control.phase("Loading wallet balances");
        *self
            .kind_cache
            .lock()
            .map_err(|_| "Wallet state unavailable")? = None;
        self.account = 0;
        self.wallet = Some(name.into());
        self.password_hash = Some(Zeroizing::new(hash));
        self.control.activate(self.operation_epoch)?;
        self.last_sync = None;
        self.sync_error = None;
        self.backup = self
            .rpc()?
            .call("get_attribute", json!({"key":"astra.backup"}))
            .ok()
            .and_then(|v| v["value"].as_str().map(|v| v == "yes"))
            .unwrap_or(false);
        if create {
            self.rpc()?.call(
                "create_address",
                json!({"account_index":0,"label":"Everyday"}),
            )?;
            if restored {
                self.backup = true;
                self.rpc()?
                    .call("set_attribute", json!({"key":"astra.backup","value":"yes"}))?;
            }
            self.rpc()?.call("store", json!({}))?;
        }
        self.last_payment = self
            .rpc()?
            .call("get_attribute", json!({"key":"astra.last_payment"}))
            .ok()
            .and_then(|v| {
                v["value"]
                    .as_str()
                    .and_then(|s| serde_json::from_str(s).ok())
            })
            .filter(payments::valid_receipt);
        let snapshot = self.snapshot();
        self.control.phase("Ready");
        snapshot
    }
    pub fn verify(&self, password: &str) -> Result<()> {
        self.unlocked()?;
        let hash = PasswordHash::new(self.password_hash.as_ref().ok_or("Wallet is locked")?)
            .map_err(err)?;
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .map_err(|_| "Incorrect wallet password".into())
    }
    pub fn reveal(&self, password: String) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        if self.kind() != "software" {
            return Err(
                "Use the appropriate device or encrypted participant backup for this wallet type"
                    .into(),
            );
        }
        self.rpc()?
            .call("query_key", json!({"key_type":"mnemonic"}))
    }
    pub fn backup_confirm(&mut self, password: String, words: Vec<String>) -> Result<()> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        let seed = Zeroizing::new(
            self.rpc()?
                .call("query_key", json!({"key_type":"mnemonic"}))?["key"]
                .as_str()
                .ok_or("Seed unavailable")?
                .to_string(),
        );
        let s: Vec<_> = seed.split_whitespace().collect();
        if words.len() != 3
            || [2, 10, 19]
                .iter()
                .enumerate()
                .any(|(i, &j)| s.get(j).copied() != Some(words[i].trim()))
        {
            return Err("Those words do not match. Check words 3, 11 and 20.".into());
        }
        self.rpc()?
            .call("set_attribute", json!({"key":"astra.backup","value":"yes"}))?;
        self.rpc()?.call("store", json!({}))?;
        self.backup = true;
        Ok(())
    }
    pub fn lock(&mut self) -> Result<()> {
        self.control.disarm();
        self.pending = None;
        self.password_hash = None;
        self.last_payment = None;
        if let Ok(mut k) = self.kind_cache.lock() {
            *k = None;
        }
        self.wallet = None;
        self.vpn_confirmed = false;
        self.direct_confirmed = false;
        self.last_sync = None;
        self.sync_error = None;
        let running = self
            .control
            .child
            .lock()
            .map(|c| c.is_some())
            .unwrap_or(false);
        let result = if let Some(p) = self.process.as_ref().filter(|_| running) {
            p.rpc.call("stop_wallet", json!({})).map(|_| ())
        } else {
            Ok(())
        };
        self.process = None;
        result
    }
    pub fn snapshot(&self) -> Result<Value> {
        if self.wallet.is_none() {
            return Ok(
                json!({"locked":true,"wallets":self.wallets()?,"connection":self.connection}),
            );
        }
        let rpc = self.rpc()?;
        let accounts = rpc.call("get_accounts", json!({}))?;
        let accounts: Vec<Value> = accounts["subaddress_accounts"].as_array().ok_or("Missing accounts")?.iter().map(|a| json!({"index":a["account_index"],"label":a["label"],"address":a["base_address"],"balance":a["balance"].as_u64().unwrap_or(0).to_string(),"unlocked":a["unlocked_balance"].as_u64().unwrap_or(0).to_string()})).collect();
        let addresses = rpc.call("get_address", json!({"account_index":self.account}))?;
        let balance = rpc.call("get_balance", json!({"account_index":self.account}))?;
        let history=rpc.call("get_transfers",json!({"in":true,"out":true,"pending":true,"failed":true,"pool":self.last_sync.is_some() && self.connection.mode!="offline","account_index":self.account}))?;
        let height = rpc.call("get_height", json!({}))?;
        let balances: std::collections::HashMap<_, _> = balance["per_subaddress"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|b| b["address_index"].as_u64().map(|i| (i, b)))
            .collect();
        let mut rows = Vec::new();
        for a in addresses["addresses"]
            .as_array()
            .ok_or("Missing addresses")?
        {
            let index = a["address_index"].as_u64().unwrap_or(0);
            let b = balances.get(&index);
            rows.push(json!({"index":index,"address":a["address"],"label":a["label"],"used":a["used"],"balance":b.and_then(|b|b["balance"].as_u64()).unwrap_or(0).to_string(),"unlocked":b.and_then(|b|b["unlocked_balance"].as_u64()).unwrap_or(0).to_string()}));
        }
        let mut txs = Vec::new();
        for kind in ["in", "out", "pending", "failed", "pool"] {
            if let Some(ts) = history[kind].as_array() {
                for t in ts {
                    txs.push(json!({"id":t["txid"],"kind":kind,"amount":t["amount"].as_u64().unwrap_or(0).to_string(),"fee":t["fee"].as_u64().unwrap_or(0).to_string(),"timestamp":t["timestamp"],"confirmations":t["confirmations"],"height":t["height"],"address":t["address"],"subaddress":t["subaddr_index"]["minor"]}));
                }
            }
        }
        txs.sort_by(|a, b| b["timestamp"].as_u64().cmp(&a["timestamp"].as_u64()));
        Ok(
            json!({"locked":false,"wallet":self.wallet,"kind":self.kind(),"multisig":rpc.call("is_multisig",json!({}))?,"account":self.account,"accounts":accounts,"connection":self.connection,"balance":balance["balance"].as_u64().unwrap_or(0).to_string(),"unlocked":balance["unlocked_balance"].as_u64().unwrap_or(0).to_string(),"height":height["height"],"addresses":rows,"transactions":txs,"backedUp":self.backup,"lastSync":self.last_sync,"syncError":self.sync_error,"lastPayment":self.last_payment}),
        )
    }
    pub fn refresh(&mut self) -> Result<Value> {
        self.refresh_core()?;
        self.snapshot()
    }
    fn refresh_core(&mut self) -> Result<()> {
        self.unlocked()?;
        if self.connection.mode == "offline" {
            return Err("Offline mode: lock and change your connection to sync or send".into());
        }
        match self.rpc()?.call("refresh", json!({})) {
            Ok(_) => {
                self.last_sync = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(err)?
                        .as_secs(),
                );
                self.sync_error = None;
                self.rpc()?.call("store", json!({}))?;
                Ok(())
            }
            Err(e) => {
                self.last_sync = None;
                self.sync_error = Some(e.clone());
                Err(e)
            }
        }
    }
    pub fn address(&mut self, label: &str, index: Option<u32>) -> Result<Value> {
        self.unlocked()?;
        self.multisig_ready()?;
        label_ok(label)?;
        if let Some(i) = index {
            self.rpc()?.call(
                "label_address",
                json!({"index":{"major":self.account,"minor":i},"label":label}),
            )?;
        } else {
            self.rpc()?.call(
                "create_address",
                json!({"account_index":self.account,"label":label}),
            )?;
        }
        self.rpc()?.call("store", json!({}))?;
        self.snapshot()
    }
    pub fn prepare(
        &mut self,
        address: &str,
        amount: &str,
        priority: u32,
        source: Option<u32>,
    ) -> Result<Value> {
        self.prepare_with_sources(
            address,
            amount,
            priority,
            SourcePlan {
                indices: source.into_iter().collect(),
                ..SourcePlan::default()
            },
        )
    }
    pub fn cancel(&mut self) {
        self.pending = None;
    }
    pub fn send(&mut self, id: &str, password: String) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        let p = self
            .pending
            .as_ref()
            .ok_or("No payment is awaiting confirmation")?;
        p.matches(id)?;
        if p.expired(Instant::now()) {
            self.pending = None;
            return Err("Payment review expired. Review it again.".into());
        }
        // Consume before relay: an uncertain network response can never trigger an automatic repeat.
        let p = self.pending.take().unwrap();
        if ["unsigned", "multisig"].contains(&p.operation.as_str()) {
            return self.export(
                &p.operation,
                json!({"hex":p.metadata.as_str(),"summary":p.review}),
            );
        }
        if p.operation == "relay-batch" {
            return self.send_batch(p);
        }
        if p.operation != "relay" {
            return Err("Use the exchange confirmation for this review".into());
        }
        let txid = p.review["txid"].clone();
        let result = self
            .rpc()?
            .call("relay_tx", json!({"hex":p.metadata.as_str()}));
        match result {
            Ok(_) => {
                let saved = self.rpc()?.call("store", json!({})).is_ok();
                Ok(json!({"status":"sent","txid":txid,"saved":saved}))
            }
            Err(_) => Ok(
                json!({"status":"unknown","txid":txid,"message":"Relay response was uncertain. Sync and check this transaction ID before creating another payment."}),
            ),
        }
    }
    pub fn account(&mut self, index: Option<u32>, label: Option<&str>) -> Result<Value> {
        self.unlocked()?;
        self.pending = None;
        if let Some(label) = label {
            label_ok(label)?;
        }
        match (index, label) {
            (Some(index), label) => {
                let list = self.rpc()?.call("get_accounts", json!({}))?;
                if !list["subaddress_accounts"]
                    .as_array()
                    .ok_or("Missing accounts")?
                    .iter()
                    .any(|a| a["account_index"].as_u64() == Some(index as u64))
                {
                    return Err("Account does not exist".into());
                }
                if let Some(label) = label {
                    self.rpc()?.call(
                        "label_account",
                        json!({"account_index":index,"label":label}),
                    )?;
                }
                self.account = index;
            }
            (None, Some(label)) => {
                let a = self.rpc()?.call("create_account", json!({"label":label}))?;
                self.account = a["account_index"]
                    .as_u64()
                    .ok_or("Missing account index")?
                    .try_into()
                    .map_err(|_| "Account index overflow")?;
            }
            _ => return Err("Choose an account or enter a label".into()),
        }
        self.rpc()?.call("store", json!({}))?;
        self.snapshot()
    }
    pub fn confirm_vpn(&mut self, confirmed: bool) -> Result<()> {
        if self.wallet.is_some() || self.connection.mode != "vpn" || !confirmed {
            return Err(
                "Connect your trusted VPN, enable its kill switch, then confirm the VPN checkbox"
                    .into(),
            );
        }
        self.vpn_confirmed = true;
        Ok(())
    }
    pub fn confirm_direct(&mut self, confirmed: bool) -> Result<()> {
        if self.wallet.is_some() || self.connection.mode != "remote" || !confirmed {
            return Err(
                "Confirm that the public node may see your IP and request timing before connecting"
                    .into(),
            );
        }
        self.direct_confirmed = true;
        Ok(())
    }
    pub fn change_password(&mut self, old: String, new: String) -> Result<()> {
        let old = Zeroizing::new(old);
        let new = Zeroizing::new(new);
        self.verify(&old)?;
        if new.chars().count() < 12 || new.len() > 1024 {
            return Err("Use 12–1024 characters".into());
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(new.as_bytes(), &salt)
            .map_err(err)?
            .to_string();
        self.rpc()?.call(
            "change_wallet_password",
            json!({"old_password":old.as_str(),"new_password":new.as_str()}),
        )?;
        self.password_hash = Some(Zeroizing::new(hash));
        Ok(())
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.lock();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn idle_expiry_invalidates_once_and_requires_a_fresh_session() {
        let control = Control {
            child: Mutex::new(None),
            idle: Mutex::new(idle::IdleTimer::default()),
            epoch: AtomicU64::new(0),
            progress: Mutex::new(progress::Progress::default()),
        };
        control.idle.lock().unwrap().arm(Duration::ZERO);
        assert!(!control.expire_at(Duration::from_millis(299_999)));
        assert!(control.expire_at(Duration::from_secs(300)));
        assert_eq!(control.epoch(), 1);
        assert!(!control.session_active());
        assert!(!control.touch());
        assert!(!control.expire_at(Duration::from_secs(600)));
        assert!(control.activate(0).is_err());
        control.activate(1).unwrap();
        assert!(control.touch());
        control.cancel();
        assert!(!control.session_active());
    }
    #[test]
    fn review_lifetime_and_identity() {
        let t = Instant::now();
        let p = Pending {
            parts: Vec::new(),
            id: "one-review".into(),
            operation: "relay".into(),
            metadata: Zeroizing::new("private metadata".into()),
            review: json!({}),
            created: t,
        };
        assert!(p.matches("other-review").is_err());
        assert!(p.matches("one-review").is_ok());
        assert!(!p.expired(t + Duration::from_secs(119)));
        assert!(p.expired(t + Duration::from_secs(120)));
    }
    #[test]
    fn direct_route_requires_fresh_explicit_consent() {
        let d = tempfile::tempdir().unwrap();
        let mut e = Engine::new(d.path().join("wallet"), PathBuf::from("missing-engine")).unwrap();
        e.configure(Connection {
            mode: "remote".into(),
            node: "https://node.example".into(),
            ..Connection::default()
        })
        .unwrap();
        assert!(e.start().unwrap_err().contains("privacy notice"));
        assert!(e.confirm_direct(false).is_err());
        e.confirm_direct(true).unwrap();
        assert!(e.direct_confirmed);
        e.lock().unwrap();
        assert!(!e.direct_confirmed);
        e.confirm_direct(true).unwrap();
        e.configure(Connection {
            mode: "remote".into(),
            node: "https://another.example".into(),
            ..Connection::default()
        })
        .unwrap();
        assert!(!e.direct_confirmed);
    }
    #[test]
    fn vpn_needs_https_and_session_acknowledgement() {
        let mut c = Connection {
            mode: "vpn".into(),
            node: "https://node.example".into(),
            ..Connection::default()
        };
        assert!(c.validate().is_ok());
        c.node = "http://node.example".into();
        assert!(c.validate().is_err());
        c.node = format!("https://{}.onion", "a".repeat(56));
        assert!(c.validate().is_err());
        let d = tempfile::tempdir().unwrap();
        let mut e = Engine::new(d.path().join("wallet"), PathBuf::from("missing-engine")).unwrap();
        e.configure(Connection {
            mode: "vpn".into(),
            node: "https://node.example".into(),
            ..Connection::default()
        })
        .unwrap();
        assert!(e.start().unwrap_err().contains("Confirm your external VPN"));
        assert!(e.confirm_vpn(false).is_err());
        e.confirm_vpn(true).unwrap();
        assert!(e.vpn_confirmed);
        e.lock().unwrap();
        assert!(!e.vpn_confirmed);
    }
    #[test]
    fn exact_amounts() {
        assert_eq!(atomic("0.000000000001").unwrap(), 1);
        assert_eq!(atomic("18446744.073709551615").unwrap(), u64::MAX);
        for s in ["18446744.073709551616", "01", "1."] {
            assert!(atomic(s).is_err());
        }
        assert_eq!(atomic("9008.123456789012").unwrap(), 9008123456789012);
        for s in [
            "",
            "0",
            "-1",
            "+1",
            "1e3",
            "NaN",
            "1.0000000000001",
            "1.2.3",
            " 1",
            "18446745",
        ] {
            assert!(atomic(s).is_err(), "{s}");
        }
    }
    #[test]
    fn paths() {
        for s in ["../wallet", "/tmp/wallet", "a.keys", "a\n", ".", ""] {
            assert!(name_ok(s).is_err());
        }
        assert!(name_ok("Personal-1").is_ok());
    }
    #[test]
    fn privacy_connections() {
        let mut c = Connection::default();
        assert!(c.validate().is_ok());
        c.node = "http://example.com:18081".into();
        assert!(c.validate().is_err());
        c.mode = "remote".into();
        assert!(c.validate().is_err());
        c.node = "https://example.com:18081".into();
        assert!(c.validate().is_ok());
        c.mode = "tor".into();
        assert!(c.validate().is_err());
        c.node = format!("http://{}.onion:18081", "a".repeat(56));
        assert!(c.validate().is_ok());
        c.proxy = "8.8.8.8:9050".into();
        assert!(c.validate().is_err());
    }
}
