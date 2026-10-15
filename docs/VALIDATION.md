# Validation record

Newest entries first after the base record. Counts are what passed at the time of each entry.

## 0.2.8 re-check, 15 October 2026

The automated subset that does not need the engine binaries or a Mac was re-run on the current tree on Linux: 35 Rust unit tests, 4 JavaScript unit tests, `cargo clippy --all-targets -- -D warnings`, `tsc` and the Vite production build all pass. Playwright, the real-engine integration tests and the native bundle inspection were not repeated here; the entries below record their last runs.

## Base record: 0.2, 14 September 2026

Environment: Apple Silicon macOS, Node 24.3.0, Rust 1.97.1, Tauri 2.11.5 and official Monero 0.18.5.1. No real funds were used.

## Automated checks

**34 tests passed**: 12 Rust unit tests, 4 JavaScript unit tests, 8 real-engine integration tests and 10 Playwright UI tests. TypeScript/Vite production compilation, the native release build and Rust clippy across all targets with warnings denied also passed.

| Check | Coverage |
| --- | --- |
| Rust unit tests (12) | Decimal precision and unsigned-64-bit bounds; safe paths; connection restrictions; explicit VPN acknowledgement; 120-second approval identity/expiry; repeated clipboard copy and preservation of replacement text; bounded exchange files including symlink/FIFO rejection; malformed transaction summaries; hardware-helper integrity/cancellation; upstream and independent encrypted Polyseed vectors. |
| JavaScript unit tests (4) | BigInt precision, invalid amounts, agreement with Rust's numeric limits and escaping untrusted text. |
| Playwright tests (10) | Dashboard, concealed balances, address search, local QR, escaped labels, send authorization, wallet creation, locking, connection forms, Tor failure with no automatic fallback, expiry disabling send, applicable advanced fields and no receive address for unfinished multisig. Explicit fixtures verify the UI contract; these are not settlement tests. |
| Rust lint | Passed with `cargo clippy --all-targets -- -D warnings`. Unmodified upstream Polyseed C emits compiler warnings about signedness, assertions and unused helper functions; these are preserved in the build output. |
| npm audit | Zero reported vulnerabilities. |
| cargo audit | Zero entries in its vulnerability list; maintenance/unsoundness warnings below remain. Package audits are not an independent application audit. |
| Official binaries | Both CLI and RPC originate from the signature-verified official archive and have separate compile-time SHA-256 pins checked before launch. |

## Real Monero integration tests (8)

1. **Offline lifecycle:** create, encrypted reopen, wrong-password rejection, backup-word verification, subaddress labels, password change and equivalent 25-word recovery.
2. **Send/receive:** mine mature private-chain outputs; prepare and review exactly 1.000000000001 XMR; reject wrong password, cancelled/duplicate approval and an empty selected source address; broadcast once, confirm and verify per-subaddress balances and persistence. Selecting an empty source cannot spend other funds.
3. **Guardian/authentication:** unauthenticated loopback RPC returns HTTP 401; closing the UI liveness pipe shuts down the guardian and wallet engine.
4. **Tor failure:** an unavailable local SOCKS proxy causes sync to fail closed. This does not establish public onion reachability or a packet-level anonymity guarantee.
5. **Polyseed/accounts/backups:** recover equivalent keys through Polyseed and legacy recovery; isolate account balances/addresses; preserve labels through encrypted file recovery; reject path traversal/symlink inputs.
6. **Offline signing:** create a fresh never-refreshed offline signer and watch companion; exchange outputs and signed key images through a trusted local node; prepare exactly 2.000000000001 XMR; decode and sign offline; reject an incorrect independently recorded fingerprint; replace the source file after review and verify the retained original is used; reject replay; broadcast and confirm the exact recipient amount.
7. **2-of-2 multisig:** complete all setup rounds, compare the shared address, back up participants, fund, synchronize, sign with both parties, broadcast and confirm exactly 3.000000000001 XMR.
8. **2-of-3 multisig:** complete setup/synchronization, sign with participants one and three without participant two's signature, broadcast and confirm exactly 4.000000000001 XMR.

Private regtest coins have no real monetary value. Tests use isolated temporary directories and official Monero engine processes. The private-chain compatibility override is debug/test-only and absent from release builds. The final integration run passed all eight tests in 59.68 seconds.

## Native release inspection

