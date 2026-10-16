/* Shared register rendering: control rows in the reference register style, plus a keyed
   diff so rows that start applying flash in and rows that stop applying strike through and fold away. */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const WHO = { you: 'You do this', shared: 'Shared', covered: 'Covered for you' };
  const domainName = id => (Onb.DOMAINS.find(d => d[0] === id.slice(0, 3)) || [, ''])[1];

  function rowHTML(e, opts = {}) {
    const c = e.c;
    const tr = Onb.trace(c, e.scope);
    const whyTags = e.why.map(w => `<span class="tag">${esc(w)}</span>`).join('');
    const flag = opts.flag === 'new' ? '<span class="tag new">New</span>' : opts.flag === 'gone' ? `<span class="tag gone">${esc(opts.goneText || 'No longer applies')}</span>` : '';
    const who = e.resp === 'you' ? '' : `<p><strong>${e.resp === 'covered' ? 'Covered by' : 'Shared with'}:</strong> ${esc(e.via)}</p>`;
    const resp = e.r ? `<h4>Your part</h4><p>${esc(e.r)}</p>` : '';
    return `
      <summary>
        <span class="control-id">${c.id}</span>
        <span class="control-name">${esc(c.t)}<small>${esc(domainName(c.id))} · ${whyTags}${flag}</small></span>
        <span class="control-side"><span class="who ${e.resp}">${WHO[e.resp]}</span><br>${esc(c.cad)}</span>
      </summary>
      <div class="control-body">
        <div>
          <h4>What it means</h4><p>${esc(c.d)}</p>
          ${resp}
          <h4>Evidence we will ask for</h4><p>${esc(e.resp === 'covered' ? 'Nothing from you. ' + (e.via === 'Company-wide' ? '' : e.via + ' keeps the evidence.') : c.ev)}</p>
        </div>
        <div>
          <h4>Why it applies to this system</h4>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${whyTags}</div>
          ${who}
          <details class="trace"><summary>Requirement trace (for compliance)</summary>
            <ol>${tr.map(t => `<li>${esc(t.fw)}: <code>${t.refs.map(esc).join(', ')}</code></li>`).join('')}</ol>
            ${c.supp ? `<p class="small muted" style="margin-top:6px">Supplementary control, added because ${esc(Onb.FRAMEWORKS[c.supp])} has no ISO 27001 equivalent.</p>` : ''}
          </details>
        </div>
      </div>`;
  }

  // Render `entries` (array of evaluate() values, already ordered) into `list`.
  // prev: Map id -> resp from the previous render (null on first render).
  function diffRender(list, entries, prev, opts = {}) {
    const keep = new Set(entries.map(e => e.c.id));
    const existing = new Map([...list.querySelectorAll(':scope > .control[data-id]')].map(el => [el.dataset.id, el]));
    // fold away rows that no longer apply
    existing.forEach((el, id) => {
      if (keep.has(id) || el.classList.contains('is-leaving')) return;
      if (!prev || (opts.global && opts.global.has(id))) { el.remove(); return; }
      el.open = false;
      el.classList.remove('is-new', 'is-moved');
      el.classList.add('is-leaving');
      el.style.maxHeight = el.scrollHeight + 'px';
      requestAnimationFrame(() => { el.style.maxHeight = '0px'; el.style.opacity = '0'; });
      setTimeout(() => el.remove(), 1200);
    });
    let anchor = null;
    for (const e of entries) {
      const id = e.c.id;
      let el = existing.get(id);
      const isNew = prev && !prev.has(id);
      const moved = prev && prev.has(id) && prev.get(id) !== e.resp;
      if (!el || el.classList.contains('is-leaving')) {
        el = document.createElement('details');
        el.className = 'control';
        el.dataset.id = id;
      }
      const wasOpen = el.open;
      el.innerHTML = rowHTML(e, { flag: isNew ? 'new' : (opts.keepNew && el.classList.contains('is-new') ? 'new' : null) });
      el.open = wasOpen;
      if (isNew) { el.classList.remove('is-new'); void el.offsetWidth; el.classList.add('is-new'); }
      else if (prev && !opts.keepNew) el.classList.remove('is-new');
      el.classList.toggle('is-moved', !!moved);
      const next = anchor ? anchor.nextElementSibling : list.firstElementChild;
      if (el !== next) list.insertBefore(el, next);
      anchor = el;
    }
  }

  function tween(el, to) {
    const from = +el.dataset.v || 0;
    el.dataset.v = to;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 450;
    const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  const di = id => Onb.DOMAINS.findIndex(d => d[0] === id.slice(0, 3));
  const order = (x, y) => di(x) - di(y) || x.localeCompare(y, 'en', { numeric: true });

  window.Reg = { order, esc, rowHTML, diffRender, tween, WHO, domainName };
})();
