import { routeConsent } from "./connection-ui";
import { type Snapshot, escape as esc, xmr } from "./types";
export type ExchangeFiles = { directory: string; files: string[] };
export type ExchangeReview = {
  id: string;
  operation: string;
  network: string;
  fingerprint: string;
  expiresIn: number;
  descriptions: {
    transactions: {
      recipients: { address: string; amount: string }[];
      fee: string;
      total: string;
      change: string;
      changeAddress: string;
      ringSize: number;
      paymentId: string;
    }[];
  };
};
const options = (files: ExchangeFiles) =>
  files.files
    .map((f) => `<option value="${esc(f)}">${esc(f)}</option>`)
    .join("");
export function setupForm(s: Snapshot, f: ExchangeFiles) {
  return `<form id="advanced-setup-form"><label>Wallet type<select aria-label="Wallet type" name="type" id="setup-type"><option value="polyseed">Restore 16-word Polyseed</option><option value="hardware">Connect a hardware wallet</option><option value="create-watch">Create a watch-only companion</option><option value="restore-backup">Restore encrypted wallet files</option><option value="create-multisig">Create a multisig participant · experimental</option></select></label><p id="setup-hint"></p><label>New wallet name<input name="name" required pattern="[A-Za-z0-9_-]{1,48}" maxlength="48" autocomplete="off"/></label><div data-setup="polyseed"><label>16-word Polyseed<textarea name="seed" rows="3" required autocomplete="off" spellcheck="false"></textarea></label><label>Seed passphrase, if encrypted<input name="passphrase" type="password" autocomplete="off"/><small>This is separate from your wallet-file password. An incorrect seed passphrase can restore a different, empty wallet. Check the restored address against your records.</small></label></div><div data-setup="hardware"><label>Device<select aria-label="Device" name="device"><option>Ledger</option><option>Trezor</option></select></label><label class="check-label"><input name="backedUp" type="checkbox" required/> My device is backed up and I will verify addresses and payments on its screen.</label><p class="notice">Unlock the device and open its Monero app. Never enter your hardware recovery words here. Trezor configurations requiring host PIN/passphrase entry may need initial setup in the official Monero GUI. Physical-device testing is still needed for this local build.</p></div><div data-setup="polyseed hardware"><label>Restore height<input name="height" type="number" min="0" step="1" value="0" required/><small>0 is the safe default. An incorrect late height can miss payments.</small></label></div><div data-setup="create-watch restore-backup"><label>Exchange file<select aria-label="Exchange file" name="file" required>${options(f)}</select></label><small>Put the exported JSON file and any accompanying .keys/.cache files in the exchange folder. A file backup uses its existing wallet password.</small></div><div data-setup="create-multisig"><div class="two-fields"><label>Required signatures<input type="number" name="threshold" min="2" max="5" value="2" required/></label><label>Total participants<input type="number" name="total" min="2" max="5" value="2" required/></label></div><label class="check-label"><input name="experimental" type="checkbox" required/> I understand Monero multisig is experimental, and each participant must independently verify the shared address and every payment.</label></div><label>Wallet-file password<input name="password" type="password" minlength="12" maxlength="1024" required autocomplete="new-password"/></label><label>Confirm password<input name="confirm" type="password" required autocomplete="new-password"/></label>${routeConsent(s.connection.mode)}<button class="button primary full">Continue</button></form><button class="text-button" data-action="show-exchange">Open exchange folder in Finder</button>`;
}
export function setupHint() {
  const form = document.querySelector<HTMLFormElement>("#advanced-setup-form");
  if (!form) return;
  const type = (form.elements.namedItem("type") as HTMLSelectElement).value;
  for (const box of form.querySelectorAll<HTMLElement>("[data-setup]")) {
    box.hidden = !box.dataset.setup!.split(" ").includes(type);
    box
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea")
      .forEach((i) => (i.disabled = box.hidden));
  }
  form.querySelector("#setup-hint")!.textContent = (
    {
      polyseed:
        "Recover locally from Polyseed. Monero by Astera stores derived Monero keys; the equivalent 25-word phrase remains available for recovery.",
      hardware:
        "Your device signs transactions. Monero by Astera stores the encrypted local wallet cache; spending keys stay on the device.",
      "create-watch":
        "Receive and prepare payments on an online computer without a spend key. The private view key can reveal incoming payments, so keep exchange files private.",
      "restore-backup":
        "Restore wallet keys, labels and cached history from an encrypted Monero by Astera file backup.",
      "create-multisig":
        "Creates a fresh participant wallet. Exchange setup files with the other participants, complete all rounds, compare the resulting address, and back up each participant before receiving funds.",
    } as Record<string, string>
  )[type];
}
export const exchangeHelp: Record<string, string> = {
  "backup-files":
    "Exports your encrypted wallet keys and cache, plus a JSON manifest. Copy all three files to offline storage. A seed alone does not restore a multisig participant or local labels.",
  "export-watch":
    "Export the primary address and private view key to create an online watch-only companion. This file cannot spend, but can expose incoming payments. Keep it private.",
  "export-outputs":
    "Online companion → offline signer: sync first, then export the wallet outputs.",
  "import-outputs":
    "Offline signer: import outputs before exporting signed key images. The signer must never have refreshed from a node. To move an existing online wallet offline, restore a new copy from its seed in Offline mode.",
  "export-images":
    "Offline signer → online companion: export signed key images after importing outputs. These reveal which outputs belong to the wallet; share only with your companion.",
  "import-images":
    "Online companion: import signed key images using your own Trusted local node to update spent status. Then prepare a payment in Send and export its unsigned file.",
  "sign-offline":
    "Offline signer: import the unsigned payment, review its decoded destinations, change and fee, then sign. No broadcast occurs. Write down the exported file's full SHA-256 fingerprint on this trusted device.",
  "broadcast-signed":
    "Online companion: select the signed file. The engine cannot decode signed files for review here. The displayed summary is supplied by the signer; authenticate it by entering the complete file fingerprint you recorded on the offline device.",
  "multisig-step":
    "Choose one setup file from each other participant for the current round. Repeat until Ready, compare the shared address through an independent channel, then export encrypted backups for every participant.",
  "export-kex":
    "Re-export your latest setup round if a participant needs the file again.",
  "export-multisig-info":
    "After syncing, send fresh multisig output information to the other signers. Repeat the exchange after new incoming or outgoing payments.",
  "import-multisig-info":
    "Import the other participants' fresh output information while connected; Monero by Astera then refreshes the chain to rebuild the outputs. You can switch offline again before signing. Select multiple files as needed.",
  "sign-multisig":
    "Decode and review the payment independently before adding your signature. Never sign a second transaction to retry an uncertain payment; check the chain first.",
  "broadcast-multisig":
    "Review the fully signed multisig payment, then broadcast it. The engine rejects a packet without enough signatures.",
};
export function exchangeForm(s: Snapshot, f: ExchangeFiles) {
  const ops = [
    "backup-files",
    ...(s.kind !== "hardware"
      ? [
          "export-watch",
          "export-outputs",
          "import-outputs",
          "export-images",
          "import-images",
          "sign-offline",
          "broadcast-signed",
        ]
      : []),
    ...(s.kind === "multisig"
      ? [
          "multisig-step",
          "export-kex",
          "export-multisig-info",
          "import-multisig-info",
          "sign-multisig",
          "broadcast-multisig",
        ]
      : []),
  ].filter((o) => o !== "export-watch" || s.kind === "software" || !s.kind);
  const labels: Record<string, string> = {
    "backup-files": "Back up encrypted wallet files",
    "export-watch": "Export watch-only companion",
    "export-outputs": "Export outputs",
    "import-outputs": "Import outputs",
    "export-images": "Export signed key images",
    "import-images": "Import signed key images",
    "sign-offline": "Review & sign offline payment",
    "broadcast-signed": "Review signed file for broadcast",
    "multisig-step": "Continue multisig setup",
    "export-kex": "Re-export multisig setup round",
    "export-multisig-info": "Export multisig sync data",
    "import-multisig-info": "Import multisig sync data",
    "sign-multisig": "Review & sign multisig payment",
    "broadcast-multisig": "Review & broadcast multisig payment",
  };
  return `<p>Files stay in a private folder on this Mac. Move them between your own devices using storage you trust. Opening Finder locks the wallet.</p>${s.multisig?.multisig ? `<p class="notice">Multisig: ${s.multisig.ready ? `${s.multisig.threshold} of ${s.multisig.total} · Ready` : "Setup in progress"}. Keep every participant's encrypted backup. Compare the final receive address independently.</p>` : ""}<form id="exchange-form"><label>Operation<select aria-label="Operation" name="operation" id="exchange-operation">${ops.map((o) => `<option value="${o}">${labels[o]}</option>`).join("")}</select></label><p class="notice" id="exchange-hint"></p><label id="exchange-files-label">Exchange files<select aria-label="Exchange files" name="files" multiple size="5">${options(f)}</select><small>⌘-click to select several peer files.</small></label><label id="exchange-password-label">Wallet password<input name="password" type="password" autocomplete="current-password" required/></label><button class="button primary full">Continue</button></form><div class="button-row"><button class="text-button" data-action="show-exchange">Lock & open exchange folder</button><button class="text-button" data-action="exchange">Refresh file list</button></div><details><summary>Offline payment steps</summary><ol><li>On the offline signer, export a watch-only companion and create it on the online computer.</li><li>Sync the companion; send its outputs to the signer. Return signed key images to the companion and import using your trusted local node.</li><li>Use Send on the companion to prepare and export an unsigned payment.</li><li>Review and sign on the offline computer. Record the signed file fingerprint there.</li><li>Import on the companion, verify that full fingerprint, then broadcast. Exchange updated key images to keep spent status accurate.</li></ol></details>`;
}
export function exchangeHint() {
  const f = document.querySelector<HTMLFormElement>("#exchange-form");
  if (!f) return;
  const op = (f.elements.namedItem("operation") as HTMLSelectElement).value;
  f.querySelector("#exchange-hint")!.textContent = exchangeHelp[op];
  const needsFile =
    op.startsWith("import") ||
    op.startsWith("sign") ||
    op.startsWith("broadcast") ||
    op === "multisig-step";
  const preview = op.startsWith("sign") || op.startsWith("broadcast");
  const sel = f.elements.namedItem("files") as HTMLSelectElement;
  sel.disabled = !needsFile;
  sel.required = needsFile;
  (f.querySelector("#exchange-files-label") as HTMLElement).hidden = !needsFile;
  const pw = f.elements.namedItem("password") as HTMLInputElement;
  pw.disabled = preview;
  (f.querySelector("#exchange-password-label") as HTMLElement).hidden = preview;
}
export function exchangeReviewForm(r: ExchangeReview) {
  return `<p>${r.operation.startsWith("sign") ? "Verify each recipient independently before signing." : "Check the payment and its authorization before broadcasting."} <span id="exchange-countdown">Review expires in two minutes.</span></p><span class="pill">${esc(r.network)}</span>${r.operation === "broadcast-signed" ? '<p class="notice">This summary comes from the signed file. Authenticate the entire file using the fingerprint displayed on your trusted offline signer.</p>' : ""}${r.descriptions.transactions.map((t, i) => `<div class="exchange-transaction"><b>Transaction ${i + 1}</b>${t.recipients.map((d) => `<label>Recipient · ${xmr(d.amount)} XMR<code class="full-address">${esc(d.address)}</code></label>`).join("")}<dl class="review-values"><dt>Fee</dt><dd>${xmr(t.fee)} XMR</dd><dt>Total spent</dt><dd>${xmr(t.total)} XMR</dd><dt>Change returned</dt><dd>${xmr(t.change)} XMR</dd></dl>${t.change !== "0" ? `<label>Change address<code class="full-address">${esc(t.changeAddress)}</code></label>` : ""}</div>`).join("")}<form id="exchange-confirm-form">${r.operation === "broadcast-signed" ? '<label>Full SHA-256 fingerprint from your offline signer<input name="fingerprint" minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" required autocomplete="off" spellcheck="false"/></label>' : ""}<label class="check-label"><input type="checkbox" required/> I independently checked every destination, amount and fee, and this is the intended payment.</label><label>Wallet password<input name="password" type="password" required autocomplete="current-password"/></label><button class="button primary full">${r.operation.startsWith("sign") ? "Approve & sign" : "Approve & broadcast"}</button></form>`;
}
