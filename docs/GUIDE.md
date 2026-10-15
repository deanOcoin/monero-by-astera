# User guide

Everything below assumes the app is built and installed; see the README for that. Menus and buttons are named as they appear in the app.

## Receiving addresses

Receive → **Choose receiving address** opens the same searchable index/address grid in Full and Compact. Each row shows its index, complete Monero address and optional label. Click an address or its index to use it. **New address** immediately creates an unlabeled subaddress and selects it in the grid; **Add label** lets you name it afterward. Existing labels can be edited or cleared without changing the address. Search accepts indices, addresses and labels. Compact keeps search and creation controls visible and paginates long lists, starting at the selected address. A requested amount stays in place while selecting or labeling an address and is cleared when the wallet locks or the account changes.

## Full and compact views

The top-bar **Compact view / Full view** arrows switch between the existing spacious interface and a smaller desktop-wallet layout. The native compact window starts at **820 × 620 logical pixels** (minimum 720 × 540); Full starts at 1180 × 820. Compact uses horizontal Overview, Send, Receive, Addresses, Activity and Tools tabs, smaller forms/cards, and a side-by-side receive QR/address layout. Advanced controls remain available as you open Transaction options or Tools. Black/gold colors and hover explanations are shared.

Full is the default for a missing, invalid or corrupt native preference. A dismissible introduction points out the compact option; restore that tip through **Settings → Display → Show the view introduction again**. The last chosen mode is saved immediately in a separate, owner-only `ui-preferences.json` file. Each mode keeps its window size when switching away; sizes are constrained to the current monitor’s work area. Full-screen/maximized windows retain their OS state; the chosen size is applied when restored. Window position is not persisted across displays.

Switching changes CSS and the native window, without rebuilding wallet forms. Draft recipients, exact amounts, source selections, expanded options, receive requests/QRs, searches and review credentials remain in the existing controls. The toggle is also available in dialogs. Switching does not prepare, cancel, send, sync or unlock anything; review expiry keeps its original deadline and clears credentials when it expires. Wallet locking still clears secrets normally. View preferences contain only a mode and window dimensions; no draft, key, password or address is written to them. Failed preference writes keep the old mode and explain the failure. Repeated clicks are serialized. Compact uses a fixed workspace with no window or panel scrolling. The toolbar and tabs stay visible; longer lists, options and dialogs use Back/Next plus a page picker. Fields stay in their original forms, and validation reveals the page containing the first missing or invalid field. Paginated payment confirmation requires each review page to have been shown. Native text editing and dropdown controls retain their normal behavior.

## Startup guide and interface

The black-and-gold interface uses locally bundled Manrope text and Outfit headings, with red reserved for errors. No font-provider requests are made. The startup guide explains local nodes, Tor, remote HTTPS and external VPNs alongside your saved setup. **Skip guide** or **Continue to wallet** dismisses it without changing connections or accepting route notices. Four short route cards open the matching setup. Extra explanation stays under **What should I know?**, and skip/continue controls stay visible on smaller windows.

Use **Settings → Show connection guide at startup** to disable future startup guides, or **Read the connection guide** to reopen it. Beginner hover explanations appear after 1.5 seconds and have a separate setting. The wallet name, brand and Wallet breadcrumb return to Overview. Both preferences are local to this Mac. Incorrect-password alerts disappear after three seconds; retrying clears the previous alert immediately, including while the next unlock is loading. Other errors keep their longer reading time.

## Everyday use

1. Create a wallet with a strong password (12+ characters). Write down its 25-word recovery phrase and verify the requested words.
2. In Connection settings, choose your local node, an HTTPS node you trust, a Tor onion node, or Offline mode. No public node is selected automatically.
3. Select **Sync wallet** to scan. In Receive, generate a fresh subaddress and share the address or local QR. Addresses supports labels, search, total balances and unlocked balances.
4. In Send, enter a complete recipient address and an exact decimal amount. Review the destination, fee, total and source, then confirm its last six characters and your password. A review expires after two minutes and can be submitted once.
5. **Transaction options → Spend from** selects all addresses, one address, or **Multiple addresses…** in the active account. Selected addresses never fall back to other funds.

For multiple addresses, select between 2 and 16 sources. **Automatic** lets Monero choose contributions from those sources in one transaction. Ordinary software wallets also offer **Equal shares** or **Custom amounts**, implemented as one separately reviewed transaction per source. The total is the recipient amount; every source must also cover its own fee. Custom amounts must sum exactly to the total. Equal amounts preserve any last atomic-unit remainder in address-index order. Change may return to the account's primary address.

