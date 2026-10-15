# Monero by Astera

A native Monero wallet for Apple Silicon Macs, built with Tauri and Rust
around the official Monero engine. It is for people who want a desktop wallet
that is private by default and explains itself: you choose the route to the
network, nothing is contacted until you do, and every risky action is reviewed
before it happens.

Not audited. Do not keep substantial value in it until it has been
independently reviewed. See [SECURITY.md](SECURITY.md) for the exact
boundaries.

## What it does

- **Routes, not defaults.** Local node, trusted local node, remote HTTPS with
  certificate validation, Tor through your own SOCKS proxy, an external VPN
  you acknowledge, or fully offline. No public node is selected for you, and a
  Tor failure never falls back to a direct connection.
- **The official engine, locked down.** `monero-wallet-rpc` runs as a child
  process on a random loopback port behind Digest auth with a fresh 256-bit
  password. Its SHA-256 is pinned at compile time and checked before every
  launch. The UI only ever sees an allowlist of commands.
- **Reviewed payments.** Address and network validation with OpenAlias off, a
  signed-but-unrelayed draft that expires in two minutes, confirmation of the
  address tail plus your password, one relay. Ambiguous responses are reported
  as unknown and never retried for you.
- **Subaddresses and accounts** with labels, search, per-address balances, and
  spending from one, several or all addresses.
- **Polyseed and 25-word recovery**, encrypted file backups with checksums,
  watch-only companions, an offline signing workflow with an independently
  recorded fingerprint, hardware-wallet creation through the official CLI
  helper, and 2-to-5 signer multisig.
- **Locks itself** after five minutes without interaction, on close and on
  quit; exposed recovery words close when you switch apps; copied addresses
  leave the clipboard after 30 seconds.
- **Full and compact layouts**, a startup connection guide, and hover
  explanations for beginners that can be turned off.

No telemetry, no cloud account, no price feed, no auto-update, no font
provider, no remotely fetched node list.

## Build

Apple Silicon macOS 12+, Node 22+, Rust, Xcode and GnuPG.

```sh
npm ci
bash scripts/fetch-monero.sh   # downloads Monero 0.18.5.1, verifies the signed manifest and the pinned hashes
npm run desktop                # src-tauri/target/release/bundle/macos/Monero by Astera.app
```

`npm run tauri dev` starts a native development build. `npm run dev` on its
own is a browser preview with no access to wallet keys.

Wallet data lives outside the app in
`~/Library/Application Support/local.astra.xmr/<network>/`.

## Test

```sh
npm test                 # JS unit tests
npm run test:core        # Rust unit tests
npm run test:ui          # Playwright, against fixtures
npm run test:integration # real engine on a private regtest chain, needs scripts/fetch-monero.sh
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

What was run and what it proved is in [docs/VALIDATION.md](docs/VALIDATION.md).

## Documentation

- [User guide](docs/GUIDE.md): connections, Tor, payments, backups, offline
  signing, multisig
- [Security model](SECURITY.md)
- [Validation record](docs/VALIDATION.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)

Upstream references: [Monero wallet RPC](https://docs.getmonero.org/rpc-library/wallet-rpc/),
[offline signing](https://docs.getmonero.org/cold-storage/offline-transaction-signing/),
[multisig](https://docs.getmonero.org/multisignature/),
[Polyseed](https://github.com/tevador/polyseed),
[Tauri security](https://v2.tauri.app/security/).

## Licence

MIT. The bundled Monero binaries, Polyseed, rcgen and the Manrope and Outfit
typefaces carry their own licences, listed in THIRD-PARTY-NOTICES.md.