The 0.2 bundle passed strict/deep macOS code-signature verification; its bundled CLI/RPC hashes match their pins. The app contains 61,300,341 bytes of files (about 58.5 MiB). Its executable fingerprint is recorded in `build-manifest.json`.

The release was opened through the native macOS interface and successfully reopened the previous version's disposable offline stagenet wallet. Saved subaddresses and a local receive QR appeared. A second account was created; switching back restored the original account's three-address view. The native account menu did not trigger focus-loss locking. Encrypted backup export produced a manifest, keys and cache; both manifest checksums match the exported files. The cache did not contain the new account label in plaintext, and all app-created test files were mode 0600.

The macOS clipboard contained 95 bytes immediately after copying a test address and zero after the timeout while the wallet stayed open. A second copy followed by explicit lock cleared immediately. Lock returned to the password screen and terminated the guardian/engine. Polyseed and hardware setup forms showed the applicable fields and device-testing limitations. Finally the app was quit, absence of app/guardian/engine processes was verified, and only disposable test data was moved out of normal application storage. First launch has no test wallet or saved test connection.

## Polyseed reference

`polyseed-reference-vector.json` contains a public test phrase, encrypted phrase and expected spend key. The reference binds upstream C to Python hashlib PBKDF2 independently of the Rust callback. Reproduce it from the project root with:

```sh
mkdir -p work
cc -dynamiclib -O2 -DPOLYSEED_SHARED -I src-tauri/vendor/polyseed/include src-tauri/vendor/polyseed/src/*.c -o work/polyseed-reference.dylib
python3 scripts/reference-polyseed.py
```

These are disposable test vectors, never wallet credentials to fund.

## Dependency warnings

- RustSec reports unmaintained transitive `proc-macro-error` and five `unic-*` crates. They were not replaced with invented patches.
- `glib` 0.18.5 has `RUSTSEC-2024-0429` in the cross-platform dependency lockfile. `cargo tree --target aarch64-apple-darwin -i glib` reports nothing in this Mac build. A Linux port must address it before release.
- Package audits do not cover all custom logic, upstream C/C++ code, OS/webview behavior or unknown vulnerabilities.

## Not established

No physical Ledger/Trezor workflow, public stagenet/mainnet-funded payment, successful public Tor/onion session, complete network capture, very large wallet recovery, independent security audit, notarized distribution or reproducible-build comparison was performed. Trezor host PIN/passphrase entry is not implemented. Multisig is experimental upstream. VPN routing depends on the external VPN and its kill switch; Monero by Astera does not detect or enforce a tunnel.

## Public-node UI update — 14 September 2026

Added an explicit public-mainnet-node button for Remote/VPN modes. It only fills the URL; it never saves, connects, changes network or falls back from Tor. The form identifies the endpoint as public and recommends a trusted VPN/kill switch or Tor onion mode. The existing connection and Tor-failure tests both passed after this change; the native production build passed. In the packaged app, the button and warning were visible and the button filled the URL. The app was closed without saving a route or unlocking a wallet. No funded-wallet operation was performed.

A direct, non-wallet HTTPS GET to the supplied endpoint returned OK, mainnet and synchronized=true. This verifies availability at the check time, not honesty of the operator. Current binary fingerprint/size are in build-manifest.json; the earlier native lifecycle and 34-test validation above describe the base 0.2 build.

## Product rename — 15 September 2026

The product is now Monero by Astera. The native executable/package, window title, sidebar, dialogs, macOS app name and current documentation use the new name. The project folder was renamed to match. Existing storage, backup-format and encrypted-attribute identifiers were intentionally retained for compatibility with funded wallets and saved settings.

For this change, 4 JavaScript unit tests, 10 UI tests, 12 Rust unit tests and 2 real-engine checks (offline encrypted-wallet lifecycle and guardian/authentication cleanup) passed. Rust clippy passed with warnings denied. The real-engine checks used isolated disposable wallets. Historical transaction validation above remains the base 0.2 evidence; this rename did not repeat funded regtest settlement tests.

The packaged renamed app passed strict code-signature verification; both Monero binaries still match their pinned hashes. Native inspection confirmed the new window/sidebar name and About/Hide/Quit menu items. The existing wallet remained listed on the locked screen; it was not unlocked or modified. The app was quit after inspection. Spotlight metadata reports the display name Monero by Astera.