A split is not atomic: some shares may be submitted before a later response fails. Submission stops on uncertainty and shows each transaction as sent, unknown or not-submitted. An encrypted receipt is saved before each submission; unfinished splits remain accessible from a banner after reopening. Sync and check the IDs before any retry. The app never automatically repeats an uncertain payment. Hardware, watch-only and multisig wallets retain automatic source selection; exact per-source split amounts are limited to ordinary software wallets.

The top-bar account selector switches balances, addresses and activity. **Advanced → Manage accounts** creates or renames accounts. All accounts in an ordinary software wallet share a recovery phrase, but balances and spending inputs stay separated by account. Spending and change can redistribute balances between subaddresses.

Monero by Astera locks after five full minutes without interaction in the wallet, or immediately with **Lock wallet**, ⌘L, closing the window or quitting. Typing, clicking, moving the pointer, scrolling and returning to the wallet reset the timer. Switching apps does not lock it; Escape only closes an open dialog. Background sync does not reset the timer. The timer counts time spent asleep, and a timed-out session requires unlocking again. An exposed recovery phrase closes when you switch apps. Its copy buttons clear their clipboard value after 30 seconds, on lock, or on normal exit if it is unchanged. Copying again renews the timer. Clipboard managers may retain their own copies; a force-killed app cannot run clipboard cleanup.

## Connections and Tor failure

All **Connection settings**, **Wallet connection settings**, and **Lock & change connection** entry points now use the same “A private wallet. Your choice of route.” screen shown at startup. Choosing a route opens its configuration inside that same screen. **Edit saved connection** retains existing values; **All routes** or **Cancel** discards unsaved edits. Disabling the startup guide does not disable the manual connection screen. Editing an open wallet locks it first; reading the guide alone does not.

**Tor setup:** choose the Tor card. Expand **Start Tor · setup instructions** for Tor Browser or a standalone service (including optional Homebrew commands). Tor is separate from the wallet and must remain running. **Check proxies** probes the entered numeric loopback endpoint plus `127.0.0.1:9050` and `127.0.0.1:9150`, concurrently with bounded timeouts. It sends only a SOCKS5 greeting, never a destination request. Select **Use …** to fill the draft proxy. A SOCKS reply does not prove the listener is Tor or that Tor has bootstrapped. **Find working mainnet nodes** / **Check selected node** then tests an onion route. No remote DNS lookup or direct fallback is used. Tor checks allow 20 seconds to connect and 30 seconds per status request, plus 15 seconds for fee checks (up to about 90 seconds for all candidates). Direct/VPN limits stay shorter. Install, bridge, wrong-port, missing-proxy and unreachable-node advice is available in expandable help. Configuration still requires an explicit Save.

