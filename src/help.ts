const PREFERENCE = "monero-by-astera:beginner-help";
let enabled = true;
try { enabled = localStorage.getItem(PREFERENCE) !== "off"; } catch { /* Session preference still works. */ }
let timer: ReturnType<typeof setTimeout> | undefined;
let target: HTMLElement | null = null;
let tooltip: HTMLDivElement | null = null;
let previousDescription: string | null = null;

export const helpEnabled = () => enabled;
export function setHelpEnabled(value: boolean) {
  enabled = value;
  try { localStorage.setItem(PREFERENCE, value ? "on" : "off"); } catch { /* Keep session choice. */ }
  hideHelp();
  annotateHelp();
}
export function hideHelp() {
  clearTimeout(timer);
  if (target && tooltip) {
    if (previousDescription === null) target.removeAttribute("aria-describedby");
    else target.setAttribute("aria-describedby", previousDescription);
  }
  tooltip?.remove();
  tooltip = null;
  target = null;
}

const modes: Record<string, string> = {
  local: "Uses a blockchain node running on this Mac. Start and sync monerod first; this wallet does not include a node.",
  "trusted-local": "Only for your own local node. Allows spent-output checks used by offline wallets and reveals more wallet metadata to that node.",
  remote: "Connects directly to a public HTTPS node after your consent. Its operator sees your IP and request timing. HTTPS does not hide your IP.",
  tor: "Connects to an onion node through your local Tor SOCKS proxy. A failure never silently switches to a direct connection.",
  vpn: "Uses your external VPN through normal macOS networking. Connect a VPN you trust and enable its kill switch; this app cannot enforce the tunnel.",
  offline: "No node connection. You can open a saved wallet and receive addresses, but must connect and sync to see new payments or send.",
};
const fields: Record<string, string> = {
  name: "The name of this encrypted wallet on your Mac. Different labels inside Addresses still belong to the same wallet.",
  password: "Unlocks the encrypted wallet file on this Mac. Enter it only here; do not share it in chat. It is different from your recovery phrase.",
  confirm: "Repeat the new wallet password exactly to avoid creating a wallet with a typing mistake.",
  old: "Your current wallet password. A password change updates local encryption, not your Monero addresses.",
  new: "Choose a strong new password for the wallet files stored on this Mac.",
  seed: "Your recovery words can restore control of the wallet. Keep them private and enter them only when recovering your own wallet.",
  passphrase: "An optional Polyseed encryption passphrase, separate from the wallet-file password. A wrong value can produce a different empty wallet.",
  height: "The block at which recovery starts scanning. Use an earlier known-safe height, or 0 if unknown. A height that is too late can miss your payments.",
  network: "Mainnet is real XMR. Stagenet and testnet use separate test coins and different addresses. Select the network that matches your wallet and node.",
  node: "The full URL of your chosen Monero node. Public direct/VPN connections require HTTPS. Check node tests reachability without wallet keys.",
  proxy: "The numeric loopback address of your Tor SOCKS proxy. Usually 127.0.0.1:9050 for standalone Tor or 127.0.0.1:9150 for Tor Browser. Use Check local Tor proxies to find a responding listener.",
  directConfirmed: "Allows this session to contact the chosen public HTTPS node after acknowledging the IP and timing implications.",
  vpnConfirmed: "Confirms you personally connected your trusted VPN and enabled its kill switch. The wallet cannot determine whether your VPN is working.",
  address: "Paste the recipient’s complete Monero address and verify it independently. The app checks its checksum and network before preparing a payment.",
  amount: "The amount to send in XMR. Fees are shown separately at review. Amounts retain all 12 decimal places without floating-point rounding.",
  priority: "A higher priority can increase the network fee. The exact fee is calculated before you approve a payment.",
  source: "Use all addresses, one address, or several. Selected sources never silently fall back to unselected funds.",
  allocation: "Automatic lets Monero choose contributions from selected addresses. Equal/custom sends one transaction per address, with separate fees and possible partial submission.",
  type: "Choose an advanced wallet workflow: Polyseed recovers 16 words, hardware uses your signing device, watch-only omits spend keys, file recovery restores an encrypted backup, and multisig shares signing between participants.",
  device: "Choose the hardware device you own. Connect and unlock it, then open its Monero app. Never enter hardware recovery words on this computer.",
  action: "Create a separate account or rename the selected one. Accounts organize groups of subaddresses under the same wallet recovery phrase.",
  operation: "Choose the advanced file operation you want to perform. The instructions below explain which device and files are required; review signing and broadcast operations carefully.",
  file: "Select the relevant local wallet exchange or backup manifest. Only use files from your own trusted backup or companion wallet.",
  experimental: "Multisig needs several participants to sign. It is experimental, and each participant must verify setup and retain its final encrypted backup.",
  backedUp: "Confirm that you have the recovery backup for your own signing device. Host wallet files do not replace the device’s recovery backup.",
  label: "A local description to help you recognize an address or account. Labels stay in the encrypted wallet and do not change the address.",
  files: "Choose the files for an advanced wallet exchange. Check their origin and follow the steps for offline signing or multisig.",
  fingerprint: "Compare the entire file fingerprint with the value recorded independently on your offline signer before approving broadcast.",
  threshold: "The minimum number of participants required to authorize a multisig payment. Multisig is experimental and needs each participant’s backup.",
  total: "The total number of multisig participants. Each must keep its own final encrypted wallet backup.",
  startupGuide: "Show the connection overview each time the app starts. Skipping the guide does not change your route or accept connection notices.",
  beginnerHelp: "Turn the delayed hover explanations on or off. This preference is stored only on this Mac.",
};
const actions: Record<string, string> = {
  refresh: "Scans the blockchain through your selected node and updates balances for every address in this wallet. Syncing never sends a payment.",
  lock: "Locks immediately, clears the wallet interface and stops the wallet engine. Command-L does the same.",
  connection: "Choose how this wallet reaches the Monero network. Saving settings alone does not unlock the wallet or connect it.",
  "change-connection": "Locks the wallet before letting you choose another node or privacy route. Your existing wallet files and addresses remain available.",
  "direct-option": "Review the public HTTPS route and its privacy implications. Nothing connects just because you open this option.",
  "vpn-option": "Choose an HTTPS node after connecting a VPN you trust on this Mac. The wallet cannot verify the VPN or its kill switch.",
  "retry-tor": "Retries only the currently selected route. It does not switch to another node or direct networking.",
  "stay-offline": "Locks the wallet and saves offline mode. New payments can still arrive on-chain, but balances update only after a later sync.",
  backup: "Shows recovery options after password verification. Keep recovery words offline and private; anyone with them can control the wallet.",
  "verify-backup": "Checks that you recorded your recovery words correctly. This is required before spending from a new software wallet.",
  "new-address": "Create a new subaddress immediately, without a label. You can add an optional label afterward. It shares your wallet and recovery phrase.",
  "copy-address": "Copies the selected receive address. The wallet clears its copy after 30 seconds if the clipboard still contains it.",
  conceal: "Hides amounts on screen for casual privacy. This is a display preference, not additional encryption.",
  accounts: "Organize separate groups of addresses in one wallet. Each account has its own balance; all share the wallet recovery phrase.",
  exchange: "Advanced tools for encrypted file backups, watch-only wallets, offline signing and multisig. Read each workflow before using it.",
  "show-exchange": "Locks the wallet and opens its private exchange folder. Some exchange files contain sensitive wallet metadata.",
  "advanced-setup": "Optional recovery and device workflows. Ordinary receiving and sending do not require these options.",
  "edit-connection": "Edit your saved route, node and network in the familiar connection guide. Editing locks an open wallet; no changes apply until you save.",
  "guide-route": "Set up this route. An open wallet locks before editing. Choosing a card does not connect or save anything.",
  "network-guide": "Read a beginner overview of local nodes, Tor, public HTTPS nodes and external VPNs. Reading it makes no network requests.",
  settings: "Change local app preferences, including beginner hover explanations. Wallet connection options are available separately.",
  password: "Changes the password that encrypts your local wallet files. It does not change the recovery phrase or addresses.",
};
const pages: Record<string, string> = {
  overview: "Your wallet’s last scanned balances, connection state and recent payments. Sync before relying on the displayed balance.",
  send: "Prepare a payment, review its recipient, amount and exact fee, then explicitly approve broadcast. Opening this page sends nothing.",
  receive: "Choose an existing address or create a fresh subaddress, then share its address or QR with the sender.",
  addresses: "Search your subaddresses and labels, and see each address’s balance from the last successful wallet scan.",
  activity: "Incoming and outgoing payments known to your wallet. Pending amounts may need more confirmations before spending.",
  advanced: "Optional settings for connections, accounts, backup, recovery, signing devices and offline workflows.",
};
const ids: Record<string, string> = {
  "find-nodes": "Check candidate nodes through your chosen route. Only reachable, synced nodes with a working fee RPC appear. No wallet keys or addresses are sent.",
  "check-node": "Checks only the selected node’s public status through the chosen route. It verifies HTTPS and network type but cannot prove the operator is honest.",
  "use-public-node": "Fills the URL with a public mainnet node. It does not save settings, connect or change your privacy route.",
  "public-node-select": "Two independent public HTTPS services are available as starting points. You can also enter your own node. Availability and honesty are not guaranteed.",
  "receive-select": "Choose which of your wallet’s addresses receives this payment. Every option belongs to the same wallet and recovery phrase.",
  "account-select": "Switch the displayed account. Spending uses the selected account, while all accounts remain part of the same wallet.",
  "request-amount": "Optional amount to include in the receive QR. It is a payment request, not a restriction on what the sender can send.",
};

