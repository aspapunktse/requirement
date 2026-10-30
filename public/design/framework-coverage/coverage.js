// Shared state and the Requirement drawer for the Framework coverage proposals. Needs
// ../frameworks/data.js, kit.js, appbar.js and ../frameworks/fw.js first.
// The Framework comes from ?fw= (example detail exists for CMMC Level 2 and ISO/IEC 27001:2022).
// Every change recomputes the Requirement's state with the CONTEXT.md rules: covered when a
// mapping is Full; otherwise a Coverage Gap, or an accepted gap when accepted; gaining a Full
// mapping ends an acceptance.
(function () {
  const esc = FW.esc;
  const param = new URLSearchParams(location.search).get('fw');
  const fw = FW.byId(param && FW.DETAIL[param] ? param : 'cmmc-l2');
  const reqs = JSON.parse(JSON.stringify(FW.DETAIL[fw.id]));
  const listeners = [];
  const changed = (msg) => { if (msg) Kit.toast(msg); listeners.forEach((fn) => fn()); };
  const find = (code) => reqs.find((r) => r.code === code);
  const counts = () => FW.recount(reqs);

  function recompute(r) {
    const full = r.maps.some((m) => m.coverage === 'FULL');
    if (full) { if (r.state === 'ACCEPTED_GAP') delete r.justification; r.state = 'COVERED'; }
    else r.state = r.justification ? 'ACCEPTED_GAP' : 'GAP';
  }
  const act = {
    accept(r, text, by = Appbar.role().person) { r.justification = text; r.acceptedBy = by; r.acceptedAt = new Date().toISOString().slice(0, 10); recompute(r); },
    unaccept(r) { delete r.justification; recompute(r); },
    createSup(r, code, title) { r.maps.push({ control: code, coverage: 'FULL', supplementary: true, title }); recompute(r); },
    addMap(r, code, coverage) { if (!r.maps.some((m) => m.control === code)) r.maps.push({ control: code, coverage }); recompute(r); },
    setCov(r, code, coverage) { const m = r.maps.find((x) => x.control === code); if (m) m.coverage = coverage; recompute(r); },
    removeMap(r, code) { r.maps = r.maps.filter((m) => m.control !== code); recompute(r); },
  };

  // Suggestions: Controls mapped elsewhere in the same section, then title word overlap
  const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'to', 'on', 'in', 'a', 'by', 'or', 'only', 'before', 'after', 'that', 'use', 'information', 'systems', 'system']);
  const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
  function suggest(r, n = 4) {
    const score = new Map();
    reqs.filter((x) => x.section === r.section && x !== r).forEach((x) => x.maps.forEach((m) => { if (!m.supplementary) score.set(m.control, (score.get(m.control) || 0) + 1); }));
    const w = words(r.title);
    FW.BASE.forEach((c) => { const hit = words(c.title).filter((x) => w.some((y) => y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5)))).length; if (hit) score.set(c.code, (score.get(c.code) || 0) + hit * 2); });
    return [...score.entries()].filter(([c]) => !r.maps.some((m) => m.control === c)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => FW.control(c));
  }
  const supCode = (r) => fw.id === 'cmmc-l2' ? FW.supCode(r) : `${fw.name.replace(/\W+/g, '').slice(0, 6).toUpperCase()}-${r.code}`;

  // Controls that would close the most gaps if their Partial mappings became Full
  function wins() {
    const m = new Map();
    reqs.filter((r) => r.state !== 'COVERED').forEach((r) => r.maps.forEach((x) => { if (x.coverage === 'PARTIAL') { if (!m.has(x.control)) m.set(x.control, []); m.get(x.control).push(r); } }));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([code, rs]) => ({ control: FW.control(code), reqs: rs }));
  }

  const TEMPLATES = ['Out of scope for our environment: ', 'Covered by a contractual commitment from ', 'Risk accepted at the management review on ', 'Compensated by '];
  const switcher = (p) => `<label class="fwsw"><span class="sr">Framework</span><select class="sel" onchange="location.href=FW.coverageHref(this.value,'${p}')">${FW.FRAMEWORKS.map((f) => `<option value="${f.id}" ${f.id === fw.id ? 'selected' : ''} ${FW.DETAIL[f.id] ? '' : 'disabled'}>${esc(FW.label(f))}${FW.DETAIL[f.id] ? '' : ' (no example data)'}</option>`).join('')}</select></label>`;
  const listHref = (p = 'a') => Appbar.withRole(`/design/frameworks/proposal-${p}.html`);

  // ---- Requirement drawer --------------------------------------------------------------
  let open = null;
  function ensureDrawer() {
    if (document.getElementById('cvDrawer')) return;
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.id = 'cvScrim';
    const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'cvDrawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'cvTitle');
    document.body.append(scrim, d);
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeDrawer(); });
    d.addEventListener('click', onDrawerClick);
  }
  function drawerHtml(r) {
    const cur = FW.canCurate();
    const maps = r.maps.length ? r.maps.map((m) => `<div class="mrow">${FW.ctl(m)}${cur ? `<span class="seg2" role="group" aria-label="Coverage of ${esc(m.control)}"><button type="button" data-cov="FULL" data-c="${esc(m.control)}" aria-pressed="${m.coverage === 'FULL'}">Full</button><button type="button" data-cov="PARTIAL" data-c="${esc(m.control)}" aria-pressed="${m.coverage === 'PARTIAL'}">Partial</button></span><button type="button" class="xbtn" data-rm="${esc(m.control)}" aria-label="Remove mapping to ${esc(m.control)}">×</button>` : ''}</div>`).join('')
      : '<span class="nomap">No Control mapped</span>';
    const sug = cur && r.state !== 'COVERED' ? suggest(r) : [];
    const add = cur ? `<div class="addmap"><input id="cvAdd" list="cvList" placeholder="Map a Control: code or title" aria-label="Control to map"><select id="cvAddCov" class="sel" aria-label="Coverage"><option value="FULL">Full</option><option value="PARTIAL">Partial</option></select><button class="btn sm" type="button" data-addmap>Map</button></div>
      <datalist id="cvList">${FW.BASE.map((c) => `<option value="${c.code}">${esc(c.title)}</option>`).join('')}</datalist>
      ${sug.length ? `<div class="sugs"><span>Suggested</span>${sug.map((c) => `<button type="button" data-sug="${esc(c.code)}" title="Map as Full"><b>${esc(c.code)}</b> ${esc(c.title)}</button>`).join('')}</div>` : ''}` : '';
    let close = '';
    if (r.state === 'ACCEPTED_GAP') close = `<section><h3>Accepted gap</h3><div class="accbox"><p>${esc(r.justification)}</p><small>Accepted by ${esc(r.acceptedBy || '—')} on ${esc(r.acceptedAt || '—')}. Counts as resolved; a Full mapping ends the acceptance.</small></div>
      ${cur ? `<div class="field" style="margin-top:10px"><label for="cvJust">Justification</label><textarea id="cvJust">${esc(r.justification)}</textarea></div><div class="rowb"><button class="btn danger sm" type="button" data-unaccept>Un-accept</button><button class="btn sm" type="button" data-accept>Save justification</button></div>` : ''}</section>`;
    else if (r.state === 'GAP' && cur) close = `<section><h3>Close the gap</h3><div class="ways">
      <div class="way"><b>Create a Supplementary Control</b><p>A new Control with ${esc(fw.name)} as its origin and a Full mapping to this Requirement.</p>
        <div class="field"><label for="cvSupCode">Code</label><input id="cvSupCode" value="${esc(supCode(r))}"></div>
        <div class="field"><label for="cvSupTitle">Title</label><input id="cvSupTitle" value="${esc(r.title)}"></div>
        <button class="btn primary sm" type="button" data-create>Create and map</button></div>
      <div class="way"><b>Accept the gap</b><p>Record why no Control is needed. It stays a gap but counts as resolved.</p>
        <div class="tpls">${TEMPLATES.map((t) => `<button type="button" data-tpl="${esc(t)}">${esc(t.replace(/[: ]+$/, ''))}…</button>`).join('')}</div>
        <div class="field"><label for="cvJust">Justification</label><textarea id="cvJust" placeholder="Why this Requirement needs no Control"></textarea></div>
        <button class="btn sm" type="button" data-accept>Accept gap</button></div></div></section>`;
    const why = r.state === 'COVERED' ? 'Covered: at least one mapped Control gives Full coverage.' : r.maps.length ? 'A Coverage Gap: its mappings are all Partial, and Partial mappings never add up to Full.' : 'A Coverage Gap: no Control is mapped to it.';
    return `<header><button class="x" type="button" data-close aria-label="Close">×</button>
      <span class="eyebrow">${esc(r.section)}</span><h2 id="cvTitle" style="font-size:1.15rem;padding-right:36px"><span style="font-family:var(--mono);color:var(--accent)">${esc(r.code)}</span> ${esc(r.title)}</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${FW.cst(r.state)}<span class="muted" style="font-size:.8rem">${why}</span></div></header>
      <div class="body"><section><h3>Mapped Controls</h3><div class="mlist">${maps}</div>${add}</section>${close}
      ${cur ? '' : '<p class="readonly-note">Only a Compliance Manager or an Admin changes mappings and gaps. You are viewing as ' + esc(Appbar.role().label) + '.</p>'}
      <section><h3>Effect on Systems</h3><p class="muted" style="font-size:.84rem">${fw.status === 'PUBLISHED' ? `Derived live on the ${fw.systems} Systems that have ${esc(FW.label(fw))} in scope: Met when every mapped Control that counts for the System is effectively fulfilled.` : `${esc(FW.label(fw))} is a Draft, so this Requirement reaches no System until it is published.`}</p></section></div>
      <div class="foot"><button class="btn sm" type="button" data-step="-1">↑ Previous</button><button class="btn sm" type="button" data-step="1">Next ↓</button></div>`;
  }
  let order = () => reqs.map((r) => r.code);
  function openDrawer(code, orderFn) {
    ensureDrawer(); if (orderFn) order = orderFn;
    open = code; const d = document.getElementById('cvDrawer');
    d.innerHTML = drawerHtml(find(code));
    d.classList.add('on'); document.getElementById('cvScrim').classList.add('on');
    d.querySelector('[data-close]').focus();
  }
  function closeDrawer() { open = null; document.getElementById('cvDrawer')?.classList.remove('on'); document.getElementById('cvScrim')?.classList.remove('on'); }
  function rerender() { if (open) document.getElementById('cvDrawer').innerHTML = drawerHtml(find(open)); }
  function onDrawerClick(e) {
    const r = find(open); if (!r) return; const t = e.target;
    const b = (sel) => t.closest(sel);
    if (b('[data-close]')) return closeDrawer();
    if (b('[data-step]')) { const o = order(), i = o.indexOf(open), n = o[(i + +b('[data-step]').dataset.step + o.length) % o.length]; return openDrawer(n); }
    if (b('[data-tpl]')) { const ta = document.getElementById('cvJust'); ta.value = b('[data-tpl]').dataset.tpl; ta.focus(); return; }
    if (b('[data-cov]')) { const x = b('[data-cov]'); const was = r.state; act.setCov(r, x.dataset.c, x.dataset.cov); rerender(); return changed(r.state !== was ? `${r.code} is now ${FW.STATE_LABEL[r.state].toLowerCase()}` : ''); }
    if (b('[data-rm]')) { act.removeMap(r, b('[data-rm]').dataset.rm); rerender(); return changed(`Mapping removed from ${r.code}`); }
    if (b('[data-sug]')) { act.addMap(r, b('[data-sug]').dataset.sug, 'FULL'); rerender(); return changed(`${b('[data-sug]')?.dataset.sug || 'Control'} mapped to ${r.code}`); }
    if (b('[data-addmap]')) { const v = document.getElementById('cvAdd').value.trim().split(' ')[0]; if (!FW.BASE.some((c) => c.code === v)) return Kit.toast('Pick a Control from the list'); act.addMap(r, v, document.getElementById('cvAddCov').value); rerender(); return changed(`${v} mapped to ${r.code}`); }
    if (b('[data-create]')) { const code = document.getElementById('cvSupCode').value.trim(), title = document.getElementById('cvSupTitle').value.trim(); if (!code || !title) return Kit.toast('A code and a title are needed'); act.createSup(r, code, title); rerender(); return changed(`Supplementary Control ${code} created; ${r.code} is covered`); }
    if (b('[data-accept]')) { const v = document.getElementById('cvJust').value.trim(); if (!v) { document.getElementById('cvJust').focus(); return Kit.toast('A justification is required'); } act.accept(r, v); rerender(); return changed(`${r.code} accepted`); }
    if (b('[data-unaccept]')) { act.unaccept(r); rerender(); return changed(`${r.code} is a Coverage Gap again`); }
  }

  // Bulk accept with one justification
  function bulkAccept(codes, text) { codes.map(find).filter((r) => r.state === 'GAP').forEach((r) => act.accept(r, text)); changed(`${codes.length} gaps accepted`); }

  // Drawer-only styles, kept here so the three pages share them
  const css = document.createElement('style');
  css.textContent = `.mlist{display:grid;gap:6px}.mrow{display:flex;gap:8px;align-items:center}.mrow .ctl{flex:1;min-width:0}
  .seg2{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex:none}.seg2 button{border:0;background:var(--surface);padding:3px 8px;font-size:.72rem;font-weight:700;color:var(--muted);cursor:pointer}.seg2 button+button{border-left:1px solid var(--line-soft)}
  .seg2 button[aria-pressed="true"][data-cov="FULL"]{background:var(--ok-soft);color:var(--ok)}.seg2 button[aria-pressed="true"][data-cov="PARTIAL"]{background:var(--gold-soft);color:var(--gold-ink)}
  .xbtn{border:0;background:none;color:var(--faint);font-size:1.1rem;cursor:pointer;padding:0 4px;border-radius:6px}.xbtn:hover{color:var(--bad);background:var(--bad-soft)}
  .addmap{display:flex;gap:6px;margin-top:10px}.addmap input{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--surface);color:var(--ink)}
  .sugs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;font-size:.74rem;color:var(--faint)}.sugs button{border:1px dashed var(--accent);background:var(--accent-soft);color:var(--ink);border-radius:8px;padding:2px 8px;font-size:.76rem;cursor:pointer;text-align:left}.sugs button b{font-family:var(--mono);color:var(--accent)}
  .ways{display:grid;gap:10px}.way{border:1px solid var(--line);border-radius:14px;padding:12px;display:grid;gap:8px}.way p{color:var(--muted);font-size:.8rem}
  .accbox{background:var(--gold-soft);border-radius:12px;padding:10px 12px;display:grid;gap:4px}.accbox small{color:var(--gold-ink)}.rowb{display:flex;justify-content:space-between;gap:8px;margin-top:8px}
  .fwsw .sel{max-width:260px}`;
  document.head.appendChild(css);

  window.Cov = { fw, reqs, find, counts, act, suggest, wins, switcher, listHref, openDrawer, closeDrawer, onChange: (fn) => listeners.push(fn), changed, bulkAccept, TEMPLATES, isOpen: () => open };
})();
