# Security model

Monero by Astera is a local desktop wallet with software, hardware, watch-only and multisig workflows. It has automated tests and an implementation review, but no independent security audit. Do not store substantial value until it has been independently reviewed and exercised further.

## Boundaries

The frontend is a bundled Tauri webview with no remote content, network plugin, shell plugin, filesystem plugin or generic RPC bridge. Its content security policy permits only local application assets and Tauri IPC. Values from wallet labels, RPC errors and settings are escaped before HTML insertion. QR generation is local. Manrope and Outfit fonts are bundled local assets; the interface does not contact a font provider. The startup guide performs no networking and does not grant route consent. Its visibility preference is stored locally, independently of wallet connection settings.

A Rust command allowlist validates inputs and controls the official `monero-wallet-rpc` process. The process listens on a random IPv4 loopback port and requires HTTP Digest authentication with a fresh 256-bit random password. The password is passed in a private, temporary config file, removed after startup; wallet passwords and recovery seeds are never command-line arguments. Even the first unauthenticated challenge request contains only `get_version`, never wallet secrets. No generic wallet method or arbitrary executable path is exposed to the UI.

The downloaded archive's SHA-256 was checked against binaryFate's signed manifest, using fingerprint `81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92`. The executable SHA-256 is embedded at compile time and checked before every process launch. This detects accidental or isolated executable modification, not an attacker capable of replacing the entire application. The local app is ad-hoc signed, not notarized or reproducibly built.

The official Monero engine owns normal seed generation, wallet encryption, address validation, transaction construction and signing. Polyseed recovery additionally uses the upstream Polyseed library and established Rust cryptographic dependencies described below. Amounts are converted from decimal strings to checked `u64` atomic units in Rust and carried as strings to JavaScript. The UI uses `BigInt`, not floating point.

Before sending, the backend refreshes the wallet, validates the address checksum and network with OpenAlias disabled, and creates a signed transaction with `do_not_relay`. Only its review fields reach the frontend. The metadata stays in backend memory, expires after 120 seconds and can be relayed once after password verification. The draft is consumed before relay. An ambiguous response is reported as unknown with the transaction ID, and never automatically retried. Check the chain/history before creating another payment after uncertainty.

The wallet password is not intentionally retained by the application after unlock. An Argon2 verifier with a fresh random salt is held in backend memory for sensitive-action authentication. The official engine necessarily holds wallet secrets while unlocked. Rust secret strings use zeroizing wrappers where practical, but JSON libraries, network buffers, allocator copies and the webview prevent a guarantee of complete memory erasure. Recovery words are briefly present in the webview when requested; they are never copied automatically, written to frontend storage or sent to an external service.

Locking stops the key-holding subprocess and drops backend session state. A separate control path can kill a process blocked on a node request. A backend idle watchdog enforces five full minutes without wallet interaction independently of frontend refreshes. Switching apps leaves the session open; Escape dismisses a dialog. Explicit lock, ⌘L, close and quit still end the session. Exposed recovery words close on blur. Abrupt termination may discard the last in-progress cache update; the encrypted keys and recovery seed remain the recovery source. Operations store after successful wallet mutations. A small native guardian holds the engine and watches a liveness pipe from the UI. If the UI crashes or is killed, EOF closes the engine; lock also has a bounded process-group termination fallback. An attacker able to kill or suspend the guardian separately remains outside this protection.

## Network privacy

No third-party node is contacted by default. A node URL must be supplied or the user must already have a local node. Direct remote mode requires HTTPS, certificate validation stays enabled, and redirects/remote content are not handled by the frontend. Nodes are treated as untrusted except when the user explicitly selects Trusted local node; that mode is limited to loopback hosts.

Tor mode requires an onion destination and a loopback SOCKS proxy and passes it to Monero's native proxy support. Monero's `--no-dns` is enabled; OpenAlias is disabled. There is no direct-connection fallback. Tor itself is external to this application. This is transport configuration, not a promise of anonymity; timing correlation, node misbehavior, transaction patterns and an infected machine remain risks.

## Files and disclosure limits

Application directories are mode 0700; temporary authentication and configuration files are mode 0600. Monero encrypts wallet keys and its wallet cache. Wallet names, network selection, connection URL, the engine’s test-network public-address text files, application installation and filesystem activity are observable locally. No hidden directories, operating-system evasion or deceptive concealment are implemented. OS indexing, backups, swap, crash dumps, local administrator access and cloud backup settings are outside this wallet's control.

The app requests macOS screen capture protection, which may be bypassed or unsupported by capture methods. Hiding balances is a presentation convenience, not encryption. Clipboard clearing cannot retract a copy saved by a clipboard manager or another application. The OS, browser engine and official Monero engine remain trusted components.

