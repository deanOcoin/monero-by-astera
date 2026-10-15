import { invoke, isTauri } from '@tauri-apps/api/core';
import { toast, clearToast } from './toast';
export type ViewMode = 'full' | 'compact';
const KEY = 'monero-by-astera:view';
const HINT = 'monero-by-astera:view-hint-dismissed';
let mode: ViewMode = 'full';
let hintDismissed = false;
let changing = false;
let native = isTauri();
try {
  mode = localStorage.getItem(KEY) === 'compact' ? 'compact' : 'full';
  hintDismissed = localStorage.getItem(HINT) === 'yes';
} catch { /* Cosmetic storage failure never blocks wallet access. */ }
const glyph = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true">${mode === 'compact'
  ? '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>'
  : '<path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5"/>'}</svg>`;
export function viewToggle() {
  return `<button type="button" class="view-toggle button secondary" data-action="toggle-view" aria-label="Switch to ${mode === 'compact' ? 'full' : 'compact'} view" aria-pressed="${mode === 'compact'}" data-help-custom="Switch between the spacious interface and a smaller, tabbed wallet. Your drafts stay in place. The selected view is saved for next time." ${changing?'disabled':''}>${glyph()}<span>${mode === 'compact' ? 'Full view' : 'Compact view'}</span></button>`;
}
export function viewHint() {
  return `<aside class="view-hint" aria-label="Compact view introduction" ${hintDismissed || mode === 'compact' ? 'hidden' : ''}><span>Prefer a smaller wallet? Try <button type="button" class="text-button" data-action="toggle-view">Compact view ↙</button> in the top bar. Switch back anytime.</span><button type="button" class="icon-button" data-action="dismiss-view-hint" aria-label="Dismiss compact view introduction">×</button></aside>`;
}
export function dismissViewHint() {
  hintDismissed = true;
  try { localStorage.setItem(HINT, 'yes'); } catch { /* Session preference still applies. */ }
  document.querySelectorAll<HTMLElement>('.view-hint').forEach(el=>el.hidden=true);
}
export function showViewHint() {
  hintDismissed = false;
  try { localStorage.removeItem(HINT); } catch { /* Session preference still applies. */ }
  refreshViewControls();
  toast('The compact-view introduction will appear in Full view.');
}
export function refreshViewControls() {
  document.documentElement.dataset.view = mode;
  document.dispatchEvent(new Event('compact-layout'));
  document.querySelectorAll<HTMLButtonElement>('.view-toggle').forEach(button=>{
    button.innerHTML = `${glyph()}<span>${mode === 'compact' ? 'Full view' : 'Compact view'}</span>`;
    button.setAttribute('aria-label',`Switch to ${mode === 'compact' ? 'full' : 'compact'} view`);
    button.setAttribute('aria-pressed',String(mode === 'compact'));
    button.disabled = changing;
  });
  document.querySelectorAll<HTMLElement>('.view-hint').forEach(el=>el.hidden=hintDismissed || mode === 'compact');
  document.querySelectorAll<HTMLElement>('[data-view-name]').forEach(el=>el.textContent=mode === 'compact' ? 'Compact' : 'Full');
}
export async function initializeView() {
  try {
    const result = await invoke<{mode:ViewMode}>('view_preferences', {mode:null});
    if (result.mode !== 'full' && result.mode !== 'compact') throw new Error('Invalid view preference');
    mode=result.mode; native=true;
  } catch { /* Browser previews use local storage; native startup still shows usable UI. */ }
  refreshViewControls();
}
export async function toggleView() {
  if (changing) return;
  clearToast();
  changing=true; refreshViewControls();
  const next = mode === 'compact' ? 'full' : 'compact';
  try {
    let notice: string | null = null;
    if (native) {
      const result=await invoke<{mode:ViewMode;notice?:string|null}>('view_preferences',{mode:next});
      if (result.mode !== next) throw new Error('The display preference was not changed. Please try again.');
      notice=result.notice||null;
    }
    // Change CSS and controls only. Never re-render forms, secrets or payment reviews.
    mode=next;
    try {localStorage.setItem(KEY,mode);} catch {if (!native) notice='View changed for this session; this browser could not save the preference.';}
    dismissViewHint();
    if (notice) toast(notice);
  } catch (error) {toast(String(error),true);}
  finally {changing=false;refreshViewControls();}
}
