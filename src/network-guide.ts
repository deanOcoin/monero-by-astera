import { viewToggle } from "./view-mode";
import { type Connection, escape as esc } from './types';
const PREFERENCE = 'monero-by-astera:startup-guide';
let enabled = true;
try { enabled = localStorage.getItem(PREFERENCE) !== 'off'; } catch { /* Session setting remains available. */ }
export const startupGuideEnabled = () => enabled;
export function setStartupGuideEnabled(value: boolean) {
  enabled = value;
  try { localStorage.setItem(PREFERENCE, value ? 'on' : 'off'); } catch { /* Keep session preference. */ }
}
const routes: Record<Connection['mode'], string> = {local:'Local node','trusted-local':'Trusted local node',remote:'Direct HTTPS',tor:'Tor onion node',vpn:'VPN + HTTPS',offline:'Offline'};
// Startup and every connection-settings entry share this shell and route chooser.
export function networkGuide(c: Connection, setup = '') {
  const editing = !!setup;
  return `<div class="overlay"><section class="modal network-guide compact-guide ${editing ? 'guide-editing' : ''}" role="dialog" aria-modal="true" aria-labelledby="network-guide-title"><div class="guide-top">${editing ? '<button class="text-button" data-action="network-guide" data-help-custom="Return to the route choices. Unsaved edits are discarded; your saved connection stays unchanged.">← All routes</button>' : '<span class="eyebrow">YOUR CONNECTION</span>'}<div class="guide-top-actions">${viewToggle()}<button class="button secondary guide-skip" data-guide-focus data-action="close-modal" data-help-custom="Close without saving or changing your connection.">${editing ? 'Cancel' : 'Skip guide →'}</button></div></div><h1 id="network-guide-title">A private wallet. Your choice of route.</h1><p class="guide-intro">${editing ? 'Configure your route below. Changes take effect only when you save.' : 'A node supplies blockchain data. Choose a route, unlock, then sync to see payments.'}</p>${editing ? setup : `<div class="guide-body" tabindex="0" role="region" aria-label="Connection overview"><div class="route-choices">${[
    ['remote','Public HTTPS node','Lightweight setup. The node sees your IP.'],
    ['vpn','VPN + public node','Use a VPN you trust, with its kill switch.'],
    ['tor','Tor onion node','Hide your IP from the node. Guided Tor setup.'],
    ['local','My own node','More control. Requires a synced local monerod.'],
  ].map(([mode,title,body])=>`<button class="route-choice ${c.mode===mode?'saved-route':''}" data-action="guide-route" data-mode="${mode}"><b>${title}</b><small>${body}</small><span aria-hidden="true">→</span></button>`).join('')}</div><details class="guide-details"><summary>What should I know?</summary><p>HTTPS encrypts the connection but does not hide your IP. A VPN shifts trust to its operator; the app cannot verify or enforce it. Tor never falls back to direct networking.</p><p>Public-node checks establish availability, not honesty. A node never needs your recovery phrase. Sync before trusting a displayed zero.</p></details><div class="guide-current"><span class="guide-number">SAVED SETUP</span><h2>${esc(routes[c.mode])} <span>· ${esc(c.network)}</span></h2>${c.mode!=='offline'?`<code class="wrap">${esc(c.node||'Choose a node to continue')}</code>`:''}</div></div><div class="guide-actions"><button class="button primary" data-action="close-modal">Continue to wallet</button><button class="button secondary" data-action="edit-connection">Edit saved connection</button><button class="text-button" data-action="guide-route" data-mode="offline">Use offline</button></div><div class="guide-foot"><label class="check-label"><input name="startupGuide" type="checkbox" ${enabled?'checked':''}/> Show this guide at startup</label><small>Choosing a card makes no network request. Node checks run only when you request them.</small></div>`}</section></div>`;
}
