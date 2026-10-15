import { receivePicker, receivePickerRows } from "./receive-ui";
import { installCompactLayout } from "./compact-layout";
import { viewToggle, viewHint, initializeView, toggleView, dismissViewHint, showViewHint, refreshViewControls } from "./view-mode";
import { sourceOptions, sourcePayload, sourceReview, bindSources } from "./sources";
import { toast, clearToast } from "./toast";
import { torSetup, proxyResults, type ProxyCheck } from "./tor-ui";
import { networkGuide, startupGuideEnabled, setStartupGuideEnabled } from "./network-guide";
import { installHelp, annotateHelp, hideHelp, helpEnabled, setHelpEnabled } from "./help";
import { routeConsent, nodePresets } from "./connection-ui";
import {
  type ExchangeFiles,
  type ExchangeReview,
  setupForm,
  setupHint,
  exchangeForm,
  exchangeHint,
  exchangeReviewForm,
} from "./advanced-ui";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createIcons,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Shield,
  Lock,
  Settings2,
  LayoutDashboard,
  Wallet,
  Copy,
  Plus,
  Search,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  ChevronRight,
  X,
  CheckCheck,
  KeyRound,
  Wifi,
  WifiOff,
  Info,
  SlidersHorizontal,
  Clock,
  ArrowLeft,
  Activity,
  NotebookPen,
} from "lucide";
import QRCode from "qrcode";
import {
  type Snapshot,
  type Review,
  type Address,
  type Connection,
  xmr,
  escape as esc,
  amountValid,
} from "./types";
import "./style.css";
const root = document.querySelector<HTMLDivElement>("#app")!;
const defaultConnection: Connection = {
  network: "mainnet",
  mode: "local",
  node: "http://127.0.0.1:18081",
  proxy: "127.0.0.1:9050",
};
let state: Snapshot = {
  locked: true,
  wallets: [],
  connection: defaultConnection,
};
let page = "overview",
  gate = "create",
  conceal = false,
  busy = false,
  modal = "",
  seed = "",
  review: Review | null = null,
  search = "",
  selected = 1,
  receiveAmount = "",
  receiveSearch = "",
  labelReturnToPicker = false,
  generation = 0,
  nativeReady = false,
  syncing = false,
  syncStartedAt = 0,
  seedTimer: ReturnType<typeof setTimeout> | undefined,
  reviewDeadline = 0;
let exchangeFiles: ExchangeFiles = { directory: "", files: [] },
  exchangeReview: ExchangeReview | null = null;
const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const money = (n?: string) => (conceal ? "••••••" : xmr(n));
const network = () =>
  state.connection.network === "mainnet"
    ? "Monero mainnet"
    : `${state.connection.network} · test coins`;
const networkPill = () =>
  `<span class="pill ${state.connection.network !== "mainnet" ? "test" : ""}">${esc(network())}</span>`;