## Further review required

- Independent review of IPC, transaction confirmation, exception paths and process lifecycle.
- Fuzzing node/RPC responses, hostile local applications and interruption timing.
- Real Tor/onion operation and packet-level DNS/fallback verification.
- Public stagenet testing and small-value mainnet acceptance testing.
- Recovery of wallets with many subaddresses and large transaction histories.
- Notarization, distribution signing, reproducible builds and an authenticated update process.

Do not paste wallet seeds, passwords, private keys or transaction metadata into issues or bug reports. Reproduce reports with disposable test wallets.

## Advanced wallet boundaries

Software wallets used online hold spend keys on the Mac; watch-only companions do not. Hardware devices and offline signers move signing to their respective trusted devices. Polyseed recovery is an additional key-derivation path: the unmodified upstream C library at the commit in `src-tauri/vendor/polyseed/UPSTREAM_COMMIT` validates/decodes phrases; RustCrypto PBKDF2/SHA-256, Unicode normalization, curve25519-dalek and rust-monero provide its dependencies and Monero key/address conversion. The C ABI is narrowly wrapped, lengths are bounded before normalization, unsupported features fail closed, and owned key material is wiped where practical. Tests cross-check a separate Python/hashlib PBKDF2 binding, encrypted phrases and real engine recovery.

Both bundled Monero executables (wallet RPC and CLI) have separate embedded SHA-256 pins from the same signature-verified official archive. The CLI is used only for hardware setup, starts offline under the guardian and has no arbitrary executable/argument bridge. Device setup uses an owner-only temporary password file, removed on completion/failure; stale credential files are removed after the next startup obtains the exclusive app lock. Abrupt OS termination can leave that temporary file until the next launch. Passwords and seeds are never process arguments. Device signing and host PIN/passphrase variants remain unverified without physical hardware.

A cancellation epoch now invalidates queued work and is checked before launching another engine. Explicit lock, window close and the idle watchdog advance the epoch, so a multi-step setup cannot reopen keys after a lock request. Failed open/create/restore operations clean up backend session state. The guardian also exits promptly when its child exits, while retaining EOF cleanup on UI death. Clipboard leases serialize copies and expiry; a repeated copy resets expiry, and lock/normal exit conditionally clears the tracked value.

There is one explicit exception to untrusted-daemon mode: Trusted local node mode permits only a loopback host and enables Monero commands needed for watch-only key-image import. HTTPS remote/Tor/VPN modes remain untrusted. Tor destinations must be full v3 onion hostnames. Failure prompts never change transport automatically. VPN mode uses macOS routing and requires a fresh user acknowledgement for each wallet session; it is not a VPN detector, traffic binder or kill switch.

Exchange operations use a fixed private directory, filename validation, O_NOFOLLOW/O_NONBLOCK, regular-file checks and bounded reads. Packet types, network and primary wallet identity are checked. Metadata is not treated as executable instructions. Watch packets contain a private view key; key-image/transaction/backup manifests can disclose metadata. The directory permissions protect against other ordinary users, not malware running as the wallet user. Wallet backup key/cache files retain Monero encryption. A seed does not recover local labels or final multisig participant state.

Offline and multisig signers use Monero's describe_transfer before approval. The backend verifies amount/fee reconciliation, change ownership, no timelock and ring size >=16. Descriptions sent to the renderer use integer strings. A normal signed set cannot be described by this RPC version: its online summary is accepted only after the user supplies the complete SHA-256 fingerprint obtained independently from the trusted offline signer. This out-of-band verification is part of the security boundary. A malicious online computer can still lie through its UI; keep spend keys and final review on the trusted signing device.

Sign/broadcast approvals expire in 120 seconds, are consumed before use, and are recorded in encrypted wallet attributes before the operation. An uncertain response never triggers an automatic retry. This local intent ledger is not a consensus rule and does not survive restoration of an older wallet cache. It cannot prevent people approving separate malicious payments. Monero enforces spend validity and multisig thresholds; multisig remains upstream-experimental. Setup uses newly created participants, and normal receive/send screens are withheld until setup and a local encrypted backup are complete.

Transaction review hashes and parses one bounded read of the same file bytes, then retains those bytes in the backend. Later replacement of the source file cannot change the approved transaction. Encrypted wallet backups include streaming SHA-256 checksums for both key/cache files and verify the restored primary address against the manifest. Restore limits are 4 MiB for keys and 128 MiB for cache; larger recovery workflows require the official wallet.

## Product rename and compatibility

