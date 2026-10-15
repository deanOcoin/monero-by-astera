import { type Connection } from './types';
export function routeConsent(mode: Connection['mode'], required = true) {
  const attribute = required ? 'required' : '';
  if (mode === 'remote') return `<div class="notice route-notice"><b>Direct HTTPS</b><p>Nodes see your IP and timing. HTTPS protects the connection, not your IP. For added privacy, connect a VPN you trust with its kill switch first.</p><label class="check-label"><input name="directConfirmed" type="checkbox" ${attribute}/> I accept this route for node checks and this session.</label></div>`;
  if (mode === 'vpn') return `<div class="notice route-notice"><b>VPN + HTTPS</b><p>Connect your trusted VPN with its kill switch. The app cannot verify or enforce the tunnel.</p><label class="check-label"><input name="vpnConfirmed" type="checkbox" ${attribute}/> My trusted VPN and kill switch are on; I accept this route.</label></div>`;
  return '';
}
export function nodePresets() {
  return `<div class="node-discovery"><button type="button" id="find-nodes" class="button secondary full">Find working mainnet nodes</button><p class="compact-note">Only nodes passing live status and fee checks appear. Checks use your chosen route.</p><p id="discovery-status" role="status" class="compact-note"></p><div id="checked-nodes" class="checked-nodes"></div></div>`;
}