## Inactivity fix and Applications installation — 0.2.1, 15 September 2026

Removed Escape and both native/webview focus-loss lock paths. Escape dismisses a dialog; the Lock button, Command-L, window close and quit remain explicit lock actions. Exposed recovery words still close on blur. A single backend timer counts five full minutes after wallet input. macOS continuous time includes sleep and ignores wall-clock changes. Pointer/keyboard/wheel/input activity has a trailing update, and activity reports bypass queued RPC work. Automatic commands do not extend a session. Expiry is claimed once, invalidates queued operations and cannot be revived by late input.

Checks passed: 15 Rust unit tests, 11 Playwright UI tests, 4 JavaScript unit tests and 2 real Monero checks (offline encrypted-wallet lifecycle and guardian cleanup), plus clippy with warnings denied and the native production build. The boundary tests verify no expiry at 299.999 seconds, a complete new five-minute interval after the final input, no background keepalive, and rejection of revival after expiry. The UI checks cover Escape, blur, explicit Command-L and the final input in a burst. No real funds were used.

Native checks use only a disposable offline stagenet wallet while preserving the user's original connection configuration and funded wallet files.

The final installed bundle passed strict/deep signature verification and matches the final release build byte-for-byte. In native testing, Escape and switching applications preserved the unlocked disposable session. Command-L returned immediately to the password screen. An untouched native run returned to the password screen and terminated its engine 318.9 seconds after the measured accessibility click; the last backend activity event was not instrumented, so this is lifecycle evidence rather than proof of an exact native deadline. Deterministic tests establish the 300-second timer boundary. The native measurements are in `idle-native-check.json`.

After the check, the original connection configuration was restored and only the named disposable stagenet fixture was moved out of app storage. The existing mainnet wallet remained listed on the locked screen without being unlocked. The app was quit and absence of app/guardian/RPC processes was verified. Spotlight returns only `/Applications/Monero by Astera.app`; build caches and prior app copies are retained in a non-indexed directory.

## Sync recovery, direct consent and beginner help — 0.2.2

The reported main-wallet failure was reproduced through the installed UI: `Monero refresh (-38): no connection to daemon`. No connection configuration existed, so the app was using its default local node. In addition, real-engine HTTPS tests exposed missing explicit TLS trust material. The final implementation validates certificate chain and hostname first, then pins the authenticated leaf certificate in the Monero process; it does not ship the intermediate general-CA approach.

The two bundled public HTTPS endpoints each completed real Monero scans using disposable, unfunded wallets. Each test created its own keys and scanned a short recent mainnet interval. These tests establish the transport and sync path, not receipt of the user's payment. A local self-signed HTTPS endpoint was rejected before opening wallet keys. The SOCKS test observed the onion hostname in the SOCKS5 request, then forced proxy failure and verified a closed failure. Redirect, wrong-network, malformed/oversize responses, node readiness, and missing consent are covered by deterministic tests.

UI coverage includes persistent sync guidance, successful retry, recovery choices with no automatic route change, acknowledgement before direct opening/checking, public presets, stale diagnostic clearing, a two-second hint delay, local persistence of the Settings toggle, and avoiding password contents in hints. Screenshots were visually inspected for the connection form, Settings, and hover explanations. Exact final logs and build identity are recorded beside this document.