function explanation(el: HTMLElement): string {
  if (el.dataset.helpCustom) return el.dataset.helpCustom;
  if (el.dataset.page) return pages[el.dataset.page] || "";
  if (el.dataset.action) return actions[el.dataset.action] || "";
  if (el.dataset.copy) return "Copies this public identifier temporarily. Verify copied destinations independently before sending a payment.";
  if (el.dataset.edit) return fields.label;
  if (el.dataset.tx) return "View this payment’s amount, confirmation count and transaction ID as reported by your synced wallet.";
  if (ids[el.id]) return ids[el.id];
  const name = el.getAttribute("name") || "";
  if (name === "mode") return `Connection route. ${modes[(el as HTMLSelectElement).value] || "Choose how to reach a node."}`;
  if (fields[name]) return fields[name];
  if (el.matches('input[type="search"]') || el.getAttribute("placeholder")?.toLowerCase().includes("search")) return "Search locally by an address or its label. The search is not sent to a public node.";
  if (el.tagName === "BUTTON") {
    const form = el.closest("form")?.id;
    if (form === "wallet-form") return "Opens this encrypted wallet using your password and selected route. After opening, sync to check incoming payments.";
    if (form === "connection-form") return "Saves the selected connection for future wallet sessions. Unlock and sync separately; no payment is sent.";
    if (form === "send-form") return "Prepares a payment for review. You will see its exact fee and destination before deciding whether to send.";
    if (form === "review-form" || form === "exchange-confirm-form") return "Broadcasts the exact reviewed payment after your password and confirmation checks. Review the destination and amount carefully.";
  }
  if (el.tagName === "TH") {
    const text = el.textContent?.trim().toLowerCase() || "";
    if (text.includes("balance")) return "Funds attributed to this address by the latest wallet scan. Some may still be awaiting unlock.";
    if (text.includes("available")) return "Confirmed funds currently spendable from this address, before transaction fees.";
    if (text.includes("label")) return fields.label;
    if (text.includes("address")) return "A public receive address belonging to this wallet. Share addresses for payment; never share recovery words.";
  }
  return "";
}