The displayed product, macOS bundle name, window/menu title and executable are Monero by Astera. The existing bundle/storage identifier `local.astra.xmr`, encrypted wallet attribute names and `astra-exchange-1` file format remain stable compatibility identifiers. This preserves existing wallets, settings, backup verification and approval history without a funded-wallet migration. These identifiers are not product branding.

## Inactivity timer — 0.2.1

A single backend timer owns the unlocked session. macOS mach_continuous_time provides monotonic elapsed time including system sleep, avoiding wall-clock changes. Trusted browser input (keys, pointer movement/clicks, wheel and input events) reports activity with a trailing update after an input burst. These reports bypass the engine mutex, so a slow sync cannot make genuine activity wait behind RPC. Background commands and automatic UI updates are not keepalives. Native focus gain counts as returning to the wallet; focus loss does not lock it.

At five minutes, the backend invalidates the session and queued operations, terminates the engine, clears the tracked clipboard value and emits a lock event. A late activity report cannot revive an expired session. Timeout cleanup checks for a fresh explicit unlock before clearing engine state, avoiding a stale timeout closing a newly opened session. The watchdog checks once per second; engine shutdown can add its bounded cleanup interval.

## Connection repair and diagnostics — 0.2.2

Direct HTTPS now requires a fresh explicit acknowledgement before the backend can launch the wallet engine. The equivalent VPN acknowledgement remains required. Both reset on lock or connection change, including advanced setup. Choosing presets or saving configuration sends no network request. Diagnostics require the same route consent before checking a public endpoint. Tor diagnostic requests use SOCKS5h with proxy-side hostname resolution, and no environmental HTTP proxy, redirects, direct fallback or TLS bypass is permitted.

The bundled Monero engine rejects forced TLS without explicit trust material. Its user-CA certificate mode also omits hostname checks. Accordingly, this app first validates the chain and hostname using Reqwest/Rustls and obtains the authenticated leaf certificate from the response TLS metadata. Monero then requires the SHA-256 fingerprint of that exact certificate. This is not trust-on-first-use, an allow-any-certificate option, or acceptance of arbitrary user-provided fingerprints. Certificate changes require fresh validation on reopening. The prerequisite request contains no wallet address, keys or transaction metadata. The validated node must report the selected network; node-reported health/height still cannot establish operator honesty.

Node diagnostics read at most 128 KiB, use 8-second connection / 15-second total timeouts, reject redirects, and treat offline/syncing or wrong-network reports separately. The main wallet scan can wait up to 30 minutes for a response while explicit locking and the five-minute inactivity watchdog remain effective. Sync requests never broadcast; payment submission retains its existing uncertainty/replay protections. Input-independent progress text does not extend the idle timer.

Beginner-help preferences are stored locally and contain no wallet data. Tooltips use fixed explanations and textContent, never interpolate typed passwords or recovery phrases. They disappear on lock/render, blur, scrolling or user input.


## Checked node discovery and multi-source payments — 0.2.4

Node discovery uses a fixed, reviewable list of four HTTPS and four onion candidates. It requires an explicit click and direct/VPN acknowledgement where applicable. At most three checks run concurrently, with bounded responses, deadlines, strict HTTPS validation, no redirects and no implicit environment proxy. Onion hostnames go through SOCKS5h. Network, synchronized status and a usable fee response must pass before a node appears; results expire. Node self-reporting establishes availability, not honesty or full chain correctness. A route change invalidates pending UI results. No request includes wallet keys or addresses. Custom URLs remain available.

Multiple selected sources in Automatic mode restrict Monero input selection to that set. Equal/custom allocations use separate transactions because the transfer RPC does not accept exact contribution amounts per source. Only ordinary software wallets support exact splits. Sources must belong to the active account, be unique and number at most 16. All amounts and summed fees use checked integer arithmetic. Every share is prepared without relay and reviewed, then the entire single-use approval expires 120 seconds after preparation completes.

Before each split relay, an intent marked unknown is stored in the wallet's encrypted cache. A crash between relay and its acknowledgement therefore never records a false not-submitted result. Uncertain or mismatched relay responses stop the remaining submissions. Receipts record the source account and per-part IDs/status; an incomplete receipt survives reopening. A cache-write failure prevents the next submission; failure to persist the final receipt is reported explicitly. This is not atomic multi-transaction execution, a retry mechanism, or an external payment ledger. Restoring an older wallet cache can discard these local receipts. Check transaction IDs and chain status before retrying anything uncertain.

Performance changes preserve the Monero password KDF, the in-memory Argon2 verifier, full executable hashes on every launch, and fresh TLS verification before opening HTTPS sessions. Progress messages contain fixed stage names and durations only, stay in memory, and do not keep the wallet unlocked. No credentials or wallet identifiers enter timing records.


