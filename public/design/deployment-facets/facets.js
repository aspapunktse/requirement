// Example data and helpers for the Deployment Facet proposals. Needs ../systems/data.js (SYS),
// ../controls/data.js (CONTROLS), ../shared/kit.js and ../shared/appbar.js first.
// A Deployment Facet is a name + description an Admin curates (CONTEXT.md). Systems declare one
// or more; Controls can be scoped to a subset. The rules mirror the API:
//  - names are unique (409 "A Deployment Facet with that name already exists");
//  - a Facet a System declares can't be retired (409);
//  - retiring a Facet unlinks it from the Controls scoped to it, so a Control scoped to that Facet
//    alone loses its Facet scoping and applies regardless of Facet.
(function () {
  const { systems, statusOf } = window.SYS;
  const esc = Kit.esc;

  const FACETS = [
    { id: 'f-saas', key: 'S', name: 'SaaS', icon: 'cloud', created: '2025-11-04', description: 'Software a vendor runs and delivers over the internet; the enterprise configures it but does not operate the platform.' },
    { id: 'f-iaas', key: 'C', name: 'Cloud IaaS/PaaS', icon: 'stack', created: '2025-11-04', description: 'Workloads the enterprise builds and runs on a public cloud provider’s infrastructure or platform services.' },
    { id: 'f-onprem', key: 'O', name: 'On-Premises Datacenter', icon: 'server', created: '2025-11-04', description: 'Hardware and software the enterprise operates in its own or a colocated datacenter.' },
    { id: 'f-edge', key: 'E', name: 'Edge', icon: 'edge', created: '2026-10-12', description: 'Devices and gateways at sites outside the datacenter: warehouses, vehicles, buildings.' },
    { id: 'f-mainframe', key: 'M', name: 'Mainframe', icon: 'chip', created: '2026-06-18', description: 'Batch and transaction workloads on the IBM Z estate.' },
    { id: 'f-msp', key: 'P', name: 'Managed service', icon: 'hand', created: '2026-10-28', description: '' },
  ];
  // Which Systems declare which Facet: the Systems list data, plus Edge and Mainframe for a few
  const EXTRA = { E: /Warehouse scanners|Fleet tracking|Energy metering|Building BMS|Badge access|CCTV recorder/, M: /Mainframe batch/ };
  FACETS.forEach((f) => {
    f.systems = systems.filter((s) => s.facets.includes(f.key) || (EXTRA[f.key] && EXTRA[f.key].test(s.name))).map((s) => s.id);
  });

  // Controls scoped to Facets: the Control Library data, plus Edge on a few endpoint and datacenter Controls
  const NAME_TO_ID = { 'SaaS': 'f-saas', 'Cloud IaaS/PaaS': 'f-iaas', 'On-Premises Datacenter': 'f-onprem' };
  const CONTROLS = window.CONTROLS;
  const scoped = CONTROLS.filter((c) => c.facets.length);
  const edgeSet = scoped.filter((c) => /Endpoint|Datacenter/.test(c.category)).slice(0, 9);
  FACETS.forEach((f) => { f.controls = []; });
  scoped.forEach((c) => {
    const ids = c.facets.map((n) => NAME_TO_ID[n]).filter(Boolean);
    const i = edgeSet.indexOf(c);
    if (i >= 0 && i < 2) ids.splice(0, ids.length, 'f-edge'); // two scoped to Edge alone
    else if (i >= 2) ids.push('f-edge');
    ids.forEach((id) => FACETS.find((f) => f.id === id).controls.push(c.code));
  });
  const control = (code) => CONTROLS.find((c) => c.code === code);
  const system = (id) => systems.find((s) => s.id === id);

  // Facet ids per Control code, recomputed after edits
  function scopeOf(code) { return FACETS.filter((f) => f.controls.includes(code)).map((f) => f.id); }
  const exclusive = (f) => f.controls.filter((code) => scopeOf(code).length === 1);
  const byId = (id) => FACETS.find((f) => f.id === id);
  const inUse = (f) => f.systems.length > 0;
  const systemsOf = (f) => f.systems.map(system);
  const controlsOf = (f) => f.controls.map(control);
  const colorOf = (f) => `var(--f-${f.key})`;

  // Systems that declare more than one Facet, and how often each pair meets
  function multi() { return systems.filter((s) => FACETS.filter((f) => f.systems.includes(s.id)).length > 1); }
  function pairs() {
    const out = [];
    FACETS.forEach((a, i) => FACETS.slice(i + 1).forEach((b) => {
      const n = a.systems.filter((id) => b.systems.includes(id)).length;
      if (n) out.push({ a, b, n });
    }));
    return out.sort((x, y) => y.n - x.n);
  }
  const both = (a, b) => a === b ? a.systems.filter((id) => FACETS.every((f) => f === a || !f.systems.includes(id))).length : a.systems.filter((id) => b.systems.includes(id)).length;

  // Editing, with the API's rules
  const canManage = () => Appbar.roleKey() === 'ADMIN';
  function nameError(name, exceptId) {
    const n = name.trim();
    if (!n) return 'A name is required';
    if (FACETS.some((f) => f.id !== exceptId && f.name.toLowerCase() === n.toLowerCase())) return 'A Deployment Facet with that name already exists';
    return null;
  }
  function add({ name, description }) {
    const err = nameError(name); if (err) return { error: err };
    const keys = 'QRTUVWXYZ'.split('').filter((k) => !FACETS.some((f) => f.key === k));
    const f = { id: 'f-' + Date.now().toString(36), key: keys[0] || 'Z', name: name.trim(), icon: 'grid', created: '2026-10-30', description: (description || '').trim(), systems: [], controls: [], fresh: true };
    FACETS.push(f); return { facet: f };
  }
  function update(id, { name, description }) {
    const f = byId(id);
    const err = nameError(name, id); if (err) return { error: err };
    f.name = name.trim(); f.description = (description || '').trim(); return { facet: f };
  }
  // What retiring would do: blocked while Systems declare it, otherwise which Controls widen
  function retireCheck(f) {
    return { blocked: f.systems.length > 0, systems: f.systems.length, controls: f.controls.length, widen: exclusive(f) };
  }
  function retire(id) {
    const f = byId(id);
    if (f.systems.length) return { error: 'This Deployment Facet is assigned to one or more Systems and can\'t be retired' };
    FACETS.splice(FACETS.indexOf(f), 1); return { ok: true };
  }

  // Small drawings
  const P = {
    cloud: 'M6 15h8a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 5 9a3 3 0 0 0 1 6z',
    stack: 'M3 6l7-3 7 3-7 3zM3 10l7 3 7-3M3 14l7 3 7-3',
    server: 'M4 3h12v5H4zM4 12h12v5H4zM7 5.5h.01M7 14.5h.01',
    edge: 'M10 10m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M5 5a7 7 0 0 0 0 10M15 5a7 7 0 0 1 0 10',
    chip: 'M6 6h8v8H6zM8 3v3M12 3v3M8 14v3M12 14v3M3 8h3M3 12h3M14 8h3M14 12h3',
    hand: 'M4 11l3 3h6l3-4-2-1-3 2H9M4 11V8h5l2 2',
    grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
  };
  const ico = (f, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[f.icon] || P.grid}"/></svg>`;
  const chip = (f) => `<span class="fchip" style="--fc:${colorOf(f)}"><i></i>${esc(f.name)}</span>`;
  const sysChip = (s) => { const st = statusOf(s.status); return `<span class="chip ${st.tone}">${esc(st.label)}</span>`; };
  // One dot per System, coloured by its onboarding status
  const dots = (f, max = 80) => {
    const list = systemsOf(f);
    return `<span class="sdots" role="img" aria-label="${list.length} Systems">${list.slice(0, max).map((s) => `<i class="dot ${statusOf(s.status).tone}" title="${esc(s.name)} · ${esc(statusOf(s.status).label)}"></i>`).join('')}${list.length > max ? `<small>+${list.length - max}</small>` : ''}</span>`;
  };
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const odo = (n, cls = '') => `<span class="odo ${cls}" aria-label="${n}">${String(n).split('').map((d) => `<span aria-hidden="true">${d}</span>`).join('')}</span>`;
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

  // Production shows non-Admins only this sentence; the proposals add a way back to Admin
  const gate = () => `<section class="card gate"><div class="done-state"><svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><rect x="14" y="25" width="28" height="20" rx="4" stroke="var(--accent)" stroke-width="3"/><path d="M20 25v-5a8 8 0 0 1 16 0v5" stroke="var(--accent)" stroke-width="3"/></svg>
    <h3>Only Admins can manage the Deployment Facet catalog.</h3><p>You are acting as ${esc(Appbar.role().person)}, ${esc(Appbar.role().label)}. Systems pick their Facets during onboarding; the catalog itself is an Admin page.</p>
    <button class="btn primary" type="button" onclick="Appbar.setRole('ADMIN')">Act as Admin</button></div></section>`;

  // The page opens as Admin unless the link carries a role
  if (!/role=/.test(location.hash)) history.replaceState(null, '', '#role=ADMIN');

  // What retiring means, as notes; shared by the dialog and proposal C's Retire tab
  function impactNotes(f) {
    const r = retireCheck(f);
    const first = systemsOf(f).slice(0, 4).map((s) => esc(s.name)).join(', ');
    let html = r.blocked
      ? `<div class="note bad"><span class="ni">!</span><div><b>${plural(r.systems, 'System')} declare${r.systems === 1 ? 's' : ''} ${esc(f.name)}.</b> It can't be retired until ${r.systems === 1 ? 'that System drops' : 'they drop'} it: ${first}${r.systems > 4 ? ' and ' + (r.systems - 4) + ' more' : ''}.</div></div>`
      : '<div class="note ok"><span class="ni">✓</span><div><b>No System declares it.</b></div></div>';
    if (r.widen.length) {
      html += `<div class="note warn"><span class="ni">!</span><div><b>${plural(r.widen.length, 'Control')} ${r.widen.length === 1 ? 'is' : 'are'} scoped to ${esc(f.name)} alone.</b> Retiring it removes their Facet scoping, so they apply to every System regardless of Facet.
        <ul class="ctlist">${r.widen.slice(0, 5).map((c) => `<li><code>${esc(c)}</code>${esc(control(c).title)}</li>`).join('')}${r.widen.length > 5 ? `<li>and ${r.widen.length - 5} more</li>` : ''}</ul></div></div>`;
    } else if (r.controls) {
      html += `<div class="note"><span class="ni" style="background:var(--faint)">i</span><div>${plural(r.controls, 'Control')} also name${r.controls === 1 ? 's' : ''} other Facets; ${r.controls === 1 ? 'it keeps' : 'they keep'} those.</div></div>`;
    } else html += '<div class="note"><span class="ni" style="background:var(--faint)">i</span><div>No Control is scoped to it.</div></div>';
    return html;
  }
  function retireDialog(id, done) {
    const f = byId(id);
    let d = document.getElementById('facRetire');
    if (!d) { d = document.createElement('dialog'); d.id = 'facRetire'; document.body.appendChild(d); }
    const r = retireCheck(f);
    d.innerHTML = `<form method="dialog" class="in"><h2>Retire ${esc(f.name)}?</h2>${impactNotes(f)}
      <div class="row"><button class="btn" value="cancel">${r.blocked ? 'Close' : 'Cancel'}</button>${r.blocked ? '' : '<button class="btn primary" value="ok">Retire Facet</button>'}</div></form>`;
    // Act on the submit (it fires on the click itself), not on the dialog's close event
    d.querySelector('form').addEventListener('submit', (e) => { if (e.submitter?.value !== 'ok') return; const res = retire(id); Kit.toast(res.error || `${f.name} retired`); if (done) done(res); });
    d.showModal();
  }

  const paletteItems = (run) => () => FACETS.map((f) => ({ group: 'Deployment Facets', label: f.name, sub: plural(f.systems.length, 'System'), icon: 'admin', run: () => run(f.id) }));

  window.FAC = { FACETS, systems, byId, inUse, systemsOf, controlsOf, control, system, scopeOf, exclusive, colorOf, multi, pairs, both, canManage, nameError, add, update, retireCheck, retire, impactNotes, retireDialog, ico, chip, sysChip, dots, fmtDate, odo, plural, gate, paletteItems, esc, statusOf };
})();
