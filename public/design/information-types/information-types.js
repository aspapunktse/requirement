/* Shared logic of the Information Type proposals (#302): the sample state, the rules from ADR 0012, the pieces every
   proposal draws the same way (the level chip, the type form, the System header with its refused submit) and the tab frame.
   A proposal supplies the layouts: IT.mount(stage, { tabs: [[key, label, fn(el)], ...] }).

   The rules the proposals show:
   - A type carries one Sensitivity Level and nothing else. A System declares any number of types.
   - The System's level can't be set below the highest level among its types; it may be higher. No types: set freely.
   - Adding a type above the System's level offers to raise the level in the same save.
   - A curator raising a type's level flags Systems now below it. Nothing changes on its own; they can't be submitted
     for review until the owner raises the level.
   - Deleting a type that a System declares is refused. */
(function (g) {
  const D = g.ITData, Sens = g.Sens, doc = document;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const S = { types: clone(D.TYPES), systems: clone(D.SYSTEMS), tab: null, sys: 's7', ui: {}, nextId: 100 };
  const listeners = [];
  const changed = () => listeners.forEach((f) => f());

  // ---------- lookups and rules ----------
  const typeById = (id) => S.types.find((t) => t.id === id);
  const sysById = (id) => S.systems.find((s) => s.id === id);
  const typesOf = (s) => s.types.map(typeById).filter(Boolean);
  const floorOfIds = (ids) => ids.reduce((m, id) => Math.max(m, typeById(id) ? typeById(id).level : 0), 0);
  const floorOf = (s) => floorOfIds(s.types);
  const isBelow = (s) => s.level != null && floorOf(s) > s.level;
  const offending = (s) => typesOf(s).filter((t) => s.level != null && t.level > s.level);
  const users = (tid) => S.systems.filter((s) => s.types.includes(tid));
  const holders = (t) => S.systems.filter((s) => s.level != null && s.level >= t.level);
  const labelOf = (n) => Sens.labelOf(n);
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const roleKey = () => (g.Appbar ? g.Appbar.roleKey() : 'SYSTEM_OWNER');
  const roleLabel = () => (g.Appbar ? g.Appbar.role().label : 'System Owner');
  const canCurate = () => roleKey() === 'COMPLIANCE_MANAGER' || roleKey() === 'ADMIN';
  const canDeclare = (s) => roleKey() === 'ADMIN' || (roleKey() === 'SYSTEM_OWNER' && s.owner === D.ME);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const names = (arr, max = 3) => arr.slice(0, max).map((x) => x.name).join(', ') + (arr.length > max ? ` and ${arr.length - max} more` : '');

  // Submit for review is refused while there is no level or the level is below the types (the first is as today)
  function submitCheck(s) {
    const reasons = [];
    if (s.level == null) reasons.push({ kind: 'nolevel', text: 'No Sensitivity Level is declared yet.' });
    else if (isBelow(s)) reasons.push({ kind: 'below', text: `Its Sensitivity Level (${labelOf(s.level)}) is below its Information Types: ${offending(s).map((t) => `${t.name} is ${labelOf(t.level)}`).join(', ')}. Raise it to at least ${labelOf(floorOf(s))}.` });
    return { ok: !reasons.length, reasons };
  }

  // ---------- catalogue changes (Compliance Manager, Admin) ----------
  // Returns what a save would do, for the form's impact line
  function impactOf(t, level) {
    if (!t) return { flag: [], free: [], text: '' };
    const use = users(t.id);
    const flag = use.filter((s) => s.level != null && s.level < level && !isBelow(s));
    const wasFlagged = use.filter((s) => s.level != null && isBelow(s));
    if (level > t.level) return { flag, free: [], text: use.length ? (flag.length ? `${plural(use.length, 'System')} declare${use.length === 1 ? 's' : ''} it. Raising it to ${labelOf(level)} flags ${flag.length} as below its Information Types (${names(flag)}). Nothing changes on its own: the owners raise their level, and until then those Systems can't be submitted for review.` : `${plural(use.length, 'System')} declare${use.length === 1 ? 's' : ''} it and already sit at or above ${labelOf(level)}. None is flagged.`) : 'No System declares it yet, so nothing is flagged.' };
    if (level < t.level) return { flag: [], free: use, text: use.length ? `Lowering it to ${labelOf(level)} only lowers the floor for ${plural(use.length, 'System')}. Nothing changes on its own, and ${wasFlagged.length ? `${plural(wasFlagged.length, 'flagged System')} may clear once the floor drops` : 'no System is flagged'}.` : '' };
    return { flag: [], free: [], text: '' };
  }
  function saveType(id, v) {
    const name = v.name.trim();
    if (!name) return { ok: false, error: 'Give the Information Type a name.' };
    if (S.types.some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `There is already an Information Type called "${name}".` };
    if (!(v.level >= 1 && v.level <= 5)) return { ok: false, error: 'Pick a Sensitivity Level.' };
    const flagged = id ? impactOf(typeById(id), v.level).flag : [];
    if (id) Object.assign(typeById(id), { name, desc: v.desc.trim(), level: v.level });
    else { id = 'tn' + (S.nextId++); S.types.push({ id, name, desc: v.desc.trim(), level: v.level }); }
    toast(flagged.length ? `Saved ${name}. ${plural(flagged.length, 'System')} now below its Information Types.` : `Saved ${name}.`);
    changed();
    return { ok: true, id, flagged };
  }
  // Refused while a System declares the type: nothing is deleted
  function deleteType(id) {
    const use = users(id);
    if (use.length) return { ok: false, systems: use };
    const t = typeById(id); S.types = S.types.filter((x) => x.id !== id);
    toast(`Deleted ${t.name}.`); changed();
    return { ok: true };
  }

  // ---------- a System's declaration: a draft the owner edits, then saves in one go ----------
  const draftOf = (s) => ({ types: s.types.slice(), level: s.level });
  const draftFloor = (d) => floorOfIds(d.types);
  const draftShort = (d) => d.types.length > 0 && draftFloor(d) > (d.level || 0);
  const draftDirty = (s, d) => d.level !== s.level || d.types.length !== s.types.length || d.types.some((id) => !s.types.includes(id));
  function saveDraft(s, d) {
    if (draftShort(d)) return false;
    const before = s.level; s.types = d.types.slice(); s.level = d.level;
    toast(`Saved ${s.name}${before !== s.level ? `: now ${labelOf(s.level)}` : ''}. Change Event recorded.`); changed();
    return true;
  }

  // ---------- drawing ----------
  function chip(n, o = {}) {
    const cls = ['sl', n ? '' : 'none', o.size || ''].filter(Boolean).join(' ');
    return `<span class="${cls}"${n ? ` data-l="${n}"` : ''}><span class="ticks" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${n && i <= n ? ' class="on"' : ''}></i>`).join('')}</span><span class="lab">${esc(o.label || labelOf(n))}</span></span>`;
  }
  const statusChip = (st) => `<span class="chip ${D.STATUS[st][1]}">${D.STATUS[st][0]}</span>`;
  const owner = (s) => `<span class="owner"><span class="av">${initials(s.owner)}</span>${esc(s.owner)}</span>`;
  const kind = (s) => (s.kind === 'Provider' ? ' <span class="kindtag">Provider</span>' : '');
  const belowChip = () => '<span class="below">Below its Information Types</span>';
  // A type as a small tag with its level shown by the level's own colour square
  const tag = (t) => `<span class="tag" title="${esc(t.name)}: ${esc(labelOf(t.level))}"><i class="lvsq" data-l="${t.level}"></i>${esc(t.name)}</span>`;
  function tags(s, max = 2) {
    const ts = typesOf(s);
    if (!ts.length) return '<span class="muted">None declared</span>';
    return `<span class="tags">${ts.slice(0, max).map(tag).join('')}${ts.length > max ? `<span class="tag more" title="${esc(ts.slice(max).map((t) => t.name).join(', '))}">+${ts.length - max}</span>` : ''}</span>`;
  }
  const levelRadios = (name, value, o = {}) => `<div class="lvgroup" role="radiogroup" aria-label="Sensitivity Level">${Sens.levels().map((l) => `<label class="lvopt"><input type="radio" name="${name}" value="${l.n}"${value === l.n ? ' checked' : ''}${o.min && l.n < o.min ? ' disabled' : ''}>${chip(l.n)}</label>`).join('')}</div>`;

  function roleNote(what) {
    const cur = canCurate();
    return cur ? `<div class="rolenote can" role="note"><b>${esc(roleLabel())}</b> can ${what || 'add, rename, describe, re-level and delete Information Types'}.</div>`
      : `<div class="rolenote" role="note"><span class="ro">Read only</span><span>As <b>${esc(roleLabel())}</b> you can read the catalogue. The Compliance Manager and an Admin curate it. Switch the acting user in the header to try the editing.</span></div>`;
  }

  // The form for one type. Returns its HTML; bind(root, type, { onSave, onCancel }) wires it.
  function typeForm(t, id) {
    const lv = t ? t.level : null;
    return `<form class="tform" novalidate data-form>
      <label class="fld">Name<input name="name" maxlength="60" autocomplete="off" value="${esc(t ? t.name : '')}" placeholder="For example Supplier invoices"></label>
      <label class="fld">Description<textarea name="desc" rows="2" maxlength="200" placeholder="What kind of information this is, in plain words">${esc(t ? t.desc : '')}</textarea></label>
      <div class="fld"><span id="lv-${id}">Sensitivity Level</span>${levelRadios('lv-' + id, lv)}</div>
      <div class="impact" data-impact aria-live="polite"></div>
      <div class="fmsg" data-err role="alert"></div>
      <div class="acts2"><button type="submit" class="btn primary">${t ? 'Save changes' : 'Add Information Type'}</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div>
    </form>`;
  }
  function bindForm(root, t, o) {
    const f = root.querySelector('[data-form]'), imp = f.querySelector('[data-impact]'), err = f.querySelector('[data-err]');
    const level = () => { const c = f.querySelector('input[type=radio]:checked'); return c ? +c.value : null; };
    const show = () => {
      const lv = level(); const r = t && lv ? impactOf(t, lv) : { text: lv && !t ? 'A new type is not declared by any System until an owner adds it.' : '', flag: [] };
      imp.textContent = r.text; imp.classList.toggle('warn', !!(r.flag && r.flag.length));
    };
    f.addEventListener('change', show); show();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = saveType(t ? t.id : null, { name: f.elements.name.value, desc: f.elements.desc.value, level: level() });
      if (!r.ok) { err.textContent = r.error; return; }
      err.textContent = ''; if (o.onSave) o.onSave(r);
    });
    f.querySelector('[data-cancel]').onclick = () => o.onCancel && o.onCancel();
    const first = f.elements.name; if (o.focus !== false) setTimeout(() => first.focus(), 0);
  }

  // The refusal when deleting a type that Systems declare
  function inUseHtml(t, systems) {
    return `<div class="banner bad" role="alert"><b>Not deleted.</b> ${esc(t.name)} is declared by ${plural(systems.length, 'System')}. Nothing was changed. Ask ${systems.length === 1 ? 'its owner' : 'the owners'} to remove it first, or re-level it instead.
      <ul>${systems.map((s) => `<li>${esc(s.name)}${s.kind === 'Provider' ? ' (Provider)' : ''}, owned by ${esc(s.owner)}</li>`).join('')}</ul></div>`;
  }

  // The System header shared by every System page: name, level, the flag, Submit for review and its refusal.
  // o.flag(sys) lets a proposal show the "below" flag its own way; o.rerender redraws the page.
  function sysHeader(s, o) {
    const sub = submitCheck(s);
    return `<div class="syspick"><label>Sample System <select class="sel" id="sysSel">${S.systems.map((x) => `<option value="${x.id}"${x.id === s.id ? ' selected' : ''}>${esc(x.name)}${isBelow(x) ? ' (below its types)' : ''}</option>`).join('')}</select></label></div>
      <header class="syshead"><div><div class="crumb"><a href="#" data-go-list>Systems</a> / ${esc(s.name)}</div>
        <h2 class="sysname"><span>${esc(s.name)}</span> ${chip(s.level, { size: 'lg' })} ${isBelow(s) ? belowChip() : ''}</h2>
        <p class="muted">${esc(s.vendor || 'Built in-house')} &middot; owned by ${esc(s.owner)} &middot; ${statusChip(s.status)}${kind(s)}</p></div>
        <div class="acts"><button class="btn" id="submitBtn"${sub.ok ? '' : ' aria-disabled="true" aria-describedby="subMsg"'}>${s.status === 'APPROVED' ? 'Resubmit for review' : 'Submit for review'}</button></div></header>
      <div id="subMsg" class="refusal" aria-live="polite"></div>
      <div class="systabs" aria-label="System page tabs (only Profile is part of this design)"><span>Overview</span><span>Controls</span><span>Requirements</span><span>Risks</span><span>Providers</span><b>Profile</b><span>Approval and activity</span></div>`;
  }
  function bindHeader(el, s, o) {
    el.querySelector('#sysSel').onchange = (e) => { S.sys = e.target.value; S.ui.edit = null; o.rerender(); };
    el.querySelector('[data-go-list]').onclick = (e) => { e.preventDefault(); setTab('list'); };
    el.querySelector('#submitBtn').onclick = () => {
      const r = submitCheck(s), box = el.querySelector('#subMsg');
      if (r.ok) { box.innerHTML = `<div class="banner ok" role="status"><b>Submitted.</b> ${esc(s.name)} is now in review.</div>`; return; }
      box.innerHTML = `<div class="banner bad" role="alert"><b>Not submitted.</b> ${esc(s.name)} can't be submitted for review yet.<ul>${r.reasons.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul><div>Nothing was changed.</div></div>`;
    };
  }

  // ---------- frame ----------
  function toast(m) { if (g.Kit) g.Kit.toast(m); }
  const roleHash = () => { const m = location.hash.match(/role=[A-Z_]+/); return m ? m[0] + '&' : ''; };
  let P, host;
  function setTab(id) { S.tab = id; try { history.replaceState(null, '', '#' + roleHash() + 'tab=' + id); } catch (e) { /* sandboxed */ } draw(); }
  function draw() {
    const keep = doc.activeElement && doc.activeElement.id;
    host.innerHTML = `<div class="tabs" role="tablist" aria-label="Surfaces">${P.tabs.map(([k, l]) => `<button role="tab" id="t-${k}" aria-selected="${k === S.tab}" aria-controls="panel" data-t="${k}">${l}</button>`).join('')}</div><div class="panel" id="panel" role="tabpanel" aria-labelledby="t-${S.tab}"></div>`;
    host.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
    P.tabs.find((t) => t[0] === S.tab)[2](host.querySelector('#panel'));
    if (keep) { const k = doc.getElementById(keep); if (k && k.focus && !host.contains(doc.activeElement)) k.focus(); }
  }
  function mount(el, proposal) {
    P = proposal; host = el;
    const m = location.hash.match(/(?:^#|tab=)([a-z]+)$/); const h = m && m[1];
    S.tab = P.tabs.some((t) => t[0] === h) ? h : P.tabs[0][0];
    listeners.push(draw);
    addEventListener('appbar:role', () => { ['edit', 'drawer', 'be', 'bn', 'ce', 'cm', 'cn'].forEach((k) => { S.ui[k] = null; }); draw(); });
    draw();
  }
  function reset() { S.types = clone(D.TYPES); S.systems = clone(D.SYSTEMS); Object.keys(S.ui).forEach((k) => delete S.ui[k]); changed(); toast('Sample data restored.'); }

  g.IT = { S, D, esc, chip, statusChip, owner, kind, belowChip, tag, tags, levelRadios, typeForm, bindForm, inUseHtml, roleNote, sysHeader, bindHeader, mount, setTab, reset, toast,
    typeById, sysById, typesOf, floorOf, floorOfIds, isBelow, offending, users, holders, labelOf, initials, roleKey, roleLabel, canCurate, canDeclare, plural, names,
    submitCheck, impactOf, saveType, deleteType, draftOf, draftFloor, draftShort, draftDirty, saveDraft, changed, redraw: draw };
})(typeof window !== 'undefined' ? window : globalThis);