Unlock profiling traced the largest variable delay to Monero's `ssl_options_t::create_context`: its default client setup generates an RSA-4096 certificate even when unused offline. Offline and the offline hardware helper now explicitly disable unused daemon TLS while retaining network-disabled mode. HTTPS sessions receive a fresh locally generated ECDSA P-384/SHA-384 client certificate through Monero's documented client-credential options. This is not the node's certificate or a new trust anchor. Rustls still validates the remote hostname/chain first; Monero still pins that authenticated server certificate. No TLS cipher policy or password derivation is weakened.

Client certificates contain no wallet, machine or user name. Each engine session gets new key material; no reusable client identity is cached between sessions. The owner-only temporary key/certificate files are removed immediately after wallet activation or a failed open, and a narrow filename pattern cleans interrupted leftovers after the next exclusive app lock. Disk deletion is not a guarantee of SSD erasure, and fresh credentials do not prevent traffic analysis or client-software fingerprinting. rcgen/ring provide certificate generation; no new wallet signing algorithm or seed generator is introduced.

References: [Monero TLS context implementation](https://github.com/monero-project/monero/blob/v0.18.5.1/contrib/epee/src/net_ssl.cpp) and [rcgen certificate API](https://docs.rs/rcgen/0.14.10/rcgen/struct.CertificateParams.html).

The wallet RPC server's automatic-refresh timer is disabled before any wallet is opened. Disabling it after opening allowed an idle-handler race that could scan before the UI had finished unlocking. An isolated trap-server regression confirms that opening makes no scan request; explicit refresh still contacts the selected node. HTTPS preflight validation remains an intentional request before key opening.


## Local Tor diagnostics (0.2.5)

Proxy detection accepts only numeric loopback socket addresses with nonzero ports; it does not perform DNS resolution. It checks at most three endpoints (entered proxy plus usual 9050/9150 ports), with bounded connect/read/write timeouts and at most three concurrent threads. The probe offers SOCKS5 no-auth and stops after the greeting; no CONNECT or remote destination is sent. A responding SOCKS listener is explicitly not identified as Tor and does not establish bootstrap, circuit privacy or node reachability. Onion checks retain socks5h resolution and no direct fallback, now with longer bounded Tor deadlines (20-second connect, 30-second status request, 15-second fee request) and the same local preflight to report absent/wrong proxy ports before remote checks. No Tor installer, service control, control-port access, bridge management or OS proxy/VPN changes were added. Frontend diagnostic results are discarded after field/route edits or dialog closure. Proxy selection affects only the draft until Save.


## Display-only preferences — 0.2.6

Full/Compact uses a dedicated typed Tauri command, separate from wallet operations and the engine mutex. Accepted changes are a two-value view enum; no path or arbitrary size is accepted from the renderer. The native process records bounded window dimensions. Preferences are atomically replaced using a randomized create-new temporary file with 0600 permissions; mode updates are committed only after the write succeeds. Startup bounds/size validation and a 4 KiB input limit fall back to Full for malformed cosmetic settings. The file contains no wallet-related data. Window size is clamped to the active display’s work area, including negative monitor origins.

The UI switches presentation without re-rendering wallet forms or reviews. It never serializes drafts for this feature. Review timers, amount arithmetic, RPC capabilities, Tor handling, secret clearing and inactivity protection retain their existing implementations. Dialogs expose their own view toggle while the underlying page remains inert. Preference changes do not use wallet commands or restart the wallet engine. Native fullscreen/maximized geometry is deferred until the window returns to normal state.


## Fixed Compact pages — 0.2.7

Compact pagination changes only presentation of existing DOM elements. Inputs remain in their original forms, including disabled/required state; no draft or password is serialized or persisted. Definition-list pairs and unusually long text retain all characters when split for display. Only shown review units are marked as visited in memory. Compact confirmation rejects a submit that skips unshown review content; the original backend's password, suffix, expiry and single-use checks remain authoritative. Native validation brings the first invalid field into view. Hidden pages are omitted from dialog keyboard navigation. Resizing and page changes do not restart a review, sign, submit, sync or unlock a wallet.


## Optional receiving-address labels — 0.2.8

Blank-label creation and later labeling use the existing engine `address` operation, including its unlocked-wallet checks, active-account scoping, label validation and encrypted store call. The frontend never generates a Monero address itself. Labels and full addresses are escaped before rendering. A missing label is an empty string, not a required placeholder. Duplicate clicks are serialized while an operation is pending; session-generation checks reject late responses after locking. The requested receive amount remains only in frontend session memory and is cleared when the wallet locks or switches accounts. It does not authorize or initiate a payment.
