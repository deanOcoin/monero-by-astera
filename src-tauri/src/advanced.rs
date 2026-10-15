use super::*;
use std::io::Read;
use std::str::FromStr;
const MAX_PACKET: u64 = 16 * 1024 * 1024;
fn field<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v[k].as_str().ok_or(format!("Missing {k}"))
}
fn checked_file_name(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 180
        || s.starts_with('.')
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err("Choose a file from the exchange folder".into());
    }
    Ok(())
}
impl Engine {
    pub(super) fn multisig_ready(&self) -> Result<()> {
        if self.kind() == "multisig" && self.rpc()?.call("is_multisig", json!({}))?["ready"] != true
        {
            return Err("Finish multisig setup before using the shared wallet".into());
        }
        Ok(())
    }
    pub fn kind(&self) -> String {
        if let Ok(cache) = self.kind_cache.lock() {
            if let Some(kind) = cache.as_ref() {
                return kind.clone();
            }
        }
        let kind = self
            .rpc()
            .and_then(|r| r.call("get_attribute", json!({"key":"astra.kind"})))
            .ok()
            .and_then(|v| v["value"].as_str().map(str::to_owned));
        if let (Some(kind), Ok(mut cache)) = (kind.as_ref(), self.kind_cache.lock()) {
            *cache = Some(kind.clone());
        }
        kind.unwrap_or_else(|| "software".into())
    }
    fn attribute(&self, key: &str, value: &str) -> Result<()> {
        if key == "astra.kind" {
            if let Ok(mut cache) = self.kind_cache.lock() {
                *cache = None;
            }
        }
        self.rpc()?
            .call("set_attribute", json!({"key":key,"value":value}))?;
        self.rpc()?.call("store", json!({}))?;
        Ok(())
    }
    fn creation_check(&self, name: &str, password: &str) -> Result<()> {
        name_ok(name)?;
        if self.wallet.is_some() {
            return Err("Lock the current wallet first".into());
        }
        if password.chars().count() < 12 || password.len() > 1024 {
            return Err("Use a wallet password of 12–1024 characters".into());
        }
        let dir = self.root.join(&self.connection.network);
        private_dir(&dir)?;
        for suffix in ["", ".keys", ".address.txt"] {
            if dir.join(format!("{name}{suffix}")).exists() {
                return Err("A wallet with that name already exists".into());
            }
        }
        Ok(())
    }
    fn activate_password(&mut self, name: &str, password: &str, kind: &str) -> Result<Value> {
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(err)?
            .to_string();
        self.activate(name, hash, false, false)?;
        self.attribute("astra.kind", kind)?;
        if kind == "watch" || kind == "hardware" {
            self.attribute("astra.backup", "yes")?;
            self.backup = true;
        }
        self.snapshot()
    }
    pub fn restore_polyseed(
        &mut self,
        name: &str,
        password: String,
        phrase: String,
        passphrase: String,
        height: u64,
    ) -> Result<Value> {
        let password = Zeroizing::new(password);
        let phrase = Zeroizing::new(phrase);
        let passphrase = Zeroizing::new(passphrase);
        self.creation_check(name, &password)?;
        let recovered = polyseed::recover(&phrase, &passphrase, &self.connection.network)?;
        self.start()?;
        self.rpc()?.call("generate_from_keys",json!({"filename":name,"password":password.as_str(),"address":recovered.address,"spendkey":recovered.spend.as_str(),"viewkey":recovered.view.as_str(),"restore_height":height,"language":"English","autosave_current":true}))?;
        self.activate_password(name, &password, "software")?;
        self.attribute("astra.polyseed_birthday", &recovered.birthday.to_string())?;
        // Monero stores the derived keys. Its standard 25-word phrase also restores this wallet.
        self.attribute("astra.backup", "yes")?;
        self.backup = true;
        self.snapshot()
    }
    pub fn exchange_dir(&self) -> Result<PathBuf> {
        let p = self.root.join("exchange");
        private_dir(&p)?;
        Ok(p)
    }
    pub fn exchange_files(&self) -> Result<Value> {
        let p = self.exchange_dir()?;
        let mut rows = Vec::new();
        for e in fs::read_dir(&p).map_err(err)?.flatten() {
            if e.file_type().map_err(err)?.is_file() {
                let name = e.file_name().to_string_lossy().to_string();
                if checked_file_name(&name).is_ok() && name.ends_with(".json") {
                    rows.push(name);
                }
            }
        }
        rows.sort();
        Ok(json!({"directory":p,"files":rows}))
    }
    fn read_exchange(&self, name: &str, limit: u64) -> Result<Zeroizing<Vec<u8>>> {
        checked_file_name(name)?;
        let path = self.exchange_dir()?.join(name);
        // O_NOFOLLOW closes the check/open symlink race; never accept devices, pipes or directories.
        let f = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| "Cannot open exchange file")?;
        let meta = f.metadata().map_err(err)?;
        if !meta.is_file() || meta.len() > limit {
            return Err("Exchange file is not a regular file or is too large".into());
        }
        let mut bytes = Zeroizing::new(Vec::new());
        f.take(limit + 1).read_to_end(&mut bytes).map_err(err)?;
        if bytes.len() as u64 > limit {
            return Err("Exchange file is too large".into());
        }
        Ok(bytes)
    }
    fn packet(&self, name: &str, kind: &str, match_wallet: bool) -> Result<Value> {
        let bytes = self.read_exchange(name, MAX_PACKET)?;
        self.parse_packet(&bytes, kind, match_wallet)
    }
    fn parse_packet(&self, bytes: &[u8], kind: &str, match_wallet: bool) -> Result<Value> {
        let v: Value =
            serde_json::from_slice(bytes).map_err(|_| "Invalid Monero by Astera exchange file")?;
        if v["format"] != "astra-exchange-1"
            || v["kind"] != kind
            || v["network"] != self.connection.network
        {
            return Err("Wrong exchange file type or Monero network".into());
        }
        if match_wallet && v["wallet"] != self.primary()? {
            return Err("Exchange file belongs to a different wallet".into());
        }
        Ok(v)
    }
    fn primary(&self) -> Result<String> {
        Ok(field(
            &self
                .rpc()?
                .call("get_address", json!({"account_index":0}))?,
            "address",
        )?
        .into())
    }
    pub(super) fn export(&self, kind: &str, data: Value) -> Result<Value> {
        self.unlocked()?;
        let bytes=Zeroizing::new(serde_json::to_vec_pretty(&json!({"format":"astra-exchange-1","kind":kind,"network":self.connection.network,"wallet":self.primary()?,"data":data})).map_err(err)?);
        if bytes.len() as u64 > MAX_PACKET {
            return Err(
                "Exchange exceeds 16 MB; use the official wallet for this large wallet".into(),
            );
        }
        let name = format!("{}-{}-{kind}.json", now(), &random()[..12]);
        private_write(&self.exchange_dir()?.join(&name), &bytes)?;
        Ok(
            json!({"status":"exported","file":name,"fingerprint":format!("{:x}",Sha256::digest(&bytes))}),
        )
    }
    pub fn create_watch(&mut self, name: &str, password: String, file: &str) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.creation_check(name, &password)?;
        let p = self.packet(file, "watch", false)?;
        let data = &p["data"];
        if p["wallet"] != data["address"] {
            return Err("Watch packet wallet identity does not match".into());
        }
        let address = monero::Address::from_str(field(data, "address")?)
            .map_err(|_| "Invalid primary address")?;
        let key = monero::PrivateKey::from_str(field(data, "viewkey")?)
            .map_err(|_| "Invalid view key")?;
        if address.public_view != monero::PublicKey::from_private_key(&key)
            || !matches!(
                address.addr_type,
                monero::util::address::AddressType::Standard
            )
        {
            return Err("View key does not match the primary address".into());
        }
        self.start()?;
        self.rpc()?.call("generate_from_keys",json!({"filename":name,"password":password.as_str(),"address":data["address"],"viewkey":data["viewkey"],"restore_height":0,"autosave_current":true}))?;
        self.activate_password(name, &password, "watch")
    }
    pub fn backup_files(&mut self, password: String) -> Result<Value> {
        self.multisig_ready()?;
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        self.rpc()?.call("store", json!({}))?;
        let name = self.wallet.as_ref().ok_or("Wallet is locked")?;
        let prefix = format!("{}-{}-backup", now(), &random()[..12]);
        let dir = self.exchange_dir()?;
        let mut names = Vec::new();
        let mut hashes = Vec::new();
        for (suffix, ext) in [(".keys", "keys"), ("", "cache")] {
            let source = self
                .root
                .join(&self.connection.network)
                .join(format!("{name}{suffix}"));
            let file = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(source)
                .map_err(err)?;
            if !file.metadata().map_err(err)?.is_file() {
                return Err("Invalid wallet file".into());
            }
            let output = format!("{prefix}.{ext}");
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(dir.join(&output))
                .map_err(err)?;
            let mut input = &file;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = input.read(&mut buffer).map_err(err)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
                out.write_all(&buffer[..n]).map_err(err)?;
            }
            hashes.push(format!("{:x}", hash.finalize()));
            out.sync_all().map_err(err)?;
            names.push(output);
        }
        let result = self.export(
            "backup",
            json!({"keys":names[0],"cache":names[1],"keysHash":hashes[0],"cacheHash":hashes[1],"kind":self.kind()}),
        )?;
        // File backups are especially necessary for multisig. Original pre-multisig words cannot restore the resulting wallet.
        self.attribute("astra.backup", "yes")?;
        self.backup = true;
        Ok(result)
    }
    pub fn restore_backup(&mut self, name: &str, password: String, file: &str) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.creation_check(name, &password)?;
        let packet = self.packet(file, "backup", false)?;
        let keys = self.read_exchange(field(&packet["data"], "keys")?, 4 * 1024 * 1024)?;
        let cache = self.read_exchange(field(&packet["data"], "cache")?, 128 * 1024 * 1024)?;
        if packet["data"]["keysHash"] != format!("{:x}", Sha256::digest(&keys))
            || packet["data"]["cacheHash"] != format!("{:x}", Sha256::digest(&cache))
        {
            return Err("Backup checksum mismatch. Copy the original manifest, keys and cache together again.".into());
        }
        let dir = self.root.join(&self.connection.network);
        private_write(&dir.join(format!("{name}.keys")), &keys)?;
        private_write(&dir.join(name), &cache)?;
        let result = self
            .open(name, password.to_string(), None, 0, false)
            .and_then(|snapshot| {
                if self.primary()? != field(&packet, "wallet")? {
                    return Err(
                        "Restored wallet identity does not match its backup manifest".into(),
                    );
                }
                Ok(snapshot)
            });
        if result.is_err() {
            let _ = self.lock();
            let _ = fs::remove_file(dir.join(format!("{name}.keys")));
            let _ = fs::remove_file(dir.join(name));
        }
        result
    }
}
struct SecretFile(PathBuf);
impl Drop for SecretFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
impl Engine {
    pub fn create_hardware(
        &mut self,
        name: &str,
        password: String,
        device: &str,
        height: u64,
        backed_up: bool,
    ) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.creation_check(name, &password)?;
        if !backed_up {
            return Err(
                "Confirm that you have backed up the hardware device before proceeding".into(),
            );
        }
        if !["Ledger", "Trezor"].contains(&device) {
            return Err("Unsupported hardware device".into());
        }
        if password.contains(['\n', '\r']) {
            return Err("Hardware wallet passwords cannot contain newlines".into());
        }
        let cli = self.binary.with_file_name("monero-wallet-cli");
        if format!(
            "{:x}",
            Sha256::digest(fs::read(&cli).map_err(|_| "Bundled hardware helper is missing")?)
        ) != include_str!("../resources/cli.sha256").trim()
        {
            return Err("Hardware helper integrity check failed".into());
        }
        let staging = self.root.join(format!("hardware-{}", random()));
        private_dir(&staging)?;
        let password_file = SecretFile(staging.join("password"));
        private_write(&password_file.0, password.as_bytes())?;
        let guardian = self
            .guardian
            .as_ref()
            .ok_or("Hardware setup requires the native application supervisor")?;
        let mut cmd = Command::new(guardian);
        cmd.arg("--guard-wallet-engine")
            .arg(cli)
            .args(["--generate-from-device"])
            .arg(staging.join(name))
            .args(["--hw-device", device, "--password-file"])
            .arg(&password_file.0)
            .args([
                "--restore-height",
                &height.to_string(),
                "--offline",
                "--daemon-ssl",
                "disabled",
                "--no-dns",
                "--log-file",
                "/dev/null",
                "--log-level",
                "0",
                "--command",
                "exit",
                "--shared-ringdb-dir",
            ])
            .arg(staging.join("rings"))
            .current_dir(&staging)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        if self.connection.network != "mainnet" {
            cmd.arg(format!("--{}", self.connection.network));
        }
        self.control.touch();
        *self
            .control
            .child
            .lock()
            .map_err(|_| "Engine control unavailable")? = Some(cmd.spawn().map_err(err)?);
        let deadline = Instant::now() + Duration::from_secs(120);
        let result = loop {
            let status = {
                let mut c = self
                    .control
                    .child
                    .lock()
                    .map_err(|_| "Engine control unavailable")?;
                match c.as_mut() {
                    Some(child) => child.try_wait().map_err(err)?,
                    None => break Err("Hardware setup canceled or wallet locked".to_string()),
                }
            };
            if let Some(status) = status {
                self.control
                    .child
                    .lock()
                    .map_err(|_| "Engine control unavailable")?
                    .take();
                break if status.success() {
                    Ok(())
                } else {
                    Err("Device setup failed. Unlock your device, open its Monero app, and approve prompts on the device. Trezor models requiring host PIN/passphrase entry may need initial setup in the official Monero GUI.".into())
                };
            }
            if Instant::now() >= deadline {
                self.control.interrupt();
                break Err("Device setup timed out. No network connection was made.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        drop(password_file);
        result?;
        if !staging.join(format!("{name}.keys")).is_file() {
            return Err(
                "The device did not create a wallet. Check the device and try again.".into(),
            );
        }
        let dir = self.root.join(&self.connection.network);
        for suffix in [".keys", ""] {
            fs::rename(
                staging.join(format!("{name}{suffix}")),
                dir.join(format!("{name}{suffix}")),
            )
            .map_err(err)?;
        }
        if let Err(error) = self.open(name, password.to_string(), None, 0, false) {
            let _ = self.lock();
            for suffix in [".keys", ""] {
                let _ = fs::rename(
                    dir.join(format!("{name}{suffix}")),
                    staging.join(format!("{name}{suffix}")),
                );
            }
            return Err(error);
        }
        self.attribute("astra.kind", "hardware")?;
        self.attribute("astra.backup", "yes")?;
        self.backup = true;
        self.snapshot()
    }
}
impl Engine {
    pub fn exchange_operation(
        &mut self,
        operation: &str,
        files: Vec<String>,
        password: String,
    ) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        if files.len() > 8 {
            return Err("Too many exchange files".into());
        }
        let single = || {
            files
                .first()
                .map(String::as_str)
                .ok_or("Select an exchange file".to_string())
        };
        let result = match operation {
            "export-watch" => {
                if self.kind() != "software" {
                    return Err("Create a watch-only companion from a software wallet".into());
                }
                let view = self
                    .rpc()?
                    .call("query_key", json!({"key_type":"view_key"}))?;
                return self.export(
                    "watch",
                    json!({"address":self.primary()?,"viewkey":view["key"]}),
                );
            }
            "export-outputs" => {
                return self.export(
                    "outputs",
                    self.rpc()?.call("export_outputs", json!({"all":true}))?,
                )
            }
            "import-outputs" => {
                if self.connection.mode != "offline" {
                    return Err("Open the signer in Offline mode before importing outputs".into());
                }
                let p = self.packet(single()?, "outputs", true)?;
                self.rpc()?.call(
                    "import_outputs",
                    json!({"outputs_data_hex":p["data"]["outputs_data_hex"]}),
                )?
            }
            "export-images" => {
                return self.export(
                    "images",
                    self.rpc()?.call("export_key_images", json!({"all":true}))?,
                )
            }
            "import-images" => {
                if self.connection.mode != "trusted-local" {
                    return Err("Key-image import requires your own trusted local node. Lock and select Trusted local node in Connection settings.".into());
                }
                let p = self.packet(single()?, "images", true)?;
                self.rpc()?.call("import_key_images", p["data"].clone())?
            }
            "export-multisig-info" => {
                return self.export(
                    "multisig-info",
                    self.rpc()?.call("export_multisig_info", json!({}))?,
                )
            }
            "import-multisig-info" => {
                if self.connection.mode == "offline" {
                    return Err("Connect and sync this multisig participant to import output information; you can switch offline again before signing".into());
                }
                let mut info = Vec::new();
                for file in files {
                    let p = self.packet(&file, "multisig-info", true)?;
                    info.push(field(&p["data"], "info")?.to_string());
                }
                if info.is_empty() {
                    return Err("Select the other participants' sync files".into());
                }
                self.rpc()?.call(
                    "import_multisig_info",
                    json!({"info":info,"refresh_after_import":false}),
                )?
            }
            _ => return Err("Unsupported exchange operation".into()),
        };
        if operation == "import-multisig-info" {
            self.refresh()?;
        }
        self.rpc()?.call("store", json!({}))?;
        Ok(json!({"status":"imported","result":result}))
    }
    fn describe(&self, hex: &str, multisig: bool) -> Result<Value> {
        let params = if multisig {
            json!({"multisig_txset":hex})
        } else {
            json!({"unsigned_txset":hex})
        };
        let raw = self.rpc()?.call("describe_transfer", params)?;
        let items = raw["desc"]
            .as_array()
            .ok_or("Missing transaction descriptions")?;
        if items.is_empty() || items.len() > 16 {
            return Err("Unsupported transaction count".into());
        }
        let mut desc = Vec::new();
        for t in items {
            let number = |k: &str| t[k].as_u64().ok_or(format!("Invalid transaction {k}"));
            if number("unlock_time")? != 0 || number("ring_size")? < 16 {
                return Err(
                    "Refusing a transaction with a timelock or insufficient ring size".into(),
                );
            }
            let amount_in = number("amount_in")?;
            let amount_out = number("amount_out")?;
            let change = number("change_amount")?;
            let fee = number("fee")?;
            if amount_in.checked_sub(amount_out) != Some(fee) {
                return Err("Transaction fee does not reconcile".into());
            }
            if change > 0 {
                self.rpc()?
                    .call(
                        "get_address_index",
                        json!({"address":field(t,"change_address")?}),
                    )
                    .map_err(|_| "Change address does not belong to this wallet")?;
            }
            let recipients = t["recipients"].as_array().ok_or("Missing recipients")?;
            if recipients.is_empty() || recipients.len() > 64 {
                return Err("Unsupported recipient count".into());
            }
            let mut sum = 0u64;
            let mut rows = Vec::new();
            for r in recipients {
                let amount = r["amount"].as_u64().ok_or("Invalid recipient amount")?;
                sum = sum.checked_add(amount).ok_or("Amount overflow")?;
                rows.push(json!({"address":field(r,"address")?,"amount":amount.to_string()}));
            }
            if sum.checked_add(change) != Some(amount_out) {
                return Err("Transaction outputs do not reconcile".into());
            }
            desc.push(json!({"recipients":rows,"amount":sum.to_string(),"fee":fee.to_string(),"total":sum.checked_add(fee).ok_or("Amount overflow")?.to_string(),"change":change.to_string(),"changeAddress":t["change_address"],"ringSize":t["ring_size"],"paymentId":t["payment_id"]}));
        }
        Ok(
            json!({"transactions":desc,"intent":format!("{:x}",Sha256::digest(serde_json::to_vec(&raw).map_err(err)?))}),
        )
    }
    pub fn review_exchange(&mut self, operation: &str, file: &str) -> Result<Value> {
        self.unlocked()?;
        self.pending = None;
        let kind = match operation {
            "sign-offline" => "unsigned",
            "sign-multisig" | "broadcast-multisig" => "multisig",
            "broadcast-signed" => "signed",
            _ => return Err("Invalid signing operation".into()),
        };
        if operation == "sign-offline"
            && (self.connection.mode != "offline" || self.kind() != "software")
        {
            return Err("Offline signing requires a software wallet opened in Offline mode".into());
        }
        if operation.starts_with("broadcast") && self.connection.mode == "offline" {
            return Err("Choose an online connection before broadcasting".into());
        }
        if operation.starts_with("sign") && !self.backup {
            return Err("Complete the wallet backup before signing".into());
        }
        let packet_bytes = self.read_exchange(file, MAX_PACKET)?;
        let p = self.parse_packet(&packet_bytes, kind, true)?;
        let hex = field(&p["data"], "hex")?;
        if hex.is_empty()
            || !hex.len().is_multiple_of(2)
            || !hex.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid transaction data".into());
        }
        let fingerprint = format!("{:x}", Sha256::digest(packet_bytes.as_slice()));
        let descriptions = if operation == "broadcast-signed" {
            p["data"]["descriptions"].clone()
        } else {
            self.describe(hex, kind == "multisig")?
        };
        if !descriptions["transactions"].is_array() {
            return Err("Missing signed transaction summary".into());
        }
        validate_description(&descriptions)?;
        let intent = field(&descriptions, "intent")?;
        let replay_key = format!(
            "astra.{}.{}",
            if operation.starts_with("sign") {
                "signed"
            } else {
                "broadcast"
            },
            intent
        );
        if self
            .rpc()?
            .call("get_attribute", json!({"key":replay_key}))
            .is_ok()
        {
            return Err("This transaction was already approved on this wallet. Check its chain status; do not create a second payment to retry an uncertain response.".into());
        }
        let id = random();
        let review = json!({"id":id,"operation":operation,"descriptions":descriptions,"fingerprint":fingerprint,"network":self.connection.network,"expiresIn":120,"file":file});
        self.pending = Some(Pending {
            id,
            operation: operation.into(),
            metadata: Zeroizing::new(
                serde_json::to_string(&json!({"hex":hex,"replay":replay_key})).map_err(err)?,
            ),
            review: review.clone(),
            parts: Vec::new(),
            created: Instant::now(),
        });
        Ok(review)
    }
    pub fn confirm_exchange(
        &mut self,
        id: &str,
        password: String,
        fingerprint: &str,
    ) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        let p = self.pending.as_ref().ok_or("No transaction review")?;
        p.matches(id)?;
        if p.expired(Instant::now()) {
            self.pending = None;
            return Err("Review expired".into());
        }
        if ![
            "sign-offline",
            "sign-multisig",
            "broadcast-signed",
            "broadcast-multisig",
        ]
        .contains(&p.operation.as_str())
        {
            return Err("Wrong review type".into());
        }
        if p.operation == "broadcast-signed" && fingerprint != field(&p.review, "fingerprint")? {
            return Err(
                "Enter the full file fingerprint shown by your trusted offline signer".into(),
            );
        }
        let p = self.pending.take().unwrap();
        let data: Value = serde_json::from_str(&p.metadata).map_err(err)?;
        // Persist intent before signing/broadcast. An uncertain response never authorizes an automatic repeat.
        self.attribute(field(&data, "replay")?, "approved")?;
        let hex = field(&data, "hex")?;
        match p.operation.as_str() {
            "sign-offline" => {
                let signed = self
                    .rpc()?
                    .call("sign_transfer", json!({"unsigned_txset":hex}))?;
                self.rpc()?.call("store", json!({}))?;
                self.export("signed",json!({"hex":signed["signed_txset"],"hashes":signed["tx_hash_list"],"descriptions":p.review["descriptions"]}))
            }
            "sign-multisig" => {
                let signed = self
                    .rpc()?
                    .call("sign_multisig", json!({"tx_data_hex":hex}))?;
                self.rpc()?.call("store", json!({}))?;
                self.export(
                    "multisig",
                    json!({"hex":signed["tx_data_hex"],"hashes":signed["tx_hash_list"]}),
                )
            }
            op => {
                let result = self.rpc()?.call(
                    if op == "broadcast-signed" {
                        "submit_transfer"
                    } else {
                        "submit_multisig"
                    },
                    json!({"tx_data_hex":hex}),
                );
                match result {
                    Ok(v) => {
                        let saved = self.rpc()?.call("store", json!({})).is_ok();
                        Ok(json!({"status":"sent","txid":v["tx_hash_list"],"saved":saved}))
                    }
                    Err(_) => Ok(
                        json!({"status":"unknown","message":"Broadcast response uncertain or rejected. Check the chain and signature threshold before taking further action. This approval cannot be repeated automatically."}),
                    ),
                }
            }
        }
    }
    pub fn create_multisig(
        &mut self,
        name: &str,
        password: String,
        threshold: u32,
        total: u32,
    ) -> Result<Value> {
        if !(2..=5).contains(&total) || !(2..=total).contains(&threshold) {
            return Err("Choose 2–5 participants and a threshold between 2 and the total".into());
        }
        let password = Zeroizing::new(password);
        self.creation_check(name, &password)?;
        self.open(name, password.to_string(), None, 0, true)?;
        let info = self.rpc()?.call(
            "prepare_multisig",
            json!({"enable_multisig_experimental":true}),
        )?;
        self.attribute("astra.kind", "multisig")?;
        self.attribute("astra.backup", "no")?;
        self.backup = false;
        self.attribute("astra.multisig.total", &total.to_string())?;
        self.attribute("astra.multisig.threshold", &threshold.to_string())?;
        self.save_kex(field(&info, "multisig_info")?, 0, threshold, total)
    }
    fn save_kex(&self, info: &str, round: u32, threshold: u32, total: u32) -> Result<Value> {
        let data = json!({"info":info,"round":round,"threshold":threshold,"total":total});
        self.attribute("astra.kex", &serde_json::to_string(&data).map_err(err)?)?;
        self.export("multisig-setup", data)
    }
    pub fn multisig_step(&mut self, files: Vec<String>, password: String) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        let local = self
            .rpc()?
            .call("get_attribute", json!({"key":"astra.kex"}))?;
        let local: Value = serde_json::from_str(field(&local, "value")?).map_err(err)?;
        let total = local["total"].as_u64().ok_or("Missing participants")?;
        let threshold = local["threshold"].as_u64().ok_or("Missing threshold")?;
        let round = local["round"].as_u64().ok_or("Missing round")?;
        if files.len() as u64 != total - 1 {
            return Err(format!(
                "Choose exactly {} peer files for round {round}",
                total - 1
            ));
        }
        let mut info = Vec::new();
        for file in files {
            let p = self.packet(&file, "multisig-setup", false)?;
            let d = &p["data"];
            if d["total"] != total || d["threshold"] != threshold || d["round"] != round {
                return Err(
                    "Peer file has the wrong threshold, participant count or exchange round".into(),
                );
            }
            let i = field(d, "info")?.to_string();
            if local["info"] == i || info.contains(&i) {
                return Err("Choose distinct files from the other participants".into());
            }
            info.push(i);
        }
        let status = self.rpc()?.call("is_multisig", json!({}))?;
        if status["ready"] == true {
            return Err("Multisig setup is already complete".into());
        }
        let result = if status["multisig"] == true {
            self.rpc()?.call(
                "exchange_multisig_keys",
                json!({"password":password.as_str(),"multisig_info":info}),
            )?
        } else {
            self.rpc()?.call(
                "make_multisig",
                json!({"password":password.as_str(),"multisig_info":info,"threshold":threshold}),
            )?
        };
        self.rpc()?.call("store", json!({}))?;
        let export = self.save_kex(
            result["multisig_info"].as_str().unwrap_or(""),
            (round + 1) as u32,
            threshold as u32,
            total as u32,
        )?;
        Ok(
            json!({"status":"exported","file":export["file"],"fingerprint":export["fingerprint"],"multisig":self.rpc()?.call("is_multisig",json!({}))?}),
        )
    }
    pub fn export_kex(&self, password: String) -> Result<Value> {
        let password = Zeroizing::new(password);
        self.verify(&password)?;
        let v = self
            .rpc()?
            .call("get_attribute", json!({"key":"astra.kex"}))?;
        self.export(
            "multisig-setup",
            serde_json::from_str(field(&v, "value")?).map_err(err)?,
        )
    }
}

