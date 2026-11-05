/* Shared logic of the Control page proposals (#314): finds the Control, applies the role rules and draws the pieces
   every proposal shows the same way (the chips, the owner, the Requirement rows, the status chips, the Systems rows, the
   not-found page) plus the proposal-only picker that switches between example Controls. A proposal supplies the layout:

     CP.mount({ render(el, m) { ... } })

   m = CP.model(): { state: 'ok' | 'notfound', code, c (the Control), roleKey, can: { edit, drafts }, groups (Requirements by
   Framework, Drafts only for a role that sees them), req: { total, full, partial }, org (Organization Control Implementation
   or null), sys: { all, visible, counts (over every System), seen (over the visible ones) } }.

   The role rules, as the issue states them:
   - Edit: a Compliance Manager or an Admin. Draft Frameworks: the same two roles.
   - Systems: a System Owner sees the Systems they own, a Business Risk Owner the Systems in their portfolio, every other
     role every System. The counts are always over every System the Control applies to. */
(function (g) {
  const D = g.CPData, doc = document;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const roleKey = () => (g.Appbar ? g.Appbar.roleKey() : 'SYSTEM_OWNER');
  const canEdit = (k = roleKey()) => k === 'COMPLIANCE_MANAGER' || k === 'ADMIN';
  const seesDrafts = canEdit;
  const APPLICABILITY = { ORGANIZATIONAL: 'Organizational', PER_SYSTEM: 'Per System', BOTH: 'Both' };
  const fmtDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const withRole = (href) => (g.Appbar ? g.Appbar.withRole(href) : href);

  // ---------- finding the Control ----------
  const byCode = (code) => (g.CONTROLS || []).find((c) => c.code === code) || D.EXTRA_CONTROLS.find((c) => c.code === code) || null;
  const hash = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x % 100; };

  // Requirements: the curated list, or one made up from the counts in the Control Library data
  function requirementsOf(c) {
    if (D.R[c.code]) return D.R[c.code];
    const rows = [];
    c.maps.forEach((m) => {
      const fw = D.FW_BY_NAME[m.fw] || 'ccm';
      for (let i = 0; i < m.full + m.partial; i++) rows.push([fw, `${fw === 'iso' ? 'A' : 'REQ'}-${rows.length + 1}`, 'Requirement mapped in the Control Library (example)', i < m.full ? 'FULL' : 'PARTIAL']);
    });
    return rows;
  }

  function visibleTo(sys, k) {
    if (k === 'SYSTEM_OWNER') return sys.owner === D.ME;
    if (k === 'BUSINESS_RISK_OWNER') return D.PORTFOLIO.includes(sys.bu);
    return true;
  }
  function applies(sys, c) {
    if (c.applicability === 'ORGANIZATIONAL') return false;
    if (c.facets.length && !c.facets.some((f) => sys.facets.includes(f))) return false;
    if (c.sens && (sys.level == null || sys.level < c.sens)) return false;
    if (c.i && sys.ii < D.IMPACT[c.i]) return false;
    if (c.a && sys.aa < D.IMPACT[c.a]) return false;
    return true;
  }
  function statusOn(sys, c, org) {
    const h = hash(sys.id + '|' + c.code);
    if (c.applicability === 'BOTH' && org && org.status === 'FULFILLED' && h % 5 !== 0) return { status: 'FULFILLED', source: 'org' };
    const status = h < 30 ? 'FULFILLED' : h < 55 ? 'IN_PROGRESS' : h < 88 ? 'NOT_STARTED' : h < 95 ? 'NOT_APPLICABLE' : 'WAIVED';
    return { status, source: 'own' };
  }

  function model(code = state.code, k = roleKey()) {
    const base = byCode(code);
    if (!base) return { state: 'notfound', code, roleKey: k, can: { edit: canEdit(k), drafts: seesDrafts(k) } };
    const x = D.X[code] || {};
    const c = { ...base, ...x, sens: x.sens ?? D.SENS_FROM_C[base.c] ?? null };
    const drafts = seesDrafts(k);
    const reqs = requirementsOf(c);
    const groups = D.FRAMEWORKS.filter((f) => drafts || !f.draft).map((f) => {
      const items = reqs.filter((r) => r[0] === f.id).map(([, rc, title, cov]) => ({ code: rc, title, cov }));
      return { fw: f, items, full: items.filter((i) => i.cov === 'FULL').length, partial: items.filter((i) => i.cov === 'PARTIAL').length };
    }).filter((gr) => gr.items.length);
    const req = groups.reduce((a, gr) => ({ total: a.total + gr.items.length, full: a.full + gr.full, partial: a.partial + gr.partial }), { total: 0, full: 0, partial: 0 });
    let org = null;
    if (c.applicability !== 'PER_SYSTEM') {
      const o = x.org || { status: D.FROM_LIST_STATUS[base.status] || 'NOT_STARTED', description: '', updated: null, by: null };
      org = { ...o };
    }
    const originFw = c.origin ? D.FRAMEWORKS.find((f) => f.name === c.origin) : null;
    const origin = c.origin ? { name: c.origin, draft: !!(originFw && originFw.draft) } : null;
    const all = D.SYSTEMS.filter((s) => applies(s, c)).map((s) => ({ ...s, ...statusOn(s, c, org) }));
    const visible = all.filter((s) => visibleTo(s, k)).sort((a, b) => a.name.localeCompare(b.name));
    const tally = (list) => list.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
    return { state: 'ok', code, c, roleKey: k, can: { edit: canEdit(k), drafts }, groups, req, org, origin,
      sys: { all, visible, counts: tally(all), seen: tally(visible) } };
  }

  // ---------- state, the proposal-only picker and the palette ----------
  const qs = new URLSearchParams(location.search);
  const state = { code: qs.get('code') || D.EXAMPLES[0][0] };
  let drawFn = null;
  function setCode(code) {
    state.code = code;
    const u = new URL(location.href); u.searchParams.set('code', code);
    try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) { /* a file: preview may refuse */ }
    const sel = doc.getElementById('cpCode'); if (sel) sel.value = isListed(code) ? code : '__other';
    draw();
  }
  const titleOf = (code) => { const c = byCode(code); return c ? c.title : 'Unknown code'; };
  const UNKNOWN = 'A.99.9';
  const isListed = (code) => D.EXAMPLES.some((e) => e[0] === code) || code === UNKNOWN;
  function protoBar() {
    const sel = (code) => (code === state.code ? ' selected' : '');
    const opts = D.EXAMPLES.map(([code, note]) => `<option value="${esc(code)}"${sel(code)}>${esc(code)}: ${esc(titleOf(code))} (${esc(note)})</option>`).join('');
    const other = isListed(state.code) ? '' : `<option value="__other" selected>${esc(state.code)}</option>`;
    return `<div class="proto" role="group" aria-label="Design proposal controls">
      <label for="cpCode"><b>Example Control</b></label>
      <select id="cpCode" class="sel">${opts}<option value="${UNKNOWN}"${sel(UNKNOWN)}>A.99.9: unknown code (the 404 page)</option>${other}</select>
      <span class="proto-note" id="cpNote" aria-live="polite"></span>
      <span class="proto-hint">Only on this design page. In the app the code comes from the URL.</span></div>`;
  }
  function note(m) {
    const k = Appbar.role();
    const seen = m.state === 'ok' && m.c.applicability !== 'ORGANIZATIONAL' ? ` ${m.sys.visible.length} of ${m.sys.all.length} Systems visible.` : '';
    return `Acting as ${k.person} (${k.label}). Edit ${m.can.edit ? 'shown' : 'hidden'}; Draft Frameworks ${m.can.drafts ? 'shown' : 'hidden'}.${seen}`;
  }
  function draw() {
    const m = model();
    doc.getElementById('cpNote').textContent = note(m);
    drawFn(doc.getElementById('page'), m);
    doc.getElementById('page').dataset.code = m.code;
  }
  function mount({ render }) {
    drawFn = render;
    doc.getElementById('proto').innerHTML = protoBar();
    doc.getElementById('cpCode').onchange = (e) => { if (e.target.value !== '__other') setCode(e.target.value); };
    addEventListener('appbar:role', draw);
    draw();
  }
  // Ctrl+K entries: one per example Control, so the palette shows how it would open a Control page
  const paletteItems = () => [
    ...D.EXAMPLES.map(([code, n]) => ({ group: 'Controls', label: `${code} ${titleOf(code)}`, sub: n, icon: 'control', run: () => setCode(code) })),
    { group: 'Controls', label: 'A.99.9 (unknown code)', sub: 'the 404 page', icon: 'control', run: () => setCode('A.99.9') },
  ];

  // ---------- pieces ----------
  const sensChip = (n, size) => `<span class="sl${size ? ' ' + size : ''}" data-l="${n}"><span class="ticks" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span><span class="lab">${esc(g.Sens ? Sens.labelOf(n) : D.SENS[n - 1])}</span></span>`;
  const from = (n, size) => (n ? `<span class="from">From</span>${sensChip(n, size)}` : '<span class="muted">Every level</span>');
  const statusChip = (st) => `<span class="chip ${D.STATUS[st].tone}">${D.STATUS[st].label}</span>`;
  const owner = (name) => (name
    ? `<span class="owner"><span class="av" aria-hidden="true">${esc(initials(name))}</span>${esc(name)}</span>`
    : '<span class="owner muted"><span class="av none" aria-hidden="true"></span>Unassigned</span>');
  const cov = (v) => `<span class="cov ${v === 'FULL' ? 'full' : 'partial'}">${v === 'FULL' ? 'Full' : 'Partial'}</span>`;
  const impact = (k) => (k ? `${D.IMPACT_LABEL[k]}` : '<span class="muted">None</span>');
  const libHref = () => withRole('../controls/proposal-a.html');
  const orgHref = () => withRole('../org-controls/proposal-a.html');
  const sysHref = () => withRole('../system/proposal-a.html');

  function crumb(m) {
    return `<nav class="crumb" aria-label="Breadcrumb"><a href="${libHref()}">Control Library</a><span aria-hidden="true">/</span><span aria-current="page">${esc(m.code)}</span></nav>`;
  }
  function chips(m) {
    const c = m.c;
    const out = [`<span class="tag ${c.applicability === 'ORGANIZATIONAL' ? 'org' : c.applicability === 'BOTH' ? 'both' : ''}">${APPLICABILITY[c.applicability]}</span>`];
    if (m.origin) {
      // A Draft Framework's name is shown only to a role that sees Drafts
      const named = !m.origin.draft || m.can.drafts;
      out.push(`<span class="tag sup">Supplementary${named ? ' · ' + esc(m.origin.name) : ''}${m.origin.draft && m.can.drafts ? ' (Draft Framework)' : ''}</span>`);
    }
    if (!c.mandatory) out.push('<span class="tag">Not mandatory</span>');
    if (c.sens) out.push(`<span class="chipfrom"><span class="from">From</span>${sensChip(c.sens)}</span>`);
    return out.join('');
  }
  const editBtn = (m, cls = '') => (m.can.edit ? `<a class="btn ${cls}" href="${withRole('../controls/proposal-a.html')}" title="Opens /admin/controls in the app">Edit</a>` : '');

  const controlBody = (m) => `<p class="desc">${esc(m.c.description)}</p>
    ${m.c.question ? `<div class="block"><span class="label">Self-Assessment Question</span><p class="question">${esc(m.c.question)}</p></div>` : ''}
    ${m.c.intent ? `<div class="block"><span class="label">Intent</span><p>${esc(m.c.intent)}</p></div>` : ''}
    ${m.c.examples && m.c.examples.length ? `<div class="block"><span class="label">Examples</span><ul class="examples" aria-label="Examples for ${esc(m.code)}">${m.c.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}`;

  function scopeBody(m) {
    const c = m.c;
    if (c.applicability === 'ORGANIZATIONAL') {
      return `<dl class="kv"><dt>Category</dt><dd>${esc(c.category)}</dd></dl><p class="muted small" style="margin-top:10px">An Organizational Control is implemented once by the Organization, so it has no Deployment Facet, Sensitivity or Impact Level scoping.</p>`;
    }
    return `<dl class="kv"><dt>Category</dt><dd>${esc(c.category)}</dd>
      <dt>Deployment Facets</dt><dd>${c.facets.length ? c.facets.map((f) => `<span class="facet">${esc(f)}</span>`).join('') : '<span class="muted">Any</span>'}</dd>
      <dt>Sensitivity Level</dt><dd>${from(c.sens)}</dd>
      <dt>Minimum Integrity</dt><dd>${impact(c.i)}</dd>
      <dt>Minimum Availability</dt><dd>${impact(c.a)}</dd></dl>`;
  }

  // One Framework's Requirements; `bar` adds the Full / Partial bar under the heading
  function frameworkBlock(gr, bar) {
    const tot = gr.items.length;
    return `<section class="fw" aria-label="${esc(gr.fw.name)}"><h3>${esc(gr.fw.name)}${gr.fw.draft ? ' <span class="tag draft">Draft Framework</span>' : ''}
        <span class="fwn">${plural(tot, 'Requirement')}${gr.full ? ` · ${gr.full} Full` : ''}${gr.partial ? ` · ${gr.partial} Partial` : ''}</span></h3>
      ${bar ? `<div class="covbar" aria-hidden="true"><i class="f" style="width:${gr.full / tot * 100}%"></i><i class="p" style="width:${gr.partial / tot * 100}%"></i></div>` : ''}
      <ul class="reqs" aria-label="Requirements in ${esc(gr.fw.name)}">${gr.items.map((r) => `<li><span class="rcode">${esc(r.code)}</span><span class="rtitle">${esc(r.title)}</span>${cov(r.cov)}</li>`).join('')}</ul></section>`;
  }
  const unmapped = '<p><span class="tag warn">Not mapped to any Requirement</span></p><p class="muted small" style="margin-top:6px">A Control that satisfies no Requirement counts towards no Framework.</p>';
  const satisfiesBody = (m, bar) => (m.groups.length ? `<div class="fws">${m.groups.map((gr) => frameworkBlock(gr, bar)).join('')}</div>` : unmapped);

  function orgBody(m) {
    const o = m.org;
    return `<dl class="kv"><dt>Status</dt><dd>${statusChip(o.status)}</dd>
      <dt>Description</dt><dd>${o.description ? esc(o.description) : '<span class="muted">Nobody has described how the Organization implements this Control yet.</span>'}</dd>
      <dt>Last updated</dt><dd>${o.updated ? `${fmtDate(o.updated)} by ${esc(o.by)}` : '<span class="muted">Never</span>'}</dd></dl>
      <p style="margin-top:12px"><a class="more" href="${orgHref()}" title="Opens /organization/controls in the app">Open in Organization Control Implementations →</a></p>
      ${m.c.applicability === 'BOTH' ? '<p class="muted small" style="margin-top:6px">A Both Control passes this status on to every System it applies to while it is Fulfilled.</p>' : ''}`;
  }

  // Said wherever Systems are counted: the counts are over every System, the list only over those the user can see
  function scopeNote(m) {
    const a = m.sys.all.length, v = m.sys.visible.length;
    if (v === a) return '';
    return `<p class="note" role="note">${a === 0 ? '' : `Counts include all ${plural(a, 'System')} this Control applies to. You can see ${v} of them${v ? '' : ', so none are listed'}.`}</p>`;
  }
  function sysRow(s, m) {
    return `<li><a class="sysrow" href="${sysHref()}" title="Opens /systems/${esc(s.id)}#controls/${esc(m.code)} in the app">
      <span class="sn"><b>${esc(s.name)}</b><small>${esc(s.owner)} · ${esc(s.bu)}</small></span>
      <span class="ss">${statusChip(s.status)}${s.source === 'org' ? '<small class="muted">Inherited from the Organization</small>' : ''}</span></a></li>`;
  }
  const sysList = (list, m) => (list.length ? `<ul class="syslist" aria-label="Systems">${list.map((s) => sysRow(s, m)).join('')}</ul>` : '');
  const sysEmpty = (m) => {
    if (m.sys.all.length === 0) return '<p class="muted">No System meets this Control’s scoping, so it applies to none today.</p>';
    return '<p class="muted">None of the Systems this Control applies to is visible to you.</p>';
  };
  const statusOrder = ['FULFILLED', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_APPLICABLE', 'WAIVED'];

  // Every System the Control applies to, by effective status: a bar and its legend (the visible Systems are listed apart)
  function statusBar(m) {
    const n = m.sys.all.length;
    if (!n) return '';
    const on = statusOrder.filter((k) => m.sys.counts[k]);
    return `<div class="stbar" role="img" aria-label="${on.map((k) => m.sys.counts[k] + ' ' + D.STATUS[k].label).join(', ')}">${on.map((k) => `<i class="st-${k}" style="width:${m.sys.counts[k] / n * 100}%"></i>`).join('')}</div>
      <ul class="legend" aria-label="All ${n} Systems by effective status">${on.map((k) => `<li><i class="st-${k}"></i><b>${m.sys.counts[k]}</b> ${D.STATUS[k].label}</li>`).join('')}</ul>`;
  }

  function notFound(m) {
    return `<div class="nf card" role="alert"><p class="eyebrow">404</p><h1>This page could not be found.</h1>
      <p class="muted">No Control has the code <span class="mono">${esc(m.code)}</span>. The Control may have been removed, or the link may be mistyped.</p>
      <p><a class="btn primary" href="${libHref()}">Back to the Control Library</a></p></div>`;
  }

  g.CP = { D, esc, initials, plural, model, mount, setCode, paletteItems, roleKey, fmtDate, statusOrder,
    h: { crumb, chips, owner, editBtn, controlBody, scopeBody, satisfiesBody, frameworkBlock, orgBody, scopeNote, sysList, sysRow, sysEmpty, statusBar, notFound, statusChip, sensChip, from, cov, unmapped, impact } };
})(window);
