`Monero by Astera.app` for Apple Silicon Macs, macOS 12 or newer, with Monero 0.18.5.1 bundled. The engine was downloaded by the build from getmonero.org, checked against the project's signed release manifest, and its hash re-verified in the finished bundle; the app checks it again before every launch.

The build is ad-hoc signed and not notarised. On first launch either right-click the app and choose Open, or clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine "Monero by Astera.app"
```

Not independently audited. Read SECURITY.md before keeping meaningful value in it. Wallet data lives in `~/Library/Application Support/local.astra.xmr/`.
