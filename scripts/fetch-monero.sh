#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then
  echo 'This first build supports Apple Silicon macOS only.' >&2
  exit 1
fi
command -v gpg >/dev/null || { echo 'Install GnuPG first (brew install gnupg).' >&2; exit 1; }
mkdir -p work/download src-tauri/resources
mkdir -m 700 -p work/download/gnupg
base='https://downloads.getmonero.org/cli'
file='monero-mac-armv8-v0.18.5.1.tar.bz2'
expected='dba08921841e675384ce019fd7c93b59fe7b1e6edaa0a3cf0e3253e263f61864'
fingerprint='81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92'
curl --fail --location --proto '=https' --tlsv1.2 'https://raw.githubusercontent.com/monero-project/monero/v0.18.5.1/utils/gpg_keys/binaryfate.asc' -o work/download/binaryfate.asc
# The signed release manifest is committed so an upstream update cannot silently replace this build.
gpg --homedir work/download/gnupg --import work/download/binaryfate.asc
gpg --homedir work/download/gnupg --with-colons --fingerprint | grep -F "fpr:::::::::$fingerprint:" >/dev/null
gpg --homedir work/download/gnupg --verify docs/monero-hashes-signed.txt
grep -F "$expected  $file" docs/monero-hashes-signed.txt >/dev/null
curl --fail --location --proto '=https' --tlsv1.2 "$base/$file" -o "work/download/$file"
actual=$(shasum -a 256 "work/download/$file" | cut -d ' ' -f1)
[[ "$actual" == "$expected" ]] || { echo 'Monero archive hash mismatch; refusing extraction.' >&2; exit 1; }
tar -xjf "work/download/$file" -C work/download
source_binary='work/download/monero-aarch64-apple-darwin11-v0.18.5.1/monero-wallet-rpc'
actual_binary=$(shasum -a 256 "$source_binary" | cut -d ' ' -f1)
[[ "$actual_binary" == "$(cat src-tauri/resources/engine.sha256)" ]] || { echo 'Monero executable hash mismatch.' >&2; exit 1; }
cp "$source_binary" src-tauri/resources/monero-wallet-rpc
source_cli='work/download/monero-aarch64-apple-darwin11-v0.18.5.1/monero-wallet-cli'
actual_cli=$(shasum -a 256 "$source_cli" | cut -d ' ' -f1)
[[ "$actual_cli" == "$(cat src-tauri/resources/cli.sha256)" ]] || { echo 'Monero CLI executable hash mismatch.' >&2; exit 1; }
cp "$source_cli" src-tauri/resources/monero-wallet-cli
# Preserve the verified daemon for isolated integration tests only; it is not bundled in the wallet.
mkdir -p work/monero-aarch64-apple-darwin11-v0.18.5.1
cp work/download/monero-aarch64-apple-darwin11-v0.18.5.1/monerod work/monero-aarch64-apple-darwin11-v0.18.5.1/monerod
printf 'Verified Monero 0.18.5.1 is ready.\n'
