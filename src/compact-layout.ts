// Compact paginates the same live fields Full shows; passwords, signing reviews and form ownership never leave their original DOM.
const roots = new Map<HTMLElement, Deck>();
const flow = '.two-columns,.welcome,.welcome-grid,.setup-card,.welcome-aside,.advanced-grid,.form-card,form,.connection-columns,.route-setup,#node-setup,.tor-connection,.guide-body,.settings-preferences,#multiple-sources,.source-list,.transactions,.table-card,.node-discovery,#public-node-option,.checked-nodes,#tor-proxies,.tor-diagnostics,.compact-text-flow,details[open]';
let scheduled = false;
let preferred: Element | null = null;
const compact = () => document.documentElement.dataset.view === 'compact';
const children = (e: Element) => Array.from(e.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
const shown = (e: HTMLElement) => !e.hidden && getComputedStyle(e).display !== 'none';

class Deck {
  units: HTMLElement[] = [];
  pages: HTMLElement[][] = [];
  index = 0;
  anchor: HTMLElement | null = null;
  visited = new WeakSet<HTMLElement>();
  invalidPending = false;
  reportingValidity = false;
  nav = document.createElement('nav');
  label = document.createElement('span');
  jump = document.createElement('select');
  back = document.createElement('button');
  next = document.createElement('button');
  constructor(readonly root: HTMLElement) {
    root.classList.add('compact-deck');
    this.nav.className = 'compact-pager';
    this.nav.setAttribute('aria-label', root.matches('main') ? 'Wallet pages' : 'Dialog pages');
    this.back.type = this.next.type = 'button';
    this.back.textContent = '← Back'; this.next.textContent = 'Next →';
    this.back.dataset.help = 'Return to the previous page. Your entered values stay in place.';
    this.next.dataset.help = 'Show more of this screen without scrolling. Your entered values stay in place.';
    this.jump.dataset.help = 'Jump to a page of this screen. Payment confirmation still requires every review page to be shown.';
    this.back.className = this.next.className = 'button secondary';
    this.label.setAttribute('role', 'status');
    this.jump.setAttribute('aria-label', 'Choose page');
    this.jump.onchange = () => this.show(Number(this.jump.value), true);
    this.nav.append(this.back, this.label, this.jump, this.next); root.append(this.nav);
    this.back.onclick = () => this.show(this.index - 1, true);
    this.next.onclick = () => this.show(this.index + 1, true);
    root.addEventListener('invalid', event => {
      if (!compact() || this.reportingValidity || !(event.target instanceof HTMLElement)) return;
      event.preventDefault();
      // Native validation emits one event per invalid field. Reveal only the first,
      // otherwise later errors could move focus back off its page in the same turn.
      if (this.invalidPending) return;
      this.invalidPending = true;
      const field = event.target as HTMLInputElement;
      const index = this.pageOf(field);
      if (index >= 0) this.show(index);
      setTimeout(() => {
        this.invalidPending = false;
        if (!field.isConnected) return;
        field.focus({preventScroll:true});
        this.reportingValidity = true;
        try { field.reportValidity(); } finally { this.reportingValidity = false; }
      });
    }, true);
    root.addEventListener('submit', event => {
      if (!compact()) return;
      // Enter cannot skip off-screen confirmation/review information. Backend expiry
      // and single-use authorization still apply independently of this presentation.
      const review = (event.target as Element).matches('#confirm-form,#exchange-confirm-form');
      const unseen = review ? this.pages.findIndex(page => page.some(unit => !this.visited.has(unit))) : -1;
      const submit = (event as SubmitEvent).submitter;
      const destination = submit ? this.pageOf(submit) : this.pages.length - 1;
      if (unseen >= 0 || destination !== this.index) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.show(unseen >= 0 ? unseen : destination, true);
      }
    }, true);
  }
  pageOf(element: Element) {
    return this.pages.findIndex(page => page.some(unit => unit === element || unit.contains(element)));
  }
  reset() {
    this.root.querySelectorAll('.compact-away,.compact-flow,.compact-empty').forEach(e => e.classList.remove('compact-away','compact-flow','compact-empty'));
  }
  layout() {
    const keep = preferred && this.root.contains(preferred) ? preferred : this.anchor || this.root.querySelector<HTMLElement>('[data-compact-start]');
    this.reset();
    if (!compact()) return;
    const frame = this.root.getBoundingClientRect();
    if (!frame.height) return;
    const bottom = frame.bottom - 57;
    const available = Math.max(150, frame.height - 110);
    this.units = [];
    const collect = (e: HTMLElement) => {
      if (e === this.nav || e.matches('.page-heading,.modal-head,.guide-top,.view-hint,.receive-picker-tools') || !shown(e)) return;
      if (e.matches('table')) {
        e.querySelectorAll<HTMLElement>('tbody > tr').forEach(row => this.units.push(row));
        return;
      }
      // Very long node messages/source-label lists must not become an oversized
      // indivisible page. Preserve every character; Full displays spans inline.
      const height = e.getBoundingClientRect().height;
      if (!e.children.length && height > available && e.matches('p,code,pre,dd,.compact-text')) {
        const text = Array.from(e.textContent || '');
        const size = Math.max(24, Math.floor(text.length * available / height * 0.65));
        if (size < text.length) {
          const spans: HTMLElement[] = [];
          for (let i = 0; i < text.length; i += size) {
            const span = document.createElement('span'); span.className = 'compact-text';
            span.textContent = text.slice(i,i+size).join(''); spans.push(span);
          }
          e.replaceChildren(...spans); e.classList.add('compact-text-flow');
        }
      }
      // Long definition lists split only between complete name/value pairs.
      if (e.matches('dl') && e.getBoundingClientRect().height > available) {
        for (const term of children(e).filter(c => c.tagName === 'DT')) {
          const value = term.nextElementSibling;
          if (value?.tagName !== 'DD') continue;
          const pair = document.createElement('div'); pair.className = 'compact-definition';
          e.insertBefore(pair, term); pair.append(term, value);
        }
      }
      const splittable = e.matches(flow) || (e.getBoundingClientRect().height > available && e.matches('div,section,aside,dl,ul,ol') && e.children.length > 1);
      if (splittable) {
        e.classList.add('compact-flow'); children(e).forEach(collect);
      } else this.units.push(e);
    };
    children(this.root).forEach(collect);
    this.units.forEach(e => e.classList.add('compact-away'));
    this.pages = [];
    let page: HTMLElement[] = [];
    // Measure in the actual layout, including table headings and wrapped notices.
    // A single linear pass; no cloning, serialization or secret persistence.
    for (const unit of this.units) {
      unit.classList.remove('compact-away');
      const end = unit.getBoundingClientRect().bottom;
      if (page.length && end > bottom) {
        const tail = page.at(-1)!;
        const keepHeading = page.length > 1 && tail.matches('h2,h3,summary,.section-heading,.setup-step') && tail.getBoundingClientRect().height + unit.getBoundingClientRect().height + 28 < available;
        if (keepHeading) page.pop();
        page.forEach(e => e.classList.add('compact-away'));
        this.pages.push(page); page = keepHeading ? [tail] : [];
      }
      page.push(unit);
    }
    if (page.length) this.pages.push(page);
    const found = keep ? this.pageOf(keep) : -1;
    this.show(found >= 0 ? found : Math.min(this.index, this.pages.length - 1));
  }
  show(index: number, focus = false) {
    this.index = Math.max(0, Math.min(index, this.pages.length - 1));
    const page = this.pages[this.index] || [];
    const visible = new Set(page);
    this.units.forEach(e => e.classList.toggle('compact-away', !visible.has(e)));
    // Suppress empty table scaffolding on pages containing only explanatory text.
    this.root.querySelectorAll('table').forEach(table => table.classList.toggle('compact-empty', !Array.from(table.querySelectorAll('tbody > tr')).some(row => !row.classList.contains('compact-away'))));
    this.root.querySelectorAll('details.compact-flow').forEach(el => el.classList.toggle('compact-empty', !page.some(unit => el.contains(unit))));
    this.anchor = page[0] || null;
    page.forEach(e => this.visited.add(e));
    this.back.disabled = this.index === 0;
    this.next.disabled = this.index >= this.pages.length - 1;
    this.label.textContent = `Page ${this.index + 1} of ${Math.max(1,this.pages.length)}`;
    this.label.className = 'sr-only';
    if (this.jump.options.length !== this.pages.length) {
      this.jump.replaceChildren(...this.pages.map((_, i) => new Option(`Page ${i+1} of ${this.pages.length}`, String(i))));
    }
    this.jump.value = String(this.index);
    this.nav.dataset.single = String(this.pages.length <= 1);
    this.root.scrollTop = this.root.scrollLeft = 0;
    if (focus) {
      // Move keyboard focus into the new page without asking the browser to scroll.
      const control = page.flatMap(unit => [unit,...unit.querySelectorAll<HTMLElement>('input,select,textarea,button,summary')]).find(el => el.matches('input,select,textarea,button,summary') && !el.hasAttribute('disabled') && el.getClientRects().length);
      (control || this.jump).focus({preventScroll:true});
    }
  }
}
export function refreshCompactLayout() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const [root, deck] of roots) if (!root.isConnected) { deck.reset(); roots.delete(root); }
    document.querySelectorAll<HTMLElement>('main,.modal').forEach(root => {
      let deck = roots.get(root);
      if (!deck) { deck = new Deck(root); roots.set(root, deck); }
      deck.layout();
    });
    preferred = null;
  });
}
export function installCompactLayout() {
  new MutationObserver(records => {
    if (records.some(r => {
      const el = r.target instanceof Element ? r.target : r.target.parentElement;
      return !el?.closest('.compact-pager,#review-countdown,#exchange-countdown,#sync-elapsed');
    })) refreshCompactLayout();
  }).observe(document.querySelector('#app')!, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','open']});
  // WebKit suspends animation frames for occluded windows. Layout must also be
  // ready when a window is restored, without waiting for an animation callback.
  document.fonts.ready.then(refreshCompactLayout);
  document.fonts.addEventListener('loadingdone', refreshCompactLayout);
  window.addEventListener('resize', refreshCompactLayout);
  document.addEventListener('compact-layout', refreshCompactLayout);
  document.addEventListener('change', event => { preferred = event.target as Element; refreshCompactLayout(); });
  document.addEventListener('toggle', event => { preferred = event.target as Element; refreshCompactLayout(); }, true);
  document.addEventListener('load', refreshCompactLayout, true);
  refreshCompactLayout();
}