export function annotateHelp() {
  document.querySelectorAll<HTMLElement>("button,input,select,textarea,th,[data-help-custom]").forEach(el => {
    const help = explanation(el);
    if (help) el.dataset.help = help;
  });
  document.querySelectorAll<HTMLOptionElement>('select[name="mode"] option').forEach(option => {
    if (enabled) option.title = modes[option.value] || "";
    else option.removeAttribute("title");
  });
}

export function installHelp() {
  function schedule(el: HTMLElement | null) {
    if (el === target) return;
    hideHelp();
    if (!enabled || !el?.dataset.help) return;
    target = el;
    timer = setTimeout(() => {
      if (!enabled || target !== el || !el.isConnected) return;
      tooltip = document.createElement("div");
      tooltip.id = "beginner-tooltip";
      tooltip.className = "beginner-tooltip";
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = el.dataset.help || "";
      document.body.append(tooltip);
      previousDescription = el.getAttribute("aria-describedby");
      el.setAttribute("aria-describedby", [previousDescription, tooltip.id].filter(Boolean).join(" "));
      const box = el.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(12, Math.min(box.left, innerWidth - tip.width - 12))}px`;
      tooltip.style.top = `${Math.max(12, box.bottom + tip.height + 12 < innerHeight ? box.bottom + 8 : box.top - tip.height - 8)}px`;
    }, 1500);
  }
  document.addEventListener("pointerover", event => schedule((event.target as HTMLElement).closest<HTMLElement>("[data-help]")));
  document.addEventListener("pointerout", event => {
    if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) hideHelp();
  });
  document.addEventListener("focusin", event => schedule((event.target as HTMLElement).closest<HTMLElement>("[data-help]")));
  document.addEventListener("focusout", hideHelp);
  document.addEventListener("pointerdown", hideHelp);
  document.addEventListener("keydown", hideHelp);
  document.addEventListener("scroll", hideHelp, true);
  document.addEventListener("change", annotateHelp);
  window.addEventListener("blur", hideHelp);
}