fn validate_description(value: &Value) -> Result<()> {
    let intent = field(value, "intent")?;
    if intent.len() != 64 || !intent.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid transaction intent fingerprint".into());
    }
    let txs = value["transactions"]
        .as_array()
        .ok_or("Missing transactions")?;
    if txs.is_empty() || txs.len() > 16 {
        return Err("Invalid transaction count".into());
    }
    for tx in txs {
        let money = |key: &str| -> Result<u64> {
            let s = field(tx, key)?;
            if s.len() > 20 || s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                return Err("Invalid transaction amount".into());
            }
            s.parse().map_err(|_| "Invalid transaction amount".into())
        };
        let fee = money("fee")?;
        let total = money("total")?;
        money("change")?;
        let recipients = tx["recipients"].as_array().ok_or("Missing recipients")?;
        if recipients.is_empty() || recipients.len() > 64 {
            return Err("Invalid recipient count".into());
        }
        let mut sum = 0u64;
        for r in recipients {
            let address = field(r, "address")?;
            if ![95, 106].contains(&address.len())
                || !address.bytes().all(|b| b.is_ascii_alphanumeric())
            {
                return Err("Invalid recipient address".into());
            }
            let s = field(r, "amount")?;
            if s.len() > 20 || s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                return Err("Invalid recipient amount".into());
            }
            let amount: u64 = s.parse().map_err(|_| "Invalid recipient amount")?;
            sum = sum.checked_add(amount).ok_or("Amount overflow")?;
        }
        if sum.checked_add(fee) != Some(total) {
            return Err("Signed summary totals do not reconcile".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exchange_input_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::new(
            dir.path().join("wallet"),
            dir.path().join("monero-wallet-rpc"),
        )
        .unwrap();
        let p = e.exchange_dir().unwrap();
        fs::write(
            p.join("wrong.json"),
            br#"{"format":"astra-exchange-1","kind":"unsigned","network":"testnet"}"#,
        )
        .unwrap();
        assert!(e.packet("wrong.json", "unsigned", false).is_err());
        let f = File::create(p.join("large.json")).unwrap();
        f.set_len(MAX_PACKET + 1).unwrap();
        assert!(e.read_exchange("large.json", MAX_PACKET).is_err());
        let fifo = std::ffi::CString::new(p.join("pipe.json").to_str().unwrap()).unwrap();
        unsafe { assert_eq!(libc::mkfifo(fifo.as_ptr(), 0o600), 0) };
        assert!(e.read_exchange("pipe.json", MAX_PACKET).is_err());
        assert!(e.read_exchange("../wrong.json", MAX_PACKET).is_err());
    }
    #[test]
    fn hardware_integrity_and_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("monero-wallet-rpc");
        fs::write(
            binary.with_file_name("monero-wallet-cli"),
            b"modified helper",
        )
        .unwrap();
        let mut e = Engine::new(dir.path().join("wallet"), binary).unwrap();
        assert!(e
            .create_hardware("device", "long test password".into(), "Ledger", 0, true)
            .unwrap_err()
            .contains("integrity"));
        assert!(e.wallets().unwrap().is_empty());
        e.control.cancel();
        assert!(e.start().unwrap_err().contains("canceled"));
        assert!(e.begin_operation(0).is_err());
        e.begin_operation(e.control.epoch()).unwrap();
    }
    #[test]
    fn signed_summary_rejects_malformed_amounts() {
        let mut v = json!({"intent":"a".repeat(64),"transactions":[{"fee":"1","total":"3","change":"0","recipients":[{"address":format!("4{}","A".repeat(94)),"amount":"2"}]}]});
        assert!(validate_description(&v).is_ok());
        v["transactions"][0]["recipients"][0]["amount"] = json!("1e3");
        assert!(validate_description(&v).is_err());
        v["transactions"][0]["recipients"][0]["amount"] = json!("18446744073709551615");
        assert!(validate_description(&v).is_err());
    }
}