Tor setup references: [Tor Project macOS installation](https://support.torproject.org/little-t-tor/getting-started/installing/), [Tor Browser connection troubleshooting](https://support.torproject.org/tor-browser/encountering-issues/troubleshooting/), [bridge setup](https://support.torproject.org/tor-browser/circumvention/using-bridges/) and [SOCKS protocol](https://spec.torproject.org/socks-extensions). The app itself makes no request to these documentation sites.


- **Local node:** an existing loopback node. Typical RPC ports: mainnet 18081, stagenet 38081, testnet 28081. Monero by Astera does not install or synchronize a full node.
- **Trusted local node:** explicitly trust a node you control on this Mac. This enables signed key-image import for watch-only spent-status checks. That operation reveals wallet outputs to the node. This trust option cannot target a remote host.
- **Remote:** your HTTPS node, with TLS certificate validation and Monero's untrusted-daemon mode. For mainnet, acknowledge the route and choose **Find working mainnet nodes**. The app checks four fixed HTTPS candidates (OpenInternet, Cake Wallet, Monero.fail and Seth for Privacy), displaying only nodes that pass live network, sync and fee checks. Results expire after two minutes. Select a result and explicitly Save connection to apply it. These are public, independently operated endpoints whose availability can change. The form recommends a trusted VPN with its kill switch, or Tor mode with an onion node, for additional network privacy. Its operator can observe your IP and request timing or withhold data; it does not receive your spend key or seed.
- **Tor:** a full v3 onion node and separately running loopback SOCKS proxy (usually `127.0.0.1:9050`). Wallet-to-node traffic uses Monero's proxy support, with DNS disabled. Tor is not bundled. **Find working mainnet nodes** checks four onion candidates through that proxy; only successful checks appear. A failure does not trigger a direct connection.
- **My trusted VPN:** explicitly use your external VPN and an HTTPS node through macOS networking. Before each wallet session, connect the VPN, enable its kill switch, and acknowledge this route. Monero by Astera cannot detect or enforce a VPN tunnel. Without the VPN's kill switch, a dropped tunnel can expose your IP.
- **Offline:** Monero network access is disabled. Software-wallet creation/recovery, addresses, backups and offline signing are available.

After a Tor sync failure, the prompt offers Retry Tor, Lock & stay offline, or Use my trusted VPN instead. The VPN option locks the wallet and opens settings with a blank HTTPS-node field. It makes no connection and does not save a route until you explicitly save it. A VPN alone cannot reach an onion node. Network/route changes always require a locked wallet.

## Advanced wallet setup

From the locked welcome screen, select **More wallet options**.

- **Polyseed recovery:** restore a 16-word phrase locally, including an encrypted phrase with its separate seed passphrase. The upstream Polyseed library validates the words/checksum and derives the key. An incorrect seed passphrase can produce a different wallet; compare the restored address with your records. Monero by Astera stores derived Monero keys and offers the equivalent 25-word recovery phrase. Height 0 is safe and scans from the start; the embedded birthday is recorded but is not used to guess a later restore height. Unsupported feature bits are rejected.
- **Hardware wallet:** create a local wallet through the official Monero CLI helper, with Ledger or Trezor selected. Unlock the device and approve its prompts. Never type hardware recovery words into Monero by Astera. Payments must be verified on the device's screen. The helper is independently hash-pinned and starts offline. No physical device was available for validation. Trezor configurations needing host PIN/passphrase entry may require the official GUI; this build has no host PIN/passphrase entry flow.
- **Watch-only companion:** create an online wallet from an exported watch packet. It has a private view key but no spend key. It can receive, scan and prepare unsigned payments; it cannot sign them.
- **Encrypted file recovery:** restore an Monero by Astera backup manifest together with its `.keys` and `.cache` files, using their existing password. This preserves labels/accounts and the wallet type. Keep all three files; checksums reject mixed or damaged copies. Key/cache restore limits are 4/128 MiB respectively.
- **Multisig participant:** create a fresh participant for a threshold between 2 and 5 signers. Monero multisig remains experimental. The app never converts an existing funded wallet into multisig.

## Exchange folder and encrypted backups

**Advanced → Open wallet tools** contains the file workflows. **Lock & open exchange folder** opens Finder. Put incoming files in that folder, reopen your wallet, then refresh the file list. The folder is `~/Library/Application Support/local.astra.xmr/exchange/` with owner-only permissions. File operations reject path traversal, symlinks, non-regular files, wrong network/wallet packets and oversized transaction packets. Transaction packets are limited to 16 MiB; oversized workflows require the official wallet.

**Back up encrypted wallet files** exports a JSON manifest, encrypted keys and encrypted cache. Copy all three to offline storage and retain the password. Ordinary software recovery words do not preserve labels. Multisig requires backups of each participant's final wallet: the original pre-multisig 25 words do not restore the shared wallet.

Exchange files can reveal wallet addresses, transaction details or incoming payments. A watch packet contains the private view key in plaintext inside the owner-only folder. Key-image files reveal wallet outputs. Keep these files private and move them only between your intended devices/participants. Monero by Astera does not upload them or securely erase SSD/cloud copies.

## Offline payment workflow

1. Create or restore the signing wallet while Offline. **It must never have refreshed from a node.** To move an existing online wallet offline, restore a new copy from its seed in Offline mode. Merely changing its connection mode is insufficient under Monero's import rules.
2. Export a watch-only companion. Move that packet to the online Mac's exchange folder and create the companion from More wallet options. Sync it.
3. Export outputs from the online companion; import them on the offline signer. Export signed key images from the signer and import them on the companion using your own Trusted local node.
4. Use Send on the companion. Review and confirm to export an unsigned payment file; nothing is broadcast.
5. On the signer, select Review & sign offline payment. Monero by Astera asks Monero to decode the unsigned file and checks recipients, fee arithmetic, change ownership, ring size and timelock. Review every recipient, authorize with your password, then export the signed file.
6. Record the **full signed-file SHA-256 fingerprint on the trusted offline device**. Move the file back to the companion. Review signed file for broadcast requires that fingerprint and your password before submission.
7. Sync to check confirmations. Exchange updated outputs/key images to keep the companion's spent status accurate.

Monero RPC cannot describe a normal signed transaction set. Accordingly, the online review is a signer-supplied summary authenticated by the independently obtained full file fingerprint, not a claim that the online wallet decoded the signed transaction. Do not obtain the comparison fingerprint from the same untrusted online file. A rejected or uncertain signing/broadcast response is not automatically retried; inspect chain status before starting another payment.

## Multisig workflow

1. Each participant creates a fresh wallet with the same threshold/count. Exchange the first setup files.
2. Choose Continue multisig setup and select exactly one file from every other participant for the current round. Share the resulting file and repeat until Ready. Re-export the latest round if needed.
3. Independently compare the final shared address. Back up each participant's encrypted files. Receive/Send/address views are withheld until setup and the local backup are complete.
4. Sync each participant. Export multisig sync data, exchange it, and import peers' data. Monero by Astera refreshes after import to rebuild the usable outputs. Repeat after new payments and after restoring backups. You can switch offline again before signing.
5. One participant prepares and exports a payment through Send. Another participant selects Review & sign multisig payment and independently reviews the decoded transaction. Exchange the new file for any remaining signatures.
6. Select Review & broadcast multisig payment once the threshold is reached. Monero enforces the signature threshold. A cached local approval record blocks re-approving the same described intent, and each in-memory approval expires after two minutes.

Treat requests to sign a second transaction as a new payment, even if someone says it is a retry. Independently check the chain. Quorum security does not prevent participants from being socially engineered. Restoring an older cache can remove local approval history; exchange fresh sync data and check the chain before signing.

## Storage and limits

Wallet data stays outside the app folder at `~/Library/Application Support/local.astra.xmr/<network>/`. Monero encrypts keys/cache; names, node settings and some test-network public-address files remain local metadata. Directories are 0700 and app-created files are 0600. Software keys exist in memory while unlocked; malware or an administrator on the host remains a risk. Screen capture protection is requested but is not universally enforceable.

The app uses a native Tauri webview, not bundled Chromium. No telemetry, cloud account, AI service, fiat-price feed, remotely fetched node directory, explorer integration or automatic update service is included. Candidate discovery runs only on request. A single source payment too large for Monero’s `transfer` method can still return an engine error; imported transaction sets are capped at 16 transactions/64 recipients. Physical hardware, public onion routing, public stagenet and funded mainnet acceptance still need validation. Read SECURITY.md and docs/VALIDATION.md for the exact boundaries.

## Responsiveness

Long operations show the current backend stage and elapsed time, including wallet-file opening, node checking and payment preparation. Automatic refresh is disabled before wallet opening, so unlocking no longer races an unrequested scan. Sync wallet and payment preparation still scan explicitly. Profiling identified repeated RSA client-certificate generation during opening. HTTPS sessions now use fresh P-384 transport credentials, and offline mode skips unused TLS setup. Encryption, password derivation and node-certificate checks are unchanged. Wallet size and network conditions still affect opening time. Engine hashing now streams 64 KiB chunks instead of loading the whole executable, address-balance matching is linear rather than quadratic, and payment preparation avoids an unused snapshot. Known wallet types are cached for the session; read failures are not cached. Progress polling does not extend the inactivity timer.

## Connecting and checking incoming payments

Open **Connection settings**, choose Public HTTPS node or your external VPN route, acknowledge the route notice, then click **Find working mainnet nodes**. Select one of the successful live results, or enter a custom HTTPS URL. **Check selected node** contacts only that node’s public status endpoint through the chosen route; it does not unlock keys or prove operator honesty. **Save connection** stores the selection. Unlock your wallet with the route acknowledgement, then press **Sync wallet**. After sync, **Addresses** shows balances for each subaddress; search its label to find it.

Direct HTTPS reveals your IP and request timing to the node. If Tor is unavailable, connect a VPN you trust on your computer and enable its kill switch before using HTTPS. The wallet cannot detect or enforce an external VPN. Tor never falls back silently. A failed scan offers retry, another node, VPN, reviewed direct HTTPS or offline mode. No recovery option broadcasts a payment.

The first scan may take several minutes. An elapsed timer shows it is still waiting for the engine; it is not a fabricated percentage. Five-minute inactivity locking remains enabled. The HTTPS engine validates the hostname and certificate through Rustls before pinning that exact certificate for Monero’s connection. If the certificate changes, reopening revalidates it.

## Beginner help

Pause over relevant controls for about one and a half seconds for a beginner explanation. Keyboard focus also supports hints. Go to **Settings → Show beginner hover explanations** to turn them off. The preference stays on this Mac. Password hints never repeat entered contents.
