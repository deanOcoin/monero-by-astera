import { type Address, type Review, amountValid, escape as esc, xmr } from './types';

export function sourceOptions(addresses: Address[], kind = 'software') {
  return `<label>Spend from<select name="source"><option value="">All addresses</option>${addresses.map(a => `<option value="${a.index}">${esc(a.label || `Address ${a.index}`)} · ${xmr(a.unlocked)} XMR</option>`).join('')}<option value="multiple">Multiple addresses…</option></select></label><div id="multiple-sources" hidden><label>Allocation<select name="allocation"><option value="auto">Automatic · one transaction</option>${kind === 'software' ? '<option value="equal">Equal shares</option><option value="custom">Custom amounts</option>' : ''}</select></label><p id="allocation-hint" class="compact-note"></p><div class="source-list">${addresses.map(a => `<div class="source-row"><label class="check-label"><input type="checkbox" name="sources" value="${a.index}" data-help-custom="Use funds from this address. Unselected addresses cannot supply payment inputs."/><span>${esc(a.label || `Address ${a.index}`)}<small>${xmr(a.unlocked)} XMR available</small></span></label><label class="source-amount" hidden><span class="sr-only">Amount from ${esc(a.label || `Address ${a.index}`)}</span><input name="share-${a.index}" inputmode="decimal" placeholder="XMR" aria-label="Amount from ${esc(a.label || `Address ${a.index}`)}" data-help-custom="The recipient’s share from this address, excluding its network fee. Custom shares must add up to the main Amount." disabled/></label><small class="source-share" data-share="${a.index}"></small></div>`).join('')}</div><p id="source-summary" role="status" class="compact-note"></p></div>`;
}
export function atoms(value: string): bigint {
  if (!amountValid(value)) throw new Error('Enter a positive XMR amount with up to 12 decimal places');
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * 1000000000000n + BigInt(frac.padEnd(12, '0'));
}
export function sourcePayload(form: FormData, amount: string) {
  const chosen = String(form.get('source') || '');
  if (chosen !== 'multiple') return { source: chosen === '' ? null : Number(chosen) };
  const sources = form.getAll('sources').map(Number).sort((a,b) => a-b);
  if (sources.length < 2 || sources.length > 16) throw new Error('Choose between 2 and 16 source addresses');
  const allocation = String(form.get('allocation') || 'auto');
  if (allocation === 'equal' && atoms(amount) < BigInt(sources.length)) throw new Error('Amount is too small to split across these addresses');
  const shares = allocation === 'custom' ? sources.map(index => ({ index, amount: String(form.get(`share-${index}`) || '').trim() })) : undefined;
  if (shares && shares.reduce((sum, row) => sum + atoms(row.amount), 0n) !== atoms(amount)) throw new Error('Custom amounts must add up to the payment amount');
  return { sources, allocation, shares };
}
export function bindSources() {
  const form = document.querySelector<HTMLFormElement>('#send-form');
  if (!form) return;
  const update = () => {
    const data = new FormData(form), multiple = data.get('source') === 'multiple';
    const mode = String(data.get('allocation') || 'auto');
    const selected = data.getAll('sources').map(Number).sort((a,b) => a-b);
    form.querySelector<HTMLElement>('#multiple-sources')!.hidden = !multiple;
    form.querySelector('#allocation-hint')!.textContent = mode === 'auto' ? 'Uses only selected addresses. Monero chooses their contributions.' : 'One payment per address, each with its own fee. Change may return to the primary address.';
    let total = 0n; try { total = atoms(String(data.get('amount') || '')); } catch { /* Amount may be incomplete. */ }
    form.querySelectorAll<HTMLElement>('.source-row').forEach(row => {
      const box = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
      const field = row.querySelector<HTMLInputElement>('.source-amount input')!;
      row.querySelector<HTMLElement>('.source-amount')!.hidden = mode !== 'custom';
      field.disabled = !multiple || mode !== 'custom' || !box.checked;
      field.required = !field.disabled;
      const pos = selected.indexOf(Number(box.value));
      row.querySelector('.source-share')!.textContent = mode === 'equal' && pos >= 0 && total > 0n ? `${xmr((total / BigInt(selected.length) + (BigInt(pos) < total % BigInt(selected.length) ? 1n : 0n)).toString())} XMR` : '';
    });
    const summary = form.querySelector('#source-summary')!;
    summary.textContent = `${selected.length} addresses selected`;
    if (multiple && selected.length >= 2) {
      try { sourcePayload(new FormData(form), String(data.get('amount') || '')); }
      catch (e) { summary.textContent = (e as Error).message; }
    }
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}
export function sourceReview(review: Review, addresses: Address[] = []) {
  const label = (index: number) => esc(addresses.find(a => a.index === index)?.label || `Address ${index}`);
  const names = review.sources?.length ? review.sources.map(label).join(', ') : review.source == null ? 'All addresses' : label(review.source);
  if (!review.parts?.length) return `<dt>Spend from</dt><dd>${names}</dd>`;
  return `<dt>Split payment</dt><dd>${review.parts.length} separate transactions</dd>${review.parts.map(part => `<dt>${label(part.source!)}</dt><dd>${xmr(part.amount)} XMR <small>+ ${xmr(part.fee)} fee</small></dd>`).join('')}`;
}