Primary implementation references: [Monero v0.18.5.1 TLS implementation](https://github.com/monero-project/monero/blob/v0.18.5.1/contrib/epee/src/net_ssl.cpp), [Monero wallet setup](https://github.com/monero-project/monero/blob/v0.18.5.1/src/wallet/wallet2.cpp), and [Wallet RPC documentation](https://docs.getmonero.org/rpc-library/wallet-rpc/).

Final checks: 20 Rust unit tests, 17 Playwright UI tests, 4 JavaScript unit tests, two public HTTPS real-engine scans, and four additional real-engine checks (untrusted TLS rejection, missing Tor proxy, offline lifecycle, guardian/authentication) passed: 47 checks total. Rust clippy passed with warnings denied, and the production bundle passed strict/deep signature verification with both bundled engine hashes unchanged. Native launch confirmed version 0.2.2 and the existing mainnet wallet on the locked screen. Funded-wallet sync confirmation requires the user to unlock it locally; no payment receipt is claimed from the disposable tests.

## Password feedback, startup guidance and black/gold interface — 0.2.3

Incorrect/invalid-password and mismatched-password alerts expire after 3,000 ms. Starting a new operation cancels the old toast before work begins, so a corrected password does not load beneath stale failure feedback. Non-password errors retain their longer reading interval. Tests simulate a delayed successful unlock after a failed attempt and check that the alert is absent throughout the pending attempt.

A default-on startup guide explains local nodes, Tor, remote HTTPS, VPN trust and offline/sync behavior, and displays the saved route. Skip and Continue neither connect nor change settings/consent. Users can hide future guides or reopen the guide from Settings; this local preference is separate from hover help. Keyboard focus stays inside dialogs, and guide controls remain visible at the 920×700 minimum window size while the explanation scrolls.

The interface uses charcoal surfaces, restrained gold emphasis and red errors. Manrope body text and Outfit headings are bundled locally with their OFL licenses; asset fingerprints are in fonts/sources.json. QR images keep a white quiet zone and dark modules. Production network restrictions are unchanged. The guide wording was checked against Monero's [remote-node explanation](https://www.getmonero.org/resources/moneropedia/remote-node.html).

46 automated tests passed: 20 Rust unit, 22 Playwright UI and 4 JavaScript unit checks. The final guide keyboard/viewport tests passed after layout adjustments. Production frontend/native builds and strict Rust lint passed; existing upstream C warnings remain. Exact logs use the theme- prefix beside this document. Screenshots were inspected for Overview, Receive, incorrect-password feedback, connection notices and the guide at normal/minimum sizes. These UI tests use disposable mock data; public-network settlement tests were not rerun for this interface change.

The installed 0.2.3 bundle passed strict/deep signature verification, matches the built executable and retains both pinned Monero engine hashes. Native inspection confirmed the guide at startup, skip returning to the existing locked wallet and saved route, Settings controls and reopening the guide. No funded wallet was unlocked or payment made during this update. The application was closed after verification.


## Checked nodes, source allocations and responsiveness — 0.2.4

The release adds a skippable four-route guide, side-by-side route/node configuration, live-filtered mainnet candidates, shorter everyday screens, 1.5-second hover hints and meaningful Overview links. The connection and guide layouts were inspected at 1180×820 and the 920×700 minimum. Custom nodes and all existing advanced wallet tools remain available.

Discovery checks four fixed HTTPS candidates and four onion candidates only on request. Network, synchronized status and usable fee response must pass; HTTPS remains strictly verified and onion checks use the selected SOCKS route. All four HTTPS candidates passed the actual backend discovery on 17 September 2026. UI tests cover no premature options, missing consent, stale responses, route changes and two-minute expiry. A successful public Tor session was not tested.

Multi-source Automatic restricts a single payment to selected addresses. Equal/custom software-wallet allocations create separate transactions, with integer-exact recipient shares and per-source fees shown before a single-use confirmation. A real isolated-chain test funded two source subaddresses, confirmed a 3.000000000001 XMR equal split and a 1+2 XMR custom split, and verified the exact 6.000000000001 XMR final recipient balance. It also checked a combined automatic payment requiring both sources, insufficient selected funds despite funds elsewhere, incorrect password, cancellation, replay and encrypted receipt reopening. Failure-injection tests exercise the actual relay loop: intent must persist before submission, uncertain responses stop subsequent parts, and storage failure prevents relay. An additional UI test keeps partial results accessible even when the next balance read fails.

Profiling identified slow RSA client-certificate generation in the upstream TLS initialization path and a race where automatic refresh could begin before the app disabled it. HTTPS now uses fresh P-384 client credentials; unused offline daemon TLS is disabled. The RPC automatic-refresh timer is disabled **before** opening any wallet. A local trap server received zero scan requests during unlock, then received a request on explicit Sync. Real HTTPS scans passed against OpenInternet and Cake Wallet; temporary client credentials were removed after success and incorrect-password failure. Strict server-certificate rejection still passed. Session identities differ and mode-0600 files are cleaned normally and after interrupted startup.

Five disposable release HTTPS reopens measured **2,071 / 2,008 / 2,400 / 2,045 / 2,583 ms** (median 2,071 ms). Before the startup-scan fix, the same benchmark measured **9,000 / 8,755 / 8,070 / 7,636 / 4,925 ms**. Final offline reopens measured **1,693 / 3,203 / 2,115 / 1,816 / 1,278 ms** (median 1,816 ms); the original offline baseline median was 3,217 ms. Timing varies and these empty disposable wallets do not predict the funded wallet's exact time. All timed snapshots were 2 ms. The final HTTPS balance-loading phase was 3–4 ms instead of seconds. The Monero KDF, Argon2 authentication, executable integrity and server TLS verification were retained. Details are in ux-performance-summary.json and the phase logs.

**72 checks passed:** 28 Rust unit tests, 27 Playwright UI tests, 4 JavaScript unit tests and 13 real-engine integration tests. The complete engine suite includes ordinary settlement, offline signing, 2-of-2/2-of-3 multisig, encrypted recovery, Polyseed/accounts, guardian/authentication, missing Tor proxy, strict TLS rejection, public HTTPS, live discovery, exact split settlement and no automatic startup scan. Release benchmarks and the second HTTPS/credential-cleanup run are additional checks. Rust fmt/clippy passed with warnings denied; existing upstream Polyseed C signedness warnings remain. Current RustSec results report no vulnerability entries; the existing unmaintained-crate and non-Mac glib unsoundness warnings remain. glib is absent from the Apple Silicon target dependency tree. rcgen's added dependencies had no reported advisory.

The installed bundle's fingerprint is in build-manifest.json. No funded wallet was unlocked or real XMR sent for this update. Physical hardware, successful public onion routing and an independent security audit remain outside this validation.


## Shared connection screen and Tor setup — 0.2.5

Startup, manual connection settings, general Settings and change-connection recovery use the same route chooser and dialog shell. Saved configuration can be edited without clearing it. All routes/Cancel discard draft edits. Tor instructions cover Browser/service startup, optional Homebrew commands, common ports, bridges and explicit alternative routes.

68 automated checks passed for this change: 31 Rust unit tests, 32 Playwright UI tests, 4 JavaScript tests and the real-engine missing-Tor-proxy test. New coverage checks loopback-only addresses, SOCKS protocol negotiation without any CONNECT request, authentication/wrong-protocol rejection, bounded stalled-listener failure, chooser consistency, lock-before-edit, no automatic save/contact, stale proxy response rejection and recovery guidance. The existing mock SOCKS test additionally confirms onion hostnames are sent to the proxy and failures do not fall back. The prior 0.2.4 real-engine suite is recorded above; only the relevant missing-proxy engine test was repeated here. No real wallet or funds were used.

Rust formatting and clippy passed; existing upstream Polyseed C signedness warnings remain. The compiled frontend and release bundle build succeeded. Native verification found the existing Tor Browser SOCKS listener at 127.0.0.1:9150. With longer Tor deadlines, Plowsof and Rucknium passed mainnet status and fee checks inside the installed app; failed candidates were omitted. A raw SOCKS greeting alone is never presented as proof of Tor connectivity. Wallet synchronization through public Tor was not exercised. Wallet cryptography, startup scan behavior, payment logic and bundled Monero binaries were not changed.

Final native checks: startup and manual connection settings share the same heading, chooser and editor shell; detected-proxy and checked-node selection affect drafts only; Cancel preserves the existing mainnet VPN/Cake connection. The app was quit. SHA-256 checks confirm the funded wallet/cache/key files and connection.json are unchanged. Installed executable matches the release bundle; ad-hoc signature, version and bundled engine pins were verified. No settings were saved, no funded wallet was unlocked, and no payment was sent.


## Persistent compact interface — 0.2.6

Full and Compact share live forms and wallet state. Compact uses a smaller native window, horizontal tabs, denser cards/forms and a QR/address side-by-side layout. The toggle works from the main toolbar and dialogs; the background toolbar toggle stays hidden while a dialog is active. Full remains the default and has a dismissible, recoverable introduction.

**80 automated checks passed:** 35 Rust unit tests, 41 Playwright UI tests, 4 JavaScript unit tests. New coverage exercises missing/corrupt/oversized preferences, private atomic persistence, write failure, bounded geometry, switch/reload persistence, retained password/send/source/receive drafts, unchanged QR data, payment review identity and expiry, compact navigation and tool access, scrollable connection/review dialogs, visible route warnings and serialized rapid switches. The hover timing regression uses a paused clock to avoid wall-clock scheduling variance during compilation. Rust formatting/clippy passed; existing upstream Polyseed C warnings remain.

Native release checks confirmed actual 1180 × 820 and 820 × 620 logical window sizes, Compact persistence across full quit/relaunch, and fullscreen deferral/restoration on this Mac. Full and its introduction were restored for delivery. Screenshots from mock-wallet fixtures were inspected at 820 × 620 and minimum 720 × 540; no funded-wallet screenshot or unlock was used. Negative-monitor handling and small-work-area limits are implemented, but a physical multi-monitor setup was not available for native validation.

The app was fully quit. Funded wallet/cache/key and saved-node configuration SHA-256 values match the pre-change baseline. The display preference is the only new native configuration file. Monero binaries, transaction algorithms, password encryption, Tor/network policy and idle-lock duration were not changed. Prior real-engine integration tests remain recorded in earlier release sections; this change did not re-send test transactions.


## Fixed Compact workspace — 0.2.7 · 18 September 2026

The compact window now keeps its toolbar, six navigation tabs and footer fixed. Content is measured in the available space and divided into pages; no document, main-panel or dialog scrolling is used. Back/Next and a page selector expose longer lists, advanced options and instructions. Everyday Send remains together, and Receive keeps the address selector, full address, QR, copy button and amount together at the 720 × 540 minimum. Full view retains its original layout.

**89 automated checks passed:** 50 Playwright UI tests, 35 Rust unit tests and 4 JavaScript unit tests. TypeScript/Vite, Rust fmt and clippy with warnings denied, and the native release build passed. Existing upstream Polyseed C warnings remain. This release changes presentation and keyboard validation only; no transaction engine, network transport, cryptography or wallet storage implementation changed. Real-engine checks from earlier releases were not rerun.

New UI checks measure both viewport/panel overflow and visible-control bounds, traverse all pages of every tab, enumerate all 45 addresses and 45 transactions, check long labels and search reset, expanded Tor instructions/proxy discovery/node results, Settings, all five advanced setup modes, restore validation, a 16-part review, and custom source amounts from distant list pages. They verify drafts and text survive paging and view changes, and review pages cannot be skipped by submitting from another page. Existing deadline tests still prove that resize does not extend authorization. Tests use disposable mocks; no real funds or private wallet credentials are involved.

The native check identified that WebKit pauses animation-frame callbacks while the wallet window is occluded. Compact layout now batches work with a microtask instead, and recomputes when local fonts finish loading. A regression test suspends animation frames and verifies that compact form pages still initialize, fit and navigate.

Native validation at 720 × 540 verified guide/restore pagination, stable navigation, first-invalid-field recovery and Full/Compact switching while locked. The original 820 × 620 Compact preference was restored and verified on relaunch. The final installed application passed strict/deep signing and pinned-engine checks, then was quit completely. Funded wallet/cache/key files and saved Tor configuration matched the private baseline hashes.


## Receiving address grid — 0.2.8 · 18 September 2026

Both layouts now use a searchable grid of subaddress indices, complete Monero addresses and optional labels. New address directly calls the existing engine with an empty label. The created address is selected, its grid page is shown, and labels can be added, edited or cleared afterward. Label changes preserve the selected receive address and return to the grid on Save or Cancel. Receive request amounts survive grid selection, labeling and layout changes, and clear on locking or account changes. Compact retains fixed search/creation controls and paginates long grids without window/panel scrolling.

**95 automated checks passed:** 55 Playwright UI checks, 35 Rust unit checks, 4 JavaScript unit checks and one real Monero offline-engine test. The real test created an unlabeled subaddress in a disposable temporary wallet, added a label, reopened the wallet, removed the label, reopened again and verified address identity and persistence. No funded wallet or mainnet transaction was used. Existing core address-generation/storage operations were reused without modification.

UI coverage includes label escaping, fully local QR generation, immediate creation in both views, optional add/edit/clear/cancel behavior, amount/QR preservation, every row of a 45-address compact grid, index and complete-address search, no-match creation, selection of the new address, view changes during label editing, repeated-click serialization, creation errors, and locking before a delayed response. The complete regression suite passed. An earlier run was interrupted during browser fixture setup; the clean rerun passed all 55 UI checks. Rust fmt/clippy and TypeScript/Vite compilation passed.

The native release build and installed signature/hash checks passed. The Mac was locked at final native inspection, so no native UI walkthrough was performed for this release. The app was confirmed fully shut down; funded wallet files, connection configuration and display preferences matched their preservation baselines.