const iconSet = {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Shield,
  Lock,
  Settings2,
  LayoutDashboard,
  Wallet,
  Copy,
  Plus,
  Search,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  ChevronRight,
  X,
  CheckCheck,
  KeyRound,
  Wifi,
  WifiOff,
  Info,
  SlidersHorizontal,
  Clock,
  ArrowLeft,
  Activity,
  NotebookPen,
};
function icons() {
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.65 } });
}
async function api<T = Snapshot>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  const token = generation;
  const result = await invoke<T>("wallet_command", { action, payload });
  if (
    token !== generation &&
    !["lock", "snapshot", "cancel", "touch"].includes(action)
  )
    throw "Wallet session changed. Unlock and try again.";
  return result;
}
async function run(fn: () => Promise<void>) {
  if (busy) return;
  clearToast();
  busy = true;
  document.body.classList.add("busy");
  const started = performance.now();
  let polling = false;
  document.body.dataset.progress = "Working…";
  const progressTimer = setInterval(async () => {
    if (polling || !busy) return;
    polling = true;
    try {
      const progress = await invoke<{phase?:string}>("wallet_command",{action:"operation-status",payload:{}});
      if (busy) document.body.dataset.progress = `${progress.phase && progress.phase !== "Ready" ? progress.phase : "Working…"} · ${Math.floor((performance.now()-started)/1000)}s`;
    } catch { /* The native command supplies progress when available. */ }
    finally { polling = false; }
  }, 600);
  try {
    await fn();
  } catch (e) {
    toast(String(e), true);
    if (!state.locked && state.connection.mode === "tor") {
      const next = await api<Snapshot>("snapshot").catch(() => null);
      if (next?.syncError && !next.locked) {
        state = next;
        showModal("tor-failed");
      }
    }
  } finally {
    clearInterval(progressTimer);
    busy = false;
    document.body.classList.remove("busy");
    delete document.body.dataset.progress;
  }
}
function short(s: string) {
  return s.slice(0, 12) + "…" + s.slice(-8);
}
function status() {
  return state.connection.mode === "offline"
    ? "Offline mode"
    : state.lastSync
      ? "Synced " +
        new Date(state.lastSync * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : state.syncError
        ? "Sync incomplete"
        : "Waiting for sync";
}
function syncNotice() {
  if (state.locked || (state.lastSync && !state.syncError && !syncing)) return "";
  const mode = state.connection.mode;
  const noDaemon = /no connection to daemon|failed to connect to daemon/i.test(state.syncError || "");
  const local = ["local", "trusted-local"].includes(mode);
  const title = syncing ? "Scanning for your payments…"
    : mode === "offline" ? "Offline balance"
    : state.syncError ? (local && noDaemon ? "No local Monero node is available" : "Wallet sync did not complete")
    : "Sync to check incoming payments";
  const help = syncing
    ? "The first scan can take a while. Keep the wallet unlocked until it completes; later scans continue from saved progress. Five-minute inactivity locking remains enabled. Lock wallet stops the scan."
    : mode === "offline"
      ? "Connect to a node and sync to see new payments. Receiving to your existing addresses does not require the app to be online."
      : local
        ? "Local mode requires a running, synced monerod on this Mac. This lightweight wallet does not include a blockchain node. Start your node, or choose a remote connection."
        : mode === "tor"
          ? "Check your local Tor proxy and onion node. No direct fallback has occurred."
          : mode === "vpn"
            ? "Check your trusted VPN and its kill switch, then retry the HTTPS node. The wallet cannot verify or enforce your VPN tunnel."
            : "Retry your selected HTTPS node, or choose another node in connection settings. Public node operators can see your IP and request timing; use a proxy or VPN you trust for added privacy.";
  return `<section class="sync-notice" aria-label="Wallet sync status"><h2>${title}</h2>${syncing ? `<small id="sync-elapsed">Scanning from saved height ${state.height?.toLocaleString() || 0} · elapsed ${Math.floor((performance.now() - syncStartedAt) / 1000)}s</small>` : ""}<p>${help}</p><p><strong>Balances and address balances are from the last scan. A displayed zero does not confirm that no payment has arrived.</strong></p>${mode !== "offline" ? `<small class="wrap">Selected node: ${esc(state.connection.node)}</small>` : ""}${state.syncError && !syncing ? `<details><summary>Technical details</summary><code class="wrap">${esc(state.syncError)}</code></details>` : ""}${!syncing ? `<div class="button-row">${mode !== "offline" ? '<button class="button secondary" data-action="refresh">Retry sync</button>' : ""}<button class="text-button" data-action="change-connection">Lock & change connection</button></div>` : ""}</section>`;
}
function modalShell(title: string, body: string, wide = false) {
  return `<div class="overlay"><section role="dialog" aria-modal="true" aria-label="${esc(title)}" class="modal ${wide ? "wide" : ""}"><div class="modal-head"><h2>${title}</h2><div class="modal-tools">${viewToggle()}<button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon("x")}</button></div></div>${body}</section></div>`;
}
function render() {
  hideHelp();
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><button class="brand brand-link" data-page="overview" aria-label="Monero by Astera overview"><span class="brand-mark">a<span>✦</span></span><div>Monero<span>by Astera</span></div></button><button class="workspace wallet-home" data-page="overview" aria-label="Wallet overview"><span class="wallet-badge">${icon("wallet")}</span><div>${esc(state.wallet || "Your private wallet")}<small>${state.locked ? "Ready when you are" : "Personal wallet"}</small></div>${icon(state.locked ? "lock" : "shield")}</button><nav aria-label="Main navigation">${[
    ["overview", "layout-dashboard", "Overview"],
    ["send", "arrow-up-right", "Send"],
    ["receive", "arrow-down-left", "Receive"],
    ["addresses", "notebook-pen", "Addresses"],
    ["activity", "activity", "Activity"],
  ]
    .map(
      ([p, i, label]) =>
        `<button class="nav-item ${page === p ? "active" : ""}" data-page="${p}" ${state.locked ? "disabled" : ""}>${icon(i)}<span>${label}</span>${p === "addresses" && state.addresses ? `<span class="count">${state.addresses.length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="local-note">${icon("shield")}<div>Local by design<small>No account. No analytics.</small></div></div><button class="nav-item ${page === "advanced" ? "active" : ""}" data-page="advanced" ${state.locked ? "disabled" : ""}>${icon("sliders-horizontal")}<span>Advanced</span></button><button class="nav-item" data-action="${state.locked ? "connection" : "lock"}">${icon(state.locked ? "settings-2" : "lock")}<span>${state.locked ? "Connection settings" : "Lock wallet"}</span><kbd>${state.locked ? "" : "⌘ L"}</kbd></button><button class="nav-item" data-action="settings">${icon("settings-2")}<span>Settings</span></button><div class="version">MONERO BY ASTERA <span>0.2.8 · LOCAL BUILD</span></div></div></aside><div class="main-shell"><header class="topbar"><button class="compact-only compact-wallet text-button" data-page="overview" aria-label="Wallet overview">${icon("wallet")}<span>${esc(state.wallet || "Monero by Astera")}</span></button><div class="breadcrumb"><button class="breadcrumb-link" data-page="overview">Wallet</button> <span>/</span> ${state.locked ? "Welcome" : ({ overview: "Overview", send: "Send", receive: "Receive", addresses: "Addresses", activity: "Activity", advanced: "Advanced" } as Record<string, string>)[page]}</div><div class="top-actions">${!state.locked ? `<select id="account-select" aria-label="Active account">${(state.accounts || [{ index: 0, label: "Primary account" }]).map((a) => `<option value="${a.index}" ${a.index === (state.account || 0) ? "selected" : ""}>${esc(a.label || `Account ${a.index}`)}</option>`).join("")}</select>` : ""}${networkPill()}${!state.locked ? `<button class="icon-button" data-action="conceal" aria-label="${conceal ? "Show" : "Hide"} balances">${icon(conceal ? "eye-off" : "eye")}</button>` : ""}<span class="avatar">A</span><button class="compact-only icon-button" data-action="settings" aria-label="Settings">${icon("settings-2")}</button><button class="compact-only icon-button" data-action="${state.locked?'connection':'lock'}" aria-label="${state.locked?'Connection settings':'Lock wallet'}">${icon(state.locked?'wifi':'lock')}</button>${viewToggle()}</div></header><nav class="compact-nav" aria-label="Main navigation">${[["overview","Overview"],["send","Send"],["receive","Receive"],["addresses","Addresses"],["activity","Activity"],["advanced","Tools"]].map(([p,label])=>`<button type="button" class="${page===p?'active':''}" data-page="${p}" ${state.locked?'disabled':''} ${page===p?'aria-current="page"':''}>${label}</button>`).join('')}</nav><main>${viewHint()}${syncNotice()}${!state.locked && state.lastPayment && state.lastPayment.status !== "sent" ? `<button class="backup-banner" data-action="last-payment">A previous split needs review. Check submission status →</button>` : ""}${state.locked ? welcome() : content()}</main><footer><span>${icon("shield")} Keys stay under your control</span><span>${state.locked ? "Wallet locked" : esc(status())} <span class="status-dot ${state.lastSync ? "on" : ""}"></span></span></footer></div></div><div id="modal-root">${modalContent()}</div>`;
  root.querySelector<HTMLElement>(".app-shell")!.inert = Boolean(modal);
  refreshViewControls();
  icons();
  bindForms();
  annotateHelp();
  if (!state.locked && page === "receive") {
    void drawQr();
  }
  if (modal) {
    setTimeout(() => {
      const focus = document.querySelector<HTMLElement>("[data-guide-focus]") || document.querySelector<HTMLElement>(".modal input, .modal button:not(.icon-button):not(.view-toggle)");
      focus?.focus({preventScroll:modal === "receive-picker"});
      if (modal === "receive-picker" && document.documentElement.dataset.view !== "compact")
        document.querySelector("#receive-address-rows .selected")?.scrollIntoView({block:"nearest"});
    }, 0);
  }
}
function welcome() {
  const has = (state.wallets?.length || 0) > 0;
  return `<div class="welcome"><div class="eyebrow">A LITTLE MORE PRIVATE. A LOT MORE YOURS.</div><h1>Your Monero.<br>Your space.</h1><p class="lead">Your wallet, kept on this Mac.</p><div class="welcome-grid"><section class="card setup-card"><div class="tabs">${(has ? ["open", "create", "restore"] : ["create", "restore"]).map((t) => `<button class="${gate === t ? "active" : ""}" data-gate="${t}">${t === "open" ? "Open wallet" : t === "create" ? "Create wallet" : "Restore wallet"}</button>`).join("")}</div><form id="wallet-form"><h2>${gate === "open" ? "Welcome back" : gate === "create" ? "Start with your own wallet" : "Bring your wallet home"}</h2><p>${gate === "open" ? "Unlock the encrypted wallet on this Mac." : gate === "create" ? "Choose a password. Keep your recovery phrase safe." : "Restore with your recovery phrase and a safe scan height."}</p><label>Wallet name${gate === "open" ? `<select name="name">${state.wallets!.map((n) => `<option>${esc(n)}</option>`).join("")}</select>` : `<input name="name" placeholder="Personal" autocomplete="off" pattern="[A-Za-z0-9_-]{1,48}" required maxlength="48"/><small>Letters, numbers, hyphens and underscores.</small>`}</label>${gate === "restore" ? '<label>Recovery phrase<textarea name="seed" rows="3" required spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Your 25 words, separated by spaces"></textarea></label><label>Restore height<input name="height" type="number" min="0" step="1" value="0" required/><small>Use 0 if unknown. An earlier height is safe; a later one can miss payments.</small></label>' : ""}<label>${gate === "open" ? "Wallet password" : "Create a password"}<input name="password" type="password" required ${gate !== "open" ? 'minlength="12"' : ""} maxlength="1024" autocomplete="${gate === "open" ? "current-password" : "new-password"}" placeholder="${gate === "open" ? "Enter your password" : "At least 12 characters"}"/></label>${gate !== "open" ? '<label>Confirm password<input name="confirm" type="password" required autocomplete="new-password" placeholder="Enter it again"/></label>' : ""}${routeConsent(state.connection.mode)}<button class="button primary full" ${nativeReady ? "" : "disabled"}>${icon(gate === "open" ? "lock" : "arrow-right")}${gate === "open" ? "Unlock wallet" : gate === "create" ? "Create my wallet" : "Restore my wallet"}</button>${!nativeReady ? '<p class="notice">Open the native Monero by Astera app to use your wallet. This browser preview cannot access wallet keys.</p>' : ""}</form></section><div class="welcome-aside"><div class="orbital"><div class="orbit one"></div><div class="orbit two"></div><div class="monero-mark">M</div><span class="orbit-point"></span></div><h3>Local. Encrypted. Yours.</h3><p>No account or seed upload.</p><button class="connection-card" data-action="connection"><span class="small-icon">${icon(state.connection.mode === "offline" ? "wifi-off" : "wifi")}</span><span><b>${({ local: "Your local node", "trusted-local": "Your trusted local node", remote: "Your remote node", tor: "Your Tor node", vpn: "External VPN · HTTPS node", offline: "Offline wallet" } as Record<string, string>)[state.connection.mode]}</b><small>${state.connection.mode === "local" ? "Run a local node, or choose a remote connection" : state.connection.mode === "offline" ? "Create and receive addresses without a connection" : esc(state.connection.node)}</small></span>${icon("chevron-right")}</button>${state.connection.mode === "local" ? '<button class="button secondary" data-action="direct-option">Choose a public HTTPS node</button>' : ""}<button class="button secondary" data-action="advanced-setup">More wallet options</button><p class="build-note">Early local build · Independent security review is still needed before substantial funds.</p></div></div></div>`;
}
function heading(title: string, subtitle: string, extra = "") {
  const concise: Record<string,string> = {"A little peace of mind.":"Overview","Your activity.":"Activity","One wallet. Your addresses.":"Addresses","A little more control.":"Tools"};
  return `<div class="page-heading"><div><div class="eyebrow">YOUR WALLET, AT A GLANCE</div><h1>${concise[title] ? `<span class="full-only">${title}</span><span class="compact-only">${concise[title]}</span>` : title}</h1><p>${subtitle}</p></div>${extra}</div>`;
}
function content() {
  if (
    state.kind === "multisig" &&
    (!state.multisig?.ready || !state.backedUp) &&
    page !== "advanced"
  )
    return (
      heading(
        "Finish your shared wallet",
        "Setup and backups come before receiving funds.",
      ) +
      `<section class="card form-card"><h2>${state.multisig?.ready ? "Back up every participant" : "Complete the exchange rounds"}</h2><p>Each participant must complete setup, independently compare the final shared address, and copy encrypted participant backups to safe storage. The original software-wallet words do not restore the resulting multisig wallet.</p><button class="button primary" data-action="exchange">Continue multisig setup & backups</button></section>`
    );

  switch (page) {
    case "overview":
      return overview();
    case "send":
      return sendPage();
    case "receive":
      return receivePage();
    case "addresses":
      return addressesPage();
    case "activity":
      return activityPage();
    case "advanced":
      return advancedPage();
    default:
      return "";
  }
}
function overview() {
  return (
    heading(
      "A little peace of mind.",
      "Everything you need. Right where it belongs.",
      `<button class="button secondary" data-action="refresh" ${syncing ? "disabled" : ""}>${icon("refresh-cw")}${syncing ? "Syncing…" : "Sync wallet"}</button>`,
    ) +
    `${!state.backedUp ? `<button class="backup-banner" data-action="${state.kind === "multisig" ? "exchange" : "backup"}"><span class="small-icon">${icon("key-round")}</span><span><b>Make your wallet recoverable</b><small>${state.kind === "multisig" ? "Complete setup and export encrypted participant backups before receiving funds." : "Write down your recovery phrase, then verify three words."}</small></span><span>Back up wallet ${icon("arrow-right")}</span></button>` : ""}<section class="balance-card" data-help-custom="Your balance from the last wallet scan. Available funds are spendable; awaiting-unlock funds need more confirmations. Sync before relying on these amounts."><div class="balance-top"><span>${(state.accounts?.length || 1) > 1 ? "Account balance" : "Total balance"}</span><span class="private-pill">${icon("shield")} Stored locally</span></div><div class="balance-number">${money(state.balance)} <span>XMR</span></div><div class="balance-meta"><span><span class="status-dot on"></span> ${money(state.unlocked)} available</span><span>${money((BigInt(state.balance || "0") - BigInt(state.unlocked || "0")).toString())} awaiting unlock</span></div><div class="balance-bottom"><div class="button-row"><button class="button light" data-page="send">${icon("arrow-up-right")} Send</button><button class="button ghost" data-page="receive">${icon("arrow-down-left")} Receive</button></div><span>MONERO <span class="balance-symbol">ɱ</span></span></div></section><div class="summary-grid"><section class="card summary-card"><span class="small-icon gold">${icon("notebook-pen")}</span><div><span>Receive addresses</span><h3>${state.addresses?.length || 0}<small>one wallet, more privacy</small></h3></div><button class="icon-button" data-page="addresses" aria-label="View addresses">${icon("arrow-right")}</button></section><section class="card summary-card"><span class="small-icon green">${icon(state.lastSync ? "check-check" : "wifi")}</span><div><span>Wallet connection</span><h3 class="status-title" data-help-custom="Shows whether this wallet completed a scan in the current session. Scanned height is the last block processed, not proof that an incoming payment has arrived.">${esc(status())}<small>${state.connection.mode === "offline" ? "No network traffic" : `Scanned height ${state.height?.toLocaleString() || 0}`}</small></h3></div><button class="icon-button" data-page="advanced" aria-label="View connection">${icon("arrow-right")}</button></section></div><section class="card activity-card"><div class="section-heading"><h2>Recent activity</h2><button class="text-button" data-page="activity">View all ${icon("arrow-right")}</button></div>${txList((state.transactions || []).slice(0, 4))}</section><div class="tip">${icon("info")} A fresh subaddress helps keep incoming payments separate. All your addresses share the same recovery phrase.</div>`
  );
}
function sendPage() {
  return (
    heading(
      "Send Monero",
      "Prepare, review, then confirm.",
    ) +
    `<div class="two-columns"><section class="card form-card"><form id="send-form"><label>Recipient address<textarea name="address" rows="3" spellcheck="false" autocomplete="off" required placeholder="Paste the complete Monero address" maxlength="106"></textarea></label><label>Amount<div class="amount-input"><input name="amount" inputmode="decimal" placeholder="0.00" required autocomplete="off"/><span>XMR</span></div><small>${money(state.unlocked)} XMR available · fee calculated at review</small></label><details><summary>${icon("sliders-horizontal")} Transaction options</summary><label>Fee priority<select name="priority"><option value="0">Automatic</option><option value="1">Low</option><option value="2">Normal</option><option value="3">Elevated</option></select></label>${sourceOptions(state.addresses || [], state.kind)}</details><button class="button primary full" ${!state.backedUp ? "disabled" : ""}>Review payment ${icon("arrow-right")}</button>${!state.backedUp ? '<p class="notice">Verify your recovery phrase from Overview before sending.</p>' : ""}</form></section><aside class="side-explainer compact-explainer"><span class="large-icon">${icon("shield")}</span><h3>Review before sending.</h3><p>${state.kind === "watch" ? "Prepare an unsigned file for your offline signer." : state.kind === "multisig" ? "Prepare a file for your co-signers." : state.kind === "hardware" ? "Verify on your device before approving." : "The next screen shows the destination, exact fee and total."}</p>${networkPill()}<details><summary>Payment tips</summary><p>Verify the recipient independently. Use Transaction options to select sources or split an amount.</p></details></aside></div>`
  );
}
function receiveAddress(): Address | undefined {
  return (
    state.addresses?.find((a) => a.index === selected) ||
    state.addresses?.at(-1)
  );
}
function receivePage() {
  const a = receiveAddress();
  return (
    heading(
      "Receive Monero",
      "Share an address or its QR.",
      `<button class="button secondary" data-action="new-address">${icon("plus")} New address</button>`,
    ) +
    `<div class="two-columns receive-layout"><section class="card receive-card"><div class="section-heading"><h2>Receive Monero</h2>${networkPill()}</div><div class="receive-selector"><span>Receive to</span><button type="button" id="receive-select" class="receive-selector-button" data-action="receive-picker" aria-label="Choose receiving address" aria-haspopup="dialog" data-address-index="${a?.index ?? 0}" data-help-custom="Open the address grid to pick by index and full Monero address, or create an address without a label."><span><b>#${a?.index ?? 0}</b><code>${esc(short(a?.address || ""))}</code></span><span aria-hidden="true">⌄</span></button></div><div class="qr-wrap"><img id="qr" width="208" height="208" alt="Monero receive QR code"/></div><div class="address-tag">${a?.index === 0 ? "Primary address" : "Subaddress"} ${a?.index || 0}</div><code class="full-address">${esc(a?.address || "")}</code><button class="button secondary full" data-action="copy-address">${icon("copy")} Copy address</button><label class="request-amount">Request amount <span>optional</span><div class="amount-input"><input id="request-amount" inputmode="decimal" value="${esc(receiveAmount)}" placeholder="Any amount"/><span>XMR</span></div><small id="qr-caption">QR contains your address only.</small></label></section><aside class="side-explainer compact-explainer"><span class="large-icon">${icon("arrow-down-left")}</span><h3>Fresh addresses.<br>One wallet.</h3><p>Use a new address for each person or purpose.</p><button class="text-button" data-page="addresses">Manage addresses →</button><details><summary>Receiving tips</summary><p>Payments can arrive while you are offline. Sync later to update balances. Check the network before sharing.</p></details></aside></div>`
  );
}
async function drawQr() {
  const a = receiveAddress();
  const img = document.querySelector<HTMLImageElement>("#qr");
  if (!a || !img) return;
  const amount = document
    .querySelector<HTMLInputElement>("#request-amount")
    ?.value.trim();
  const valid = !amount || amountValid(amount);
  const caption = document.querySelector("#qr-caption");
  if (caption)
    caption.textContent = !valid
      ? "Enter a positive amount with up to 12 decimal places."
      : amount
        ? "QR includes the requested amount."
        : "QR contains your address only.";
  img.hidden = !valid;
  if (!valid) return;
  const uri = `monero:${a.address}${amount ? "?tx_amount=" + encodeURIComponent(amount) : ""}`;
  img.src = await QRCode.toDataURL(uri, {
    width: 416,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#111214", light: "#ffffff" },
  });
}
function addressRows() {
  const rows = (state.addresses || []).filter((a) =>
    `${a.label} ${a.address} ${a.index}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return rows.length
    ? rows
        .map(
          (a) =>
            `<tr><td><span class="address-avatar">${a.index === 0 ? "M" : String(a.index).padStart(2, "0")}</span><div><b>${esc(a.label || `Address ${a.index}`)}</b><small>${a.index === 0 ? "Primary address" : `Subaddress ${a.index}`}</small></div></td><td><button class="address-copy" data-copy="${esc(a.address)}" title="Copy full address">${esc(short(a.address))} ${icon("copy")}</button></td><td><span class="usage ${a.used ? "used" : ""}">${a.used ? "Used" : "Fresh"}</span></td><td class="numeric"><b>${money(a.balance)}</b><small>${money(a.unlocked)} available</small></td><td><button class="icon-button" data-receive="${a.index}" aria-label="Receive at address ${a.index}">${icon("arrow-down-left")}</button><button class="icon-button" data-edit="${a.index}" aria-label="Edit address ${a.index} label">${icon("notebook-pen")}</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="no-results">No matching addresses. Try a label or part of an address.</td></tr>';
}
function addressesPage() {
  return (
    heading(
      "One wallet. Your addresses.",
      "Keep your payments organised without reusing the same address.",
      `<button class="button primary" data-action="new-address">${icon("plus")} New address</button>`,
    ) +
    `<section class="card table-card"><div class="table-toolbar"><h2>All addresses <span class="count">${state.addresses?.length || 0}</span></h2><label class="search-box">${icon("search")}<input id="address-search" value="${esc(search)}" placeholder="Search labels or addresses" aria-label="Search addresses"/></label></div><table><thead><tr><th>Label</th><th>Address</th><th>Status</th><th class="numeric">Balance · XMR</th><th></th></tr></thead><tbody id="address-rows">${addressRows()}</tbody></table></section><div class="tip">${icon("info")} Balances reflect unspent outputs attributed to each address. Spending and change can move value between addresses; these are not independent wallets.</div>`
  );
}
function txList(txs: NonNullable<Snapshot["transactions"]>) {
  if (!txs.length)
    return `<div class="empty-state"><span class="empty-icon">${icon("arrow-down-left")}</span><h3>Your story starts here</h3><p>Incoming and outgoing payments will appear here after you sync.</p><button class="text-button" data-page="receive">Receive your first XMR ${icon("arrow-right")}</button></div>`;
  return `<div class="transactions">${txs.map((t) => `<button class="tx-row" data-tx="${esc(t.id)}"><span class="tx-icon ${["in", "pool"].includes(t.kind) ? "incoming" : ""}">${icon(["in", "pool"].includes(t.kind) ? "arrow-down-left" : "arrow-up-right")}</span><span class="tx-desc"><b>${({ in: "Received", pool: "Incoming · unconfirmed", out: "Sent", pending: "Sending · pending", failed: "Failed" } as Record<string, string>)[t.kind]}</b><small>${t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : short(t.id)}</small></span><span class="tx-total"><b>${["in", "pool"].includes(t.kind) ? "+" : "−"}${money(t.amount)} XMR</b><small>${t.confirmations || 0} confirmations</small></span>${icon("chevron-right")}</button>`).join("")}</div>`;
}
function activityPage() {
  return (
    heading(
      "Your activity.",
      "A local view of the payments in this wallet.",
      `<button class="button secondary" data-action="refresh" ${syncing ? "disabled" : ""}>${icon("refresh-cw")} ${syncing ? "Syncing…" : "Sync wallet"}</button>`,
    ) +
    `<section class="card activity-card"><div class="section-heading"><h2>All transactions</h2><span class="count">${state.transactions?.length || 0}</span></div>${txList(state.transactions || [])}</section>`
  );
}
function advancedPage() {
  return (
    heading(
      "A little more control.",
      "Optional settings, with their privacy tradeoffs made clear.",
    ) +
    `<div class="advanced-grid"><section class="card settings-card"><span class="small-icon gold">${icon("shield")}</span><h2>Wallet files & offline signing</h2><p>Encrypted file backups, watch-only companions and reviewed file-based signing. ${state.kind === "multisig" ? "Multisig is experimental. Each participant must independently approve the payment." : "Keep the signing device offline when using a cold wallet."}</p><button class="button secondary" data-action="exchange">Open wallet tools</button></section><section class="card settings-card"><span class="small-icon gold">${icon("wallet")}</span><h2>Accounts under one wallet</h2><p>Separate everyday spending, savings and projects. Switch accounts in the top bar to see each balance, addresses and activity.</p><button class="button secondary" data-action="accounts">Manage accounts</button></section><section class="card settings-card"><span class="small-icon gold">${icon("wifi")}</span><h2>Your node connection</h2><p>${state.connection.mode === "tor" ? "Onion node through your local SOCKS proxy. No direct fallback." : state.connection.mode === "local" ? "Connects only to a Monero node running on this computer." : state.connection.mode === "vpn" ? "HTTPS through macOS networking. Your external VPN must stay connected with its own kill switch. Monero by Astera cannot verify or enforce the tunnel." : state.connection.mode === "remote" ? "The remote operator can observe your IP and request timing. Your keys remain local." : "Network access is disabled in the wallet engine."}</p><dl><dt>Mode</dt><dd>${esc(state.connection.mode)}</dd><dt>Network</dt><dd>${esc(state.connection.network)}</dd><dt>Node</dt><dd class="wrap">${state.connection.mode === "offline" ? "None" : esc(state.connection.node)}</dd><dt>Last sync</dt><dd>${esc(status())}</dd></dl><button class="button secondary" data-action="change-connection">Lock & change connection ${icon("arrow-right")}</button></section><section class="card settings-card"><span class="small-icon green">${icon("lock")}</span><h2>Locking & screen privacy</h2><p>The wallet locks after five full minutes without interaction in this wallet. Typing, clicking, pointer movement, scrolling or returning to the wallet resets the timer. Switching apps and Escape do not lock it; Escape closes a dialog. Use Lock wallet or ⌘L to lock immediately. Background sync does not reset the timer. Locking stops the Monero engine and clears the interface.</p><ul class="check-list"><li>${icon("check")} Encrypted wallet files</li><li>${icon("check")} Authenticated localhost wallet engine</li><li>${icon("check")} Clipboard clears after 30 seconds, on lock or exit if unchanged</li><li>${icon("check")} Screen capture protection requested from macOS</li></ul><small>Screen capture restrictions depend on macOS and the capture tool. A compromised device can still expose an unlocked wallet.</small></section><section class="card settings-card"><span class="small-icon gold">${icon("key-round")}</span><h2>Recovery & password</h2><p>${state.kind === "hardware" ? "Recovery belongs to your hardware device. Back up its recovery words using the device maker’s instructions; never type them into Monero by Astera." : state.kind === "watch" ? "This companion has a view key and no spend key. Recover the spending wallet from its original backup." : state.kind === "multisig" ? "Back up every participant’s encrypted wallet files after setup. The original 25 words do not restore the resulting multisig wallet." : "Your 25 words restore access in compatible Monero wallets. File backups also preserve local labels. Polyseed restores can use the equivalent 25-word backup."}</p><div class="button-row"><button class="button secondary" data-action="${state.kind && state.kind !== "software" ? "exchange" : "backup"}">${icon("key-round")} ${state.kind && state.kind !== "software" ? "Wallet file backups" : state.backedUp ? "View recovery phrase" : "Back up wallet"}</button><button class="text-button" data-action="password">Change password</button></div></section><section class="card settings-card"><span class="small-icon">${icon("info")}</span><h2>Know the boundaries</h2><p>Subaddresses improve payment separation, but are part of one wallet. A seed holder can access all of them. Per-address input selection is available in Send.</p><p>Advanced workflows include device wallets, Polyseed recovery, watch-only companions, offline signing and experimental multisig. Review the workflow instructions before use. Device support needs physical-device validation.</p><small>Official engine 0.18.5.1 · Verified archive and pinned executable hash · No price feeds, telemetry or external explorer links.</small></section></div>`
  );
}
function connectionForm() {
  return `<form id="connection-form" class="connection-setup"><div class="connection-columns"><section class="route-setup"><div class="setup-step"><span>1</span><h3>Choose your route</h3></div><div class="two-fields"><label>Connection<select name="mode">${[["remote","Public HTTPS node"],["vpn","My trusted VPN + HTTPS"],["tor","Tor onion node"],["local","My local node"],["trusted-local","Trusted local · advanced"],["offline","Offline"]].map(([value,label])=>`<option value="${value}" ${state.connection.mode===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Network<select name="network">${["mainnet","stagenet","testnet"].map(n=>`<option ${state.connection.network===n?'selected':''}>${n}</option>`).join('')}</select></label></div><p class="compact-note" id="connection-hint"></p>${torSetup(state.connection.proxy)}<div id="connection-consent"></div></section><section id="node-setup"><div class="setup-step"><span id="node-step-number">2</span><h3 id="node-step-title">Choose a node</h3></div><div id="public-node-option" hidden>${nodePresets()}</div><label id="node-label">Node URL<input name="node" value="${esc(state.connection.node)}" placeholder="Or paste a custom node URL" autocomplete="off" spellcheck="false"/></label><button type="button" id="check-node" class="text-button">Check selected node</button><p id="node-check-result" role="status" class="node-check-result"></p></section></div><div class="connection-actions"><button class="button primary full">Save connection</button><small>Next: unlock your wallet, then sync.</small></div></form>`;
}
function modalContent() {
  if (!modal) return "";
  if (modal === "network-guide") return networkGuide(state.connection);
  if (modal === "receive-picker") return modalShell("Choose receiving address", receivePicker(state.addresses || [], receiveAddress()?.index ?? 0, receiveSearch), true);
  if (modal === "settings") return modalShell("Settings", `<div class="settings-preferences"><h3>Display</h3><p><span data-view-name>Full</span> view · use the arrows in the top bar to switch. Your choice is remembered.</p><button class="text-button" data-action="show-view-hint">Show the view introduction again</button><h3>Beginner help</h3><label class="check-label"><input id="beginner-help-setting" name="beginnerHelp" type="checkbox" ${helpEnabled() ? "checked" : ""}/> Show beginner hover explanations</label><p>Rest your pointer on a control for about one and a half seconds to see what it does. Keyboard focus also shows explanations. This preference is saved only on this Mac.</p><h3>Startup connection guide</h3><label class="check-label"><input name="startupGuide" type="checkbox" ${startupGuideEnabled() ? "checked" : ""}/> Show connection guide at startup</label><button class="text-button" data-action="network-guide">Read the connection guide</button><h3>Privacy defaults</h3><p>Automatic lock: five minutes without wallet interaction.<br>Immediate lock: Command-L or Lock wallet.<br>Clipboard copies: cleared after 30 seconds if unchanged.</p><button class="button secondary full" data-action="change-connection">Wallet connection settings</button><p>Monero by Astera · 0.2.8</p><button class="button primary full" data-action="close-modal">Done</button></div>`);
  if (["tor-failed", "sync-failed"].includes(modal))
    return modalShell(
      modal === "tor-failed" ? "Tor connection unavailable" : "Let’s reconnect your wallet",
      `<p>${modal === "tor-failed" ? "The Tor route failed. Monero by Astera has not switched to a direct connection." : "The scan did not complete. Your saved wallet and receive addresses are still available; displayed balances may be out of date."}</p><div class="button-stack"><button class="button primary full" data-action="retry-tor">${modal === "tor-failed" ? "Retry Tor" : "Retry current node"}</button><button class="button secondary full" data-action="change-connection">Choose another node</button><button class="button secondary full" data-action="vpn-option">Use my trusted VPN instead</button><button class="button secondary full" data-action="direct-option">Review direct HTTPS option</button><button class="text-button" data-action="stay-offline">Lock & stay offline</button></div><p class="notice">If Tor is unavailable, connect a VPN you trust on this computer and enable its kill switch before using an HTTPS node. A VPN alone cannot reach an onion address. Direct HTTPS is also available after its privacy notice. No route changes until you select and save one.</p>`,
    );
  if (modal === "advanced-setup")
    return modalShell(
      "Advanced wallet setup",
      setupForm(state, exchangeFiles),
      true,
    );
  if (modal === "exchange")
    return modalShell(
      "Offline signing & wallet files",
      exchangeForm(state, exchangeFiles),
      true,
    );
  if (modal === "exchange-review" && exchangeReview)
    return modalShell(
      "Review exchanged payment",
      exchangeReviewForm(exchangeReview),
      true,
    );
  if (modal === "account")
    return modalShell(
      "Manage accounts",
      `<p>Accounts have separate balances and subaddresses, with one recovery phrase. Spending uses only the selected account. Labels stay in your encrypted wallet.</p><form id="account-form"><label>Action<select name="action"><option value="create">Create another account</option><option value="rename">Rename selected account</option></select></label><label>Account label<input name="label" maxlength="80" required autocomplete="off"/></label><button class="button primary full">Save account</button></form><p class="notice">For recovery, recreate missing account indices in order, then sync from a safe restore height. Unused accounts and labels are not encoded in the seed.</p>`,
    );
  if (modal === "connection")
    return networkGuide(state.connection, connectionForm());
  if (modal.startsWith("edit:")) {
    const index = Number(modal.split(":")[1]);
    const a = state.addresses?.find(a => a.index === index);
    return modalShell(
      `Label address #${index}`,
      `<form id="address-form"><p>Optional, stored only in your encrypted wallet. Leave blank to remove the label.</p><code class="full-address">${esc(a?.address || "")}</code><label>Label<input name="label" maxlength="80" placeholder="Optional label" value="${esc(a?.label || "")}" autocomplete="off"/></label><button class="button primary full">Save label</button></form>`,
    );
  }
  if (modal === "backup")
    return modalShell(
      "Your recovery phrase",
      seed
        ? `<div class="notice">Write these words on paper, in order. Anyone with them can spend your XMR. This view clears after 60 seconds.</div><div class="seed-grid">${seed
            .split(" ")
            .map((w, i) => `<div><span>${i + 1}</span>${esc(w)}</div>`)
            .join(
              "",
            )}</div><button class="button primary full" data-action="verify-backup">I wrote them down ${icon("arrow-right")}</button>`
        : `<form id="seed-form"><p>Reveal your 25 words privately. Keep a paper copy somewhere safe, away from this Mac.</p><label>Wallet password<input name="password" type="password" autocomplete="current-password" required/></label><button class="button primary full">${icon("key-round")} Reveal recovery phrase</button></form>`,
      Boolean(seed),
    );
  if (modal === "verify-backup")
    return modalShell(
      "Check your paper backup",
      `<form id="backup-form"><p>Enter these words from your written recovery phrase.</p><div class="three-words">${[3, 11, 20].map((n) => `<label>Word ${n}<input name="word${n}" autocomplete="off" spellcheck="false" required/></label>`).join("")}</div><label>Wallet password<input name="password" type="password" autocomplete="current-password" required/></label><button class="button primary full">Verify backup ${icon("check")}</button></form>`,
    );
  if (modal === "review" && review)
    return modalShell(
      "Review your payment",
      `<p>Confirm the full destination with your recipient. <span id="review-countdown" role="status">Review expires in two minutes.</span></p>${networkPill()}<div class="review-destination"><span>RECIPIENT ADDRESS</span><code class="full-address">${esc(review.address)}</code></div><dl class="review-values">${sourceReview(review, state.addresses)}<dt>Amount</dt><dd>${xmr(review.amount)} XMR</dd><dt>Network fee</dt><dd>${xmr(review.fee)} XMR</dd><dt>Total leaving wallet</dt><dd><b>${xmr(review.total)} XMR</b></dd></dl>${review.parts?.length ? '<p class="notice">Each share is a separate transaction with its own fee. A partial submission is possible; remaining shares stop if a response is uncertain.</p>' : ""}<form id="confirm-form"><div class="review-credentials"><label>Last 6 characters of the recipient address<input name="suffix" required maxlength="6" autocomplete="off" spellcheck="false" placeholder="Check against the recipient’s address"/></label><label>Wallet password<input name="password" type="password" required autocomplete="current-password"/></label></div><button class="button primary full">${review.operation && !["relay", "relay-batch"].includes(review.operation) ? "Confirm & export" : "Confirm & send"} ${icon("arrow-up-right")}</button></form>`,
      Boolean(review.parts?.length),
    );
  if (modal === "password")
    return modalShell(
      "Change wallet password",
      `<form id="password-form"><label>Current password<input type="password" name="old" autocomplete="current-password" required/></label><label>New password<input type="password" name="new" minlength="12" maxlength="1024" autocomplete="new-password" required/></label><label>Confirm new password<input type="password" name="confirm" minlength="12" maxlength="1024" autocomplete="new-password" required/></label><button class="button primary full">Change password</button></form>`,
    );
  if (modal.startsWith("tx:")) {
    const t = state.transactions?.find((t) => t.id === modal.slice(3));
    if (!t) return "";
    return modalShell(
      "Transaction details",
      `<dl class="review-values"><dt>Status</dt><dd>${esc(t.kind)}</dd><dt>Amount</dt><dd>${xmr(t.amount)} XMR</dd><dt>Network fee</dt><dd>${xmr(t.fee)} XMR</dd><dt>Confirmations</dt><dd>${t.confirmations || 0}</dd><dt>Block height</dt><dd>${t.height || "Pending"}</dd></dl><label>Transaction ID<code class="full-address">${esc(t.id)}</code></label><button class="button secondary full" data-copy="${esc(t.id)}">${icon("copy")} Copy transaction ID</button>`,
    );
  }
  if (modal.startsWith("result:")) {
    const r = JSON.parse(modal.slice(7));
    if (Array.isArray(r.parts)) return modalShell(r.status === "sent" ? "Split payment submitted" : "Review split payment status", `<p>${r.status === "sent" ? "All shares were submitted. Sync to follow confirmations." : esc(r.message || "The full split was not submitted. Check each transaction before retrying.")}</p>${r.parts.map((p: any)=>`<div class="split-receipt"><b>${esc((r.account === (state.account ?? 0) ? state.addresses?.find(a=>a.index===p.source)?.label : undefined) || `Account ${r.account ?? 0} · address ${p.source}`)} · ${xmr(p.amount)} XMR</b><span class="receipt-status">${esc(p.status)}</span><code class="full-address">${esc(p.txid)}</code><button class="text-button" data-copy="${esc(p.txid)}">Copy transaction ID</button></div>`).join('')}${r.saved === false ? '<p class="notice">Receipt could not be saved. Keep these IDs before closing.</p>' : ''}`, true);
    if (r.status === "exported")
      return modalShell(
        "File exported",
        `<p>The file is in Monero by Astera’s local exchange folder. Copy it to trusted offline storage or the intended participant. Keep exchange files private.</p><label>File<code class="full-address">${esc(r.file)}</code></label>${r.fingerprint ? `<label>SHA-256 file fingerprint<code class="full-address">${esc(r.fingerprint)}</code></label><small>For offline payments, record this fingerprint on the signing device and compare it on the broadcasting device.</small>` : ""}${r.multisig ? `<p class="notice">${r.multisig.ready ? "Multisig setup complete. Compare the shared address, then back up every participant before receiving funds." : "Share this round’s file and continue setup with the next peer files."}</p>` : ""}<button class="button primary full" data-action="show-exchange">Lock & open exchange folder</button>`,
        true,
      );
    if (r.status === "imported")
      return modalShell(
        "File imported",
        '<p>Wallet data was imported and saved. Continue with the next step in your offline or multisig workflow.</p><button class="button primary full" data-action="exchange">Return to wallet files</button>',
      );
    return modalShell(
      r.status === "sent" ? "Payment submitted" : "Check payment status",
      `<span class="result-icon">${icon(r.status === "sent" ? "check" : "info")}</span><p>${r.status === "sent" ? "Your signed payment was submitted to the node. Sync to follow its confirmations." : esc(r.message)}</p>${r.saved === false ? '<p class="notice">Wallet cache could not be saved. Keep this transaction ID and check the chain before retrying.</p>' : ""}<label>Transaction ID<code class="full-address">${esc(r.txid)}</code></label><button class="button secondary full" data-copy="${esc(r.txid)}">${icon("copy")} Copy transaction ID</button>`,
    );
  }
  return "";
}
function clearSecrets() {
  reviewDeadline = 0;
  seed = "";
  review = null;
  exchangeReview = null;
  clearTimeout(seedTimer);
  document
    .querySelectorAll<HTMLInputElement>(
      "input[type=password],textarea[name=seed]",
    )
    .forEach((i) => (i.value = ""));
}
function closeModal() {
  const backToPicker = modal.startsWith("edit:") && labelReturnToPicker;
  labelReturnToPicker = false;
  if (["review", "exchange-review"].includes(modal))
    void api("cancel").catch(() => {});
  clearSecrets();
  modal = backToPicker ? "receive-picker" : "";
  render();
}
function showModal(value: string) {
  modal = value;
  render();
}
let nodeCheckGeneration = 0;
let proxyCheckGeneration = 0;
function connectionHint() {
  nodeCheckGeneration++;
  proxyCheckGeneration++;
  const form = document.querySelector<HTMLFormElement>("#connection-form");
  if (!form) return;
  const mode = (form.elements.namedItem("mode") as HTMLSelectElement).value;
  const node = form.elements.namedItem("node") as HTMLInputElement;
  if (["remote", "vpn"].includes(mode) && !node.value.startsWith("https://")) node.value = "";
  if (mode === "tor" && !node.value.includes(".onion")) node.value = "";
  if (["local", "trusted-local"].includes(mode) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/.test(node.value)) {
    const net = (form.elements.namedItem("network") as HTMLSelectElement).value;
    node.value = `http://127.0.0.1:${net === "mainnet" ? 18081 : net === "stagenet" ? 38081 : 28081}`;
  }
  document.querySelector("#connection-consent")!.innerHTML = routeConsent(mode as Connection["mode"], false);
  document.querySelector<HTMLButtonElement>("#check-node")!.disabled = mode === "offline";
  document.querySelector("#node-check-result")!.textContent = "";
  document.querySelector("#checked-nodes")!.innerHTML = "";
  document.querySelector("#discovery-status")!.textContent = "";
  document.querySelector<HTMLElement>("#node-setup")!.hidden = mode === "offline";
  document.querySelector<HTMLButtonElement>("#find-nodes")!.disabled = false;
  document.querySelector<HTMLElement>("#node-label")!.hidden =
    mode === "offline";
  document.querySelector<HTMLElement>("#proxy-label")!.hidden = mode !== "tor";
  document.querySelector<HTMLElement>("#tor-setup")!.hidden = mode !== "tor";
  document.querySelector("#tor-status")!.textContent = "";
  document.querySelector("#tor-proxies")!.innerHTML = "";
  document.querySelector<HTMLButtonElement>("#detect-tor")!.disabled = false;
  form.classList.toggle("tor-connection", mode === "tor");
  document.querySelector("#node-step-number")!.textContent = mode === "tor" ? "3" : "2";
  document.querySelector("#node-step-title")!.textContent = mode === "tor" ? "Check an onion node" : "Choose a node";
  document.querySelector<HTMLElement>("#public-node-option")!.hidden =
    !["remote", "vpn", "tor"].includes(mode) ||
    (form.elements.namedItem("network") as HTMLSelectElement).value !== "mainnet";
  document.querySelector("#connection-hint")!.textContent = ({
    local: "Start a synced monerod on this Mac first.",
    "trusted-local": "Only for your own local node. Allows advanced spent-output checks.",
    remote: "No blockchain download. Review the privacy notice before checking nodes.",
    vpn: "Connect your trusted VPN before checking nodes.",
    tor: "Set up Tor below, then check an onion node. There is no direct fallback.",
    offline: "Addresses and recovery remain available. Connect later to sync or send.",
  } as Record<string,string>)[mode];

}

async function detectTor() {
  const form = document.querySelector<HTMLFormElement>("#connection-form");
  if (!form || (form.elements.namedItem("mode") as HTMLSelectElement).value !== "tor") return;
  const proxy = (form.elements.namedItem("proxy") as HTMLInputElement).value.trim();
  const token = ++proxyCheckGeneration;
  const button = form.querySelector<HTMLButtonElement>("#detect-tor")!;
  const status = form.querySelector<HTMLElement>("#tor-status")!;
  const list = form.querySelector<HTMLElement>("#tor-proxies")!;
  button.disabled = true; list.innerHTML = "";
  status.textContent = "Checking local SOCKS proxies… No external connection.";
  try {
    const result = await api<{proxies:ProxyCheck[]}>("check-tor-proxies", {proxy});
    if (token !== proxyCheckGeneration || !form.isConnected) return;
    status.textContent = result.proxies.some(p=>p.ready)
      ? "A SOCKS proxy responded. Select it, then check an onion node to test the full route. This does not prove the proxy is Tor."
      : "No usable SOCKS proxy responded. Start Tor or connect Tor Browser, then try again.";
    list.innerHTML = proxyResults(result.proxies);
    list.querySelectorAll<HTMLButtonElement>("button[data-proxy]").forEach(choice=>choice.addEventListener("click",()=>{
      (form.elements.namedItem("proxy") as HTMLInputElement).value = choice.dataset.proxy!;
      connectionHint();
      status.textContent = `Selected ${choice.dataset.proxy}. Now check an onion node. Nothing is saved yet.`;
    }));
    annotateHelp();
  } catch (error) {
    if (token === proxyCheckGeneration && form.isConnected) status.textContent = String(error);
  } finally {
    if (token === proxyCheckGeneration && form.isConnected) button.disabled = false;
  }
}

async function discoverNodes() {
  const form = document.querySelector<HTMLFormElement>("#connection-form");
  if (!form) return;
  const data = new FormData(form);
  const connection = Object.fromEntries(["network","mode","node","proxy"].map(key => [key, String(data.get(key)||"")])) as Connection;
  const status = form.querySelector<HTMLElement>("#discovery-status")!;
  const list = form.querySelector<HTMLElement>("#checked-nodes")!;
  list.innerHTML = "";
  const directConfirmed = data.get("directConfirmed") === "on", vpnConfirmed = data.get("vpnConfirmed") === "on";
  if ((connection.mode === "remote" && !directConfirmed) || (connection.mode === "vpn" && !vpnConfirmed)) {
    status.textContent = "Accept the route notice above before checking public nodes."; return;
  }
  const token = ++nodeCheckGeneration;
  const button = form.querySelector<HTMLButtonElement>("#find-nodes")!;
  button.disabled = true;
  status.textContent = `Checking public nodes through ${connection.mode === 'tor' ? 'Tor (new circuits can be slow; allow up to 90 seconds)' : connection.mode === 'vpn' ? 'your external VPN route' : 'direct HTTPS'}…`;
  try {
    const result = await api<{nodes:{name:string;node:string;latencyMs:number;height:number}[];tested:number;expiresIn:number}>("discover-nodes",{connection,directConfirmed,vpnConfirmed});
    if (token !== nodeCheckGeneration || !form.isConnected) return;
    const expires = performance.now() + Math.min(result.expiresIn,120)*1000;
    status.textContent = result.nodes.length ? `${result.nodes.length} of ${result.tested} passed · availability, not operator trust.` : connection.mode === "tor" ? "The local proxy responded, but no onion nodes passed. Let Tor finish connecting, retry, or use a custom onion node. No direct connection was made." : "No nodes passed. Retry, use a custom node, or choose another route.";
    list.innerHTML = result.nodes.map(node=>`<button type="button" class="checked-node" data-node="${esc(node.node)}" data-help-custom="This node passed a live network, sync and fee check using your selected route. Availability can change; a check does not prove trustworthiness."><b>${esc(node.name)}</b><span>${(node.latencyMs/1000).toFixed(1)}s check · ${node.height.toLocaleString()} blocks</span><small>${esc(node.node)}</small></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>("button[data-node]").forEach(choice=>choice.addEventListener("click",()=>{
      if (performance.now() >= expires || token !== nodeCheckGeneration) { list.innerHTML="";status.textContent="Results expired. Check again for current options.";return; }
      (form.elements.namedItem("node") as HTMLInputElement).value=choice.dataset.node!;
      list.querySelectorAll("button").forEach(b=>b.classList.toggle("selected",b===choice));
      form.querySelector("#node-check-result")!.textContent="Selected a checked node. Save to use it on your next unlock.";
    }));
    annotateHelp();
    setTimeout(()=>{ if (form.isConnected && token===nodeCheckGeneration) {list.innerHTML="";status.textContent="Results expired. Check again for current options.";} }, Math.min(result.expiresIn,120)*1000);
  } catch (error) { if (form.isConnected && token===nodeCheckGeneration) status.textContent=String(error); }
  finally { if (form.isConnected && token===nodeCheckGeneration) button.disabled=false; }
}
async function checkNode() {
  const f = document.querySelector<HTMLFormElement>("#connection-form");
  if (!f) return;
  const d = new FormData(f);
  const connection = Object.fromEntries(["network", "mode", "node", "proxy"].map(k => [k, String(d.get(k) || "")]));
  const inputKey = JSON.stringify(connection);
  const button = f.querySelector<HTMLButtonElement>("#check-node")!;
  const result = f.querySelector<HTMLElement>("#node-check-result")!;
  if ((connection.mode === "remote" && d.get("directConfirmed") !== "on") || (connection.mode === "vpn" && d.get("vpnConfirmed") !== "on")) {
    result.textContent = "Read the connection notice and tick its acknowledgement before checking this node.";
    return;
  }
  const checkToken = ++nodeCheckGeneration;
  button.disabled = true;
  result.textContent = "Checking this node through the selected route… No wallet keys or addresses are sent.";
  try {
    const checked = await api<{ready: boolean; height: number; network: string; message: string}>("check-node", {
      connection,
      directConfirmed: d.get("directConfirmed") === "on",
      vpnConfirmed: d.get("vpnConfirmed") === "on",
    });
    const current = new FormData(f);
    if (checkToken !== nodeCheckGeneration || document.querySelector("#connection-form") !== f || inputKey !== JSON.stringify(Object.fromEntries(["network", "mode", "node", "proxy"].map(k => [k, String(current.get(k) || "")])))) return;
    result.textContent = `${checked.ready ? "Ready" : "Not ready"} · ${checked.network} · Node height ${checked.height.toLocaleString()}. ${checked.message}`;
  } catch (e) {
    if (checkToken === nodeCheckGeneration && document.querySelector("#connection-form") === f) result.textContent = String(e);
  } finally {
    if (checkToken === nodeCheckGeneration && document.querySelector("#connection-form") === f) button.disabled = (f.elements.namedItem("mode") as HTMLSelectElement).value === "offline";
  }
}
function form(
  id: string,
  handler: (data: FormData, f: HTMLFormElement) => Promise<void>,
) {
  const el = document.querySelector<HTMLFormElement>("#" + id);
  el?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const data = new FormData(el);
    void run(() => handler(data, el));
  });
}
function bindForms() {
  bindSources();
  document.querySelector<HTMLInputElement>('input[name="startupGuide"]')?.addEventListener("change", event => {
    setStartupGuideEnabled((event.target as HTMLInputElement).checked);
  });
  document.querySelector<HTMLInputElement>("#beginner-help-setting")?.addEventListener("change", event => {
    setHelpEnabled((event.target as HTMLInputElement).checked);
  });
  form("advanced-setup-form", async (d, f) => {
    if (d.get("password") !== d.get("confirm")) throw "Passwords do not match";
    const type = String(d.get("type"));
    if (type === "create-multisig" && d.get("experimental") !== "on")
      throw "Acknowledge experimental multisig";
    generation++;
    receiveAmount = ""; receiveSearch = ""; labelReturnToPicker = false;
    const result = await api<any>(type, {
      name: String(d.get("name")),
      password: String(d.get("password")),
      seed: String(d.get("seed") || "")
        .trim()
        .replace(/\s+/g, " "),
      passphrase: String(d.get("passphrase") || ""),
      device: String(d.get("device") || ""),
      height: Number(d.get("height") || 0),
      file: String(d.get("file") || ""),
      threshold: Number(d.get("threshold") || 0),
      total: Number(d.get("total") || 0),
      backedUp: d.get("backedUp") === "on",
      vpnConfirmed: d.get("vpnConfirmed") === "on",
      directConfirmed: d.get("directConfirmed") === "on",
    });
    f.reset();
    state = await api("snapshot");
    page = "overview";
    modal =
      type === "create-multisig" ? "result:" + JSON.stringify(result) : "";
    render();
  });
  form("exchange-form", async (d, f) => {
    const op = String(d.get("operation")),
      files = d.getAll("files").map(String),
      password = String(d.get("password") || "");
    if (op.startsWith("sign") || op.startsWith("broadcast")) {
      if (files.length !== 1) throw "Select exactly one transaction file";
      exchangeReview = await api<ExchangeReview>("review-exchange", {
        operation: op,
        file: files[0],
      });
      reviewDeadline = performance.now() + exchangeReview.expiresIn * 1000;
      showModal("exchange-review");
      return;
    }
    const action = ["backup-files", "multisig-step", "export-kex"].includes(op)
      ? op
      : "exchange";
    const result = await api<any>(action, { operation: op, files, password });
    f.reset();
    state = await api("snapshot");
    modal = "result:" + JSON.stringify(result);
    render();
  });
  form("exchange-confirm-form", async (d, f) => {
    if (!exchangeReview || performance.now() >= reviewDeadline)
      throw "Payment review expired";
    const result = await api<any>("confirm-exchange", {
      id: exchangeReview.id,
      password: String(d.get("password")),
      fingerprint: String(d.get("fingerprint") || "")
        .trim()
        .toLowerCase(),
    });
    f.reset();
    exchangeReview = null;
    state = await api("snapshot");
    modal = "result:" + JSON.stringify(result);
    render();
  });
  document.querySelector("#setup-type")?.addEventListener("change", setupHint);
  setupHint();
  document
    .querySelector("#exchange-operation")
    ?.addEventListener("change", exchangeHint);
  exchangeHint();
  form("account-form", async (d) => {
    state = await api("account", {
      label: String(d.get("label")),
      index: d.get("action") === "rename" ? state.account || 0 : null,
    });
    selected = 0;
    search = "";
    modal = "";
    render();
  });
  document.querySelector("#account-select")?.addEventListener(
    "change",
    (ev) =>
      void run(async () => {
        state = await api("account", {
          index: Number((ev.target as HTMLSelectElement).value),
        });
        clearSecrets();
        modal = "";
        selected = 0;
        receiveAmount = ""; receiveSearch = ""; labelReturnToPicker = false;
        search = "";
        render();
      }),
  );
  form("wallet-form", async (d, f) => {
    const password = String(d.get("password") || "");
    if (gate !== "open" && password !== d.get("confirm"))
      throw "Passwords do not match";
    const payload = {
      name: String(d.get("name")),
      vpnConfirmed: d.get("vpnConfirmed") === "on",
      directConfirmed: d.get("directConfirmed") === "on",
      password,
      seed: String(d.get("seed") || "")
        .trim()
        .replace(/\s+/g, " "),
      height: Number(d.get("height") || 0),
    };
    const token = ++generation;
    const action = gate;
    const next = await api<Snapshot>(action, payload);
    f.reset();
    payload.password = "";
    payload.seed = "";
    if (token !== generation) return;
    state = next;
    page = "overview";
    modal = action === "create" ? "backup" : "";
    render();
  });
  form("connection-form", async (d) => {
    state = await api("configure", Object.fromEntries(d));
    gate = state.wallets?.length ? "open" : "create";
    modal = "";
    render();
    toast("Connection saved. Unlock your wallet, then press Sync wallet to check for payments.");
  });
  form("address-form", async (d) => {
    const index = Number(modal.split(":")[1]);
    const backToPicker = labelReturnToPicker;
    state = await api("address", { label: String(d.get("label") || "").trim(), index });
    labelReturnToPicker = false;
    modal = backToPicker ? "receive-picker" : "";
    render();
    toast(d.get("label")?.toString().trim() ? "Label updated" : "Label removed");
  });
  form("seed-form", async (d, f) => {
    const token = generation;
    const result = await api<{ key: string }>("seed", {
      password: String(d.get("password")),
    });
    f.reset();
    if (token !== generation) return;
    seed = result.key;
    render();
    seedTimer = setTimeout(() => {
      seed = "";
      if (modal === "backup") {
        render();
        toast("Recovery phrase hidden");
      }
    }, 60000);
  });
  form("backup-form", async (d, f) => {
    state = await api("backup", {
      password: String(d.get("password")),
      words: [3, 11, 20].map((n) => String(d.get("word" + n)).trim()),
    });
    f.reset();
    modal = "";
    render();
    toast("Recovery phrase verified");
  });
  form("send-form", async (d) => {
    const amount = String(d.get("amount")).trim();
    if (!amountValid(amount))
      throw "Enter a positive XMR amount with up to 12 decimal places";
    const token = generation;
    review = await api<Review>("prepare", {
      address: String(d.get("address")).trim(),
      amount,
      priority: Number(d.get("priority")),
      ...sourcePayload(d, amount),
    });
    if (token !== generation) {
      review = null;
      return;
    }
    reviewDeadline = performance.now() + review.expiresIn * 1000;
    showModal("review");
  });
  form("confirm-form", async (d, f) => {
    if (!review || performance.now() >= reviewDeadline)
      throw "Payment review expired. Review it again.";
    if (String(d.get("suffix")) !== review.address.slice(-6))
      throw "The last 6 characters do not match";
    const result = await api<NonNullable<Snapshot["lastPayment"]>>("send", {
      id: review.id,
      password: String(d.get("password")),
    });
    f.reset();
    review = null;
    if (Array.isArray(result.parts)) state.lastPayment = result;
    modal = "result:" + JSON.stringify(result);
    page = "activity";
    render();
    const next = await api<Snapshot>("snapshot").catch(() => null);
    if (next) { state = next; render(); }
  });
  form("password-form", async (d, f) => {
    if (d.get("new") !== d.get("confirm")) throw "Passwords do not match";
    await api("password", {
      old: String(d.get("old")),
      new: String(d.get("new")),
    });
    f.reset();
    modal = "";
    render();
    toast("Wallet password changed");
  });
  document.querySelector("#address-search")?.addEventListener("input", (ev) => {
    search = (ev.target as HTMLInputElement).value;
    document.querySelector("#address-rows")!.innerHTML = addressRows();
    icons();
  });
  document.querySelector("#receive-picker-search")?.addEventListener("input", ev => {
    receiveSearch = (ev.target as HTMLInputElement).value;
    document.querySelector("#receive-address-rows")!.innerHTML = receivePickerRows(state.addresses || [], receiveAddress()?.index ?? 0, receiveSearch);
    annotateHelp();
  });
  document.querySelector("#request-amount")?.addEventListener("input", ev => {
    receiveAmount = (ev.target as HTMLInputElement).value;
    void drawQr();
  });
  document
    .querySelectorAll("#connection-form select")
    .forEach((select) => select.addEventListener("change", connectionHint));
  document.querySelector("#detect-tor")?.addEventListener("click", () => void detectTor());
  document.querySelector("#find-nodes")?.addEventListener("click", () => void discoverNodes());
  document.querySelector("#check-node")?.addEventListener("click", () => void checkNode());
  document.querySelector("#connection-form input[name=proxy]")?.addEventListener("input", connectionHint);
  document.querySelector("#connection-form input[name=node]")?.addEventListener("input", () => {
    document.querySelector("#node-check-result")!.textContent = "";
    document.querySelectorAll(".checked-node").forEach(b=>b.classList.remove("selected"));
  });
  connectionHint();
}
async function sync() {
  if (syncing || state.locked) return;
  syncing = true;
  syncStartedAt = performance.now();
  render();
  const elapsedTimer = setInterval(() => {
    const el = document.querySelector("#sync-elapsed");
    if (el) el.textContent = `Scanning from saved height ${state.height?.toLocaleString() || 0} · elapsed ${Math.floor((performance.now() - syncStartedAt) / 1000)}s`;
  }, 1000);
  const token = generation;
  try {
    const next = await api<Snapshot>("refresh");
    if (token === generation) {
      state = next;
      toast("Wallet synced");
    }
  } catch (e) {
    if (token === generation) {
      state.syncError = String(e);
      state.lastSync = undefined;
      toast("Sync did not complete. Choose a recovery option below.", true);
      modal = state.connection.mode === "tor" ? "tor-failed" : "sync-failed";
    }
  } finally {
    clearInterval(elapsedTimer);
    syncing = false;
    if (token === generation) render();
  }
}
async function lockWallet() {
  generation++;
  receiveAmount = ""; receiveSearch = ""; labelReturnToPicker = false;
  clearSecrets();
  modal = "";
  state = {
    locked: true,
    connection: state.connection,
    wallets: [state.wallet || ""].filter(Boolean),
  };
  page = "overview";
  render();
  try {
    state = await api("lock");
    gate = state.wallets?.length ? "open" : "create";
    render();
  } catch (e) {
    toast(String(e), true);
  }
}
root.addEventListener("click", (event) => {
  const displayAction = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")?.dataset.action;
  if (displayAction === "toggle-view") { hideHelp(); void toggleView(); return; }
  if (displayAction === "show-view-hint") { showViewHint(); return; }
  if (displayAction === "dismiss-view-hint") { dismissViewHint(); return; }
  const target = event.target as HTMLElement;
  const pickedRow = target.closest<HTMLElement>("tr[data-pick-address]");
  if (pickedRow && !target.closest("button[data-edit]") && !busy && !state.locked) {
    const index = Number(pickedRow.dataset.pickAddress);
    if (!state.addresses?.some(a => a.index === index)) return;
    selected = index; modal = ""; page = "receive"; render(); return;
  }
  const b = target.closest<HTMLElement>("button");
  if (!b || b.hasAttribute("disabled") || (busy && b.dataset.action !== "lock"))
    return;
  const p = b.dataset.page;
  if (p) {
    page = p;
    render();
    return;
  }
  if (b.dataset.gate) {
    gate = b.dataset.gate;
    render();
    return;
  }
  if (b.dataset.copy) {
    void run(async () => {
      await api("copy", { text: b.dataset.copy });
      toast("Copied · clears in 30 seconds if unchanged");
    });
    return;
  }
  if (b.dataset.receive) {
    selected = Number(b.dataset.receive);
    page = "receive";
    modal = "";
    render();
    return;
  }
  if (b.dataset.edit) {
    labelReturnToPicker = modal === "receive-picker";
    showModal("edit:" + b.dataset.edit);
    return;
  }
  if (b.dataset.tx) {
    showModal("tx:" + b.dataset.tx);
    return;
  }
  switch (b.dataset.action) {
    case "last-payment":
      if (state.lastPayment) showModal("result:" + JSON.stringify(state.lastPayment));
      break;
    case "edit-connection":
    case "guide-route":
      void run(async () => {
        if (!state.locked) await lockWallet();
        showModal("connection");
        if (b.dataset.action === "guide-route") {
          const form = document.querySelector<HTMLFormElement>("#connection-form")!;
          const mode = b.dataset.mode!;
          (form.elements.namedItem("mode") as HTMLSelectElement).value = mode;
          if (mode !== state.connection.mode) (form.elements.namedItem("node") as HTMLInputElement).value = "";
          connectionHint();
        }
      });
      break;
    case "network-guide":
      showModal("network-guide");
      break;
    case "settings":
      showModal("settings");
      break;
    case "retry-tor":
      modal = "";
      void sync();
      break;
    case "stay-offline":
      void run(async () => {
        await lockWallet();
        state = await api("configure", {
          ...state.connection,
          mode: "offline",
        });
        render();
      });
      break;
    case "direct-option":
    case "vpn-option":
      void run(async () => {
        await lockWallet();
        showModal("connection");
        const f = document.querySelector<HTMLFormElement>("#connection-form")!;
        (f.elements.namedItem("mode") as HTMLSelectElement).value = b.dataset.action === "direct-option" ? "remote" : "vpn";
        (f.elements.namedItem("node") as HTMLInputElement).value = "";
        connectionHint();
      });
      break;
    case "advanced-setup":
      void run(async () => {
        if (!state.locked) await lockWallet();
        exchangeFiles = await api<ExchangeFiles>("exchange-files");
        showModal("advanced-setup");
      });
      break;
    case "exchange":
      void run(async () => {
        exchangeFiles = await api<ExchangeFiles>("exchange-files");
        showModal("exchange");
      });
      break;
    case "show-exchange":
      void run(async () => {
        await lockWallet();
        await api("show-exchange");
      });
      break;
    case "accounts":
      showModal("account");
      break;
    case "conceal":
      conceal = !conceal;
      render();
      break;
    case "lock":
      void lockWallet();
      break;
    case "refresh":
      void sync();
      break;
    case "connection":
      showModal("network-guide");
      break;
    case "change-connection":
      void run(async () => {
        if (!state.locked) await lockWallet();
        showModal("network-guide");
      });
      break;
    case "backup":
      showModal("backup");
      break;
    case "verify-backup":
      seed = "";
      clearTimeout(seedTimer);
      showModal("verify-backup");
      break;
    case "password":
      showModal("password");
      break;
    case "receive-picker":
      receiveSearch = "";
      showModal("receive-picker");
      break;
    case "new-address":
      void run(async () => {
        const previous = new Set((state.addresses || []).map(a => a.index));
        const next = await api<Snapshot>("address", {label:""});
        state = next;
        const created = next.addresses?.find(a => !previous.has(a.index));
        if (created) selected = created.index;
        receiveSearch = "";
        showModal("receive-picker");
        toast(created ? `Address #${created.index} created. Label optional.` : "Address list updated.");
      });
      break;
    case "close-modal":
      closeModal();
      break;
    case "copy-address":
      void run(async () => {
        await api("copy", { text: receiveAddress()?.address });
        toast("Address copied · clears in 30 seconds if unchanged");
      });
      break;
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
    e.preventDefault();
    void lockWallet();
  }
  if (e.key === "Escape") {
    if (modal) closeModal();
  }
  if (e.key === "Tab" && modal) {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>(
        '.modal button:not([disabled]),.modal input,.modal select,.modal textarea,.modal [tabindex="0"]',
      ),
    ].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[hidden],.compact-away,.compact-pager[data-single="true"]') && !el.hasAttribute('disabled'));
    const first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
setInterval(() => {
  if (modal === "exchange-review" && exchangeReview) {
    const left = Math.max(
      0,
      Math.ceil((reviewDeadline - performance.now()) / 1000),
    );
    const label = document.querySelector("#exchange-countdown");
    if (label)
      label.textContent = left
        ? `Review expires in ${left}s.`
        : "Review expired. Close and review again.";
    if (!left) {
      document.querySelector<HTMLButtonElement>(
        "#exchange-confirm-form button",
      )!.disabled = true;
      document.querySelector<HTMLInputElement>(
        "#exchange-confirm-form input[type=password]",
      )!.value = "";
      exchangeReview = null;
      void api("cancel").catch(() => {});
    }
    return;
  }
  if (modal !== "review" || !review) return;
  const left = Math.max(
    0,
    Math.ceil((reviewDeadline - performance.now()) / 1000),
  );
  const el = document.querySelector("#review-countdown");
  if (el)
    el.textContent = left
      ? `Review expires in ${left}s.`
      : "Review expired. Close this dialog and review the payment again.";
  if (!left) {
    document.querySelector<HTMLButtonElement>(
      "#confirm-form button",
    )!.disabled = true;
    document.querySelector<HTMLInputElement>(
      "#confirm-form input[type=password]",
    )!.value = "";
    review = null;
    void api("cancel").catch(() => {});
  }
}, 1000);
let lastActivitySent = -Infinity;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
function reportActivity() {
  clearTimeout(activityTimer);
  activityTimer = undefined;
  if (state.locked) return;
  lastActivitySent = performance.now();
  void api("touch").catch(() => {});
}
function userActivity(event: Event) {
  if (!event.isTrusted || state.locked) return;
  const delay = 500 - (performance.now() - lastActivitySent);
  if (delay <= 0) reportActivity();
  else {
    // Keep the final input in a burst: leading-only throttling locks too early.
    clearTimeout(activityTimer);
    activityTimer = setTimeout(reportActivity, delay);
  }
}
for (const type of ["pointerdown", "pointermove", "click", "keydown", "wheel", "input"])
  document.addEventListener(type, userActivity, { capture: true, passive: true });
window.addEventListener("focus", userActivity);
window.addEventListener("blur", () => {
  // Hide an exposed recovery phrase when leaving, without ending the wallet session.
  if (seed) closeModal();
});
installHelp();
async function init() {
  installCompactLayout();
  await initializeView();
  try {
    state = await api("snapshot");
    gate = state.wallets?.length ? "open" : "create";
    nativeReady = true;
    if (isTauri())
      await listen("wallet-locked", () => {
        // Settings contain no wallet keys; retain a locked connection form when
        // the user switches to their VPN app. Still clear any password fields.
        if (state.locked && ["connection", "network-guide"].includes(modal)) {
          clearSecrets();
          return;
        }
        generation++;
        receiveAmount = ""; receiveSearch = ""; labelReturnToPicker = false;
        clearSecrets();
        modal = "";
        state = {
          locked: true,
          connection: state.connection,
          wallets: state.wallet ? [state.wallet] : state.wallets,
        };
        render();
        void api<Snapshot>("snapshot").then((next) => {
          if (next.locked) {
            state = next;
            gate = state.wallets?.length ? "open" : "create";
            render();
          }
        });
      });
  } catch {
    nativeReady = false;
  }
  if (state.locked && startupGuideEnabled()) modal = "network-guide";
  render();
}
void init();
