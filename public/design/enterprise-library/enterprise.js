/* Enterprise Control Library proposal: a header switch between the current Control Library (Annex A,
   from ../controls/data.js) and the Enterprise Control Library (enterprise-data.js), in one layout:
   a list grouped by domain beside a detail panel. State lives in the URL hash so a reload keeps it:
   #current[/<code>]  or  #enterprise[/matrix|crosswalk|model][/<CTL id>[/<env key>]] */
(function () {
  const { esc, highlight, appChip, statusHtml, detailHtml } = Lib;
  const E = window.ENTERPRISE;
  const $ = (id) => document.getElementById(id);

  const ENVS = E.environments;
  const ENV_BY = Object.fromEntries(ENVS.map((e) => [e.key, e]));
  const CTLS = E.controls;
  const CTL_BY = Object.fromEntries(CTLS.map((c) => [c.id, c]));
  const STAGE_NAME = Object.fromEntries(E.stages.map((s) => [s.n, s.name]));
  const PARTY = { CUSTOMER: 'C', PROVIDER: 'P', SHARED_INDEPENDENT: 'SI', SHARED_DEPENDENT: 'SD' };

  // Annex A items (the real seed Controls) and which Enterprise Controls the document maps them from.
  const ANNEX = CONTROLS.filter((c) => c.code.startsWith('A.'));
  const ANNEX_BY = Object.fromEntries(ANNEX.map((c) => [c.code, c]));
  const MAPPED_FROM = {};
  CTLS.forEach((c) => c.annexA.forEach((a) => { (MAPPED_FROM[a.code] = MAPPED_FROM[a.code] || []).push({ id: c.id, verify: a.verify }); }));
  const UNCOVERED = ANNEX.filter((c) => !MAPPED_FROM[c.code]);
  const COVERED = ANNEX.filter((c) => MAPPED_FROM[c.code]);
  const DOMAINS = [...new Set(CTLS.map((c) => c.domainGroup))];

  const state = { side: 'current', view: 'matrix', sel: null, env: null, q: '', family: 'all', legendOpen: true };
  const VIEWS = ['matrix', 'crosswalk', 'model'];

  // ---- URL hash ----
  function readHash() {
    const parts = decodeURIComponent(location.hash.replace(/^#/, '')).split('/').filter(Boolean);
    const side = parts.shift();
    state.side = side === 'enterprise' ? 'enterprise' : 'current';
    state.sel = null; state.env = null;
    if (state.side === 'enterprise') {
      if (VIEWS.includes(parts[0])) state.view = parts.shift(); else state.view = 'matrix';
      if (parts[0] && CTL_BY[parts[0]]) {
        state.sel = parts[0];
        if (parts[1] && ENV_BY[parts[1]]) state.env = parts[1];
      }
    } else if (parts[0] && CONTROLS.some((c) => c.code === parts[0])) {
      state.sel = parts[0];
    }
  }
  function writeHash() {
    let h = state.side;
    if (state.side === 'enterprise') {
      h += '/' + state.view;
      if (state.sel) h += '/' + state.sel + (state.env ? '/' + state.env : '');
    } else if (state.sel) h += '/' + encodeURIComponent(state.sel);
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* hash only, ignore */ }
    try { localStorage.setItem('enterprise-library-side', state.side); } catch (e) { /* storage may be blocked */ }
  }

  // ---- header ----
  function renderTop() {
    const ent = state.side === 'enterprise';
    $('switch').innerHTML = `<button type="button" data-side="current" aria-pressed="${!ent}">Current (Annex A)</button>`
      + `<button type="button" data-side="enterprise" aria-pressed="${ent}">Enterprise Control Library</button>`;
    $('banner').className = 'banner' + (ent ? ' ill' : '');
    $('banner').innerHTML = ent
      ? `<span><b>Design proposal.</b> ${CTLS.length} Enterprise Controls, each implemented per environment, from Document F, the Hybrid Control Matrix. <b>Every Stage, status and mechanism is illustrative</b>, as the document itself labels them. Not the state of any real organization.</span>`
      : `<span><b>Today.</b> ${ANNEX.length} base Controls, one per ISO 27001:2022 Annex A item, plus ${CONTROLS.length - ANNEX.length} illustrative Supplementary Controls. Switch to see the alternative in the same layout.</span>`;
    const tabs = ent
      ? [['matrix', 'Matrix', CTLS.length], ['crosswalk', 'Crosswalk to Annex A', null], ['model', 'How this maps to our model', null]]
      : [['list', 'Controls', CONTROLS.length]];
    $('tabs').innerHTML = tabs.map(([k, l, n]) => `<button type="button" role="tab" data-view="${k}" aria-selected="${ent ? state.view === k : true}">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  }

  // ---- shared bits ----
  const ill = '<span class="ill-tag" title="Not stored in the document; derived from the defaults it states in section 6">illustrative</span>';
  const verifyMark = (t) => esc(t).replace(/\(to verify[^)]*\)|\bto verify\b/g, (m) => `<span class="chip verify">${m.startsWith('(') ? m.slice(1, -1) : m}</span>`);
  const stageClass = (cell) => (cell.state === 'impl' || cell.stageNow != null ? 's' + cell.stageNow : '');

  // ---- list: current side ----
  function renderCurrentList() {
    const q = state.q.trim().toLowerCase();
    const rows = CONTROLS.filter((c) => (state.family === 'all' || c.family === state.family) && (!q || c.hay.includes(q)));
    const groups = new Map();
    rows.forEach((c) => { if (!groups.has(c.category)) groups.set(c.category, []); groups.get(c.category).push(c); });
    let html = '';
    groups.forEach((list, cat) => {
      html += `<div class="grp">${esc(cat)} <span class="gc">${list.length}</span></div>`;
      list.forEach((c) => {
        html += `<button type="button" class="lrow${state.sel === c.code ? ' active' : ''}" data-code="${esc(c.code)}">`
          + `<span class="code">${highlight(c.code, q)}</span><b>${highlight(c.title, q)}</b>`
          + `<span>${appChip(c)}</span><span class="org">${statusHtml(c)}</span></button>`;
      });
    });
    return {
      count: `${rows.length} of ${CONTROLS.length} Controls`,
      html: html ? `<div class="list">${html}</div>` : '<div class="empty">No Controls match.</div>',
    };
  }

  // ---- list: enterprise matrix ----
  function legendHtml() {
    return `<details class="legend"${state.legendOpen ? ' open' : ''} id="legend"><summary>Legend: how to read a cell</summary>
      <p class="muted" style="margin-top:6px">Each cell is <span class="mono">&lt;party&gt;/&lt;origin&gt;&lt;marker&gt; &lt;now&gt;&gt;&lt;target&gt;</span>. The shade follows the current Stage.</p>
      <div class="lg">
        <dl><dt>C</dt><dd>Customer</dd><dt>P</dt><dd>Provider</dd><dt>SI</dt><dd>Shared, independent</dd><dt>SD</dt><dd>Shared, dependent</dd></dl>
        <dl><dt>S</dt><dd>System-specific</dd><dt>C</dt><dd>Common (inherited)</dd><dt>H</dt><dd>Hybrid</dd><dt>*</dt><dd>Compensating approach</dd></dl>
        <dl><dt>2&gt;3</dt><dd>Stage now, then target Stage at M8</dd><dt>--</dt><dd>Empty: no record yet, a work item</dd><dt>n/a</dt><dd>Approved not applicable</dd></dl>
      </div>
      <div class="swatches" style="margin-top:8px" aria-label="Stage scale">${E.stages.map((s) => `<span class="mc s${s.n}" style="display:inline-block;min-height:0;padding:0"><span>${s.n} ${esc(s.name)}</span></span>`).join('')}</div>
    </details>`;
  }
  function matchesCtl(c, q) {
    if (!q) return true;
    const hay = (c.id + ' ' + c.name + ' ' + c.domainGroup + ' ' + c.iso + ' ' + c.nist + ' ' + c.statement).toLowerCase();
    return hay.includes(q);
  }
  function renderMatrix() {
    const q = state.q.trim().toLowerCase();
    const rows = CTLS.filter((c) => matchesCtl(c, q));
    let html = `<div class="mhead"><div>Control</div>${ENVS.map((e) => `<div title="${esc(e.label)}">${esc(e.short)}</div>`).join('')}</div>`;
    DOMAINS.forEach((d) => {
      const list = rows.filter((c) => c.domainGroup === d);
      if (!list.length) return;
      html += `<div class="mgrp">${esc(d)} <span class="gc">${list.length}</span></div>`;
      list.forEach((c) => {
        html += `<div class="mrow${state.sel === c.id ? ' active' : ''}"><button type="button" class="mname" data-ctl="${c.id}"><span class="code">${highlight(c.id, q)}</span><b>${highlight(c.name, q)}</b></button>`;
        ENVS.forEach((e) => {
          const cell = c.cells[e.key];
          const o = c.overview[e.key];
          const cls = cell.state === 'empty' ? 'empty' : cell.state === 'na' ? 'na' : stageClass(cell);
          html += `<button type="button" class="mc ${cls}${state.sel === c.id && state.env === e.key ? ' sel' : ''}" data-ctl="${c.id}" data-env="${e.key}" title="${esc(c.id + ' in ' + e.label)}"><span>${esc(o)}</span></button>`;
        });
        html += '</div>';
      });
    });
    return {
      count: `${rows.length} of ${CTLS.length} Enterprise Controls, six environments`,
      html: rows.length ? legendHtml() + `<div class="list"><div class="mx">${html}</div></div>` : '<div class="empty">No Enterprise Controls match.</div>',
    };
  }

  // ---- crosswalk view ----
  function annexChip(a) {
    const t = ANNEX_BY[a.code];
    return `<button type="button" class="acell${a.verify ? ' vf' : ''}" data-goto-annex="${a.code}"><span class="code">${a.code}</span><span>${esc(t ? t.title : '')}</span>${a.verify ? '<span>(to verify)</span>' : ''}</button>`;
  }
  function renderCrosswalk() {
    const byCat = new Map();
    ANNEX.forEach((c) => { if (!byCat.has(c.category)) byCat.set(c.category, []); byCat.get(c.category).push(c); });
    const absorbedRows = CTLS.map((c) => `<div class="xrow"><button type="button" class="xlink" data-ctl="${c.id}"><span class="code">${c.id}</span><b>${esc(c.name)}</b></button>`
      + `<div>${c.annexA.length ? c.annexA.map(annexChip).join('') : '<span class="muted">No Annex A item mapped</span>'}${/none direct/.test(c.iso) ? `<div class="muted">${esc(c.iso)}</div>` : ''}</div></div>`).join('');
    const uncoveredHtml = [...byCat.entries()].map(([cat, list]) => {
      const un = list.filter((c) => !MAPPED_FROM[c.code]);
      return `<div style="display:grid;gap:6px"><h3 style="font-size:0.9rem">${esc(cat)} <span class="muted num">${un.length} of ${list.length} not covered</span></h3>`
        + `<div class="ulist">${un.map((c) => `<button type="button" class="acell" data-goto-annex="${c.code}"><span class="code">${c.code}</span><span>${esc(c.title)}</span></button>`).join('') || '<span class="muted">All covered</span>'}</div></div>`;
    }).join('');
    return {
      count: '',
      html: `<div class="stats">
        <div class="stat"><b>${CTLS.length}</b><span>Enterprise Controls</span></div>
        <div class="stat"><b>${COVERED.length}</b><span>of ${ANNEX.length} Annex A items mapped from at least one</span></div>
        <div class="stat"><b>${UNCOVERED.length}</b><span>Annex A items no Enterprise Control covers</span></div>
        <div class="stat"><b>${CTLS.length + UNCOVERED.length}</b><span>Controls in a hybrid library, against ${ANNEX.length} base Controls today</span></div>
      </div>
      <div class="banner ill"><span><b>Assumption: a hybrid library, not a full replacement.</b> Document F covers technical, per-environment controls. The ${UNCOVERED.length} uncovered Annex A items (policies, people, physical security and much of A.5) would stay as Annex A Controls next to the ${CTLS.length} Enterprise Controls. Document F maps only to ISO 27001 Annex A, NIST SP 800-53 and NIS2; it says nothing about our Supplementary Controls, so those are assumed to stay as they are.</span></div>
      <section class="card"><h2>Annex A items each Enterprise Control absorbs</h2>
        <p class="muted">From the framework mappings in section 4.3 of the document. One Annex A item can map from several Enterprise Controls. Mappings the document marks "to verify" are shaded. Click an item to see it on the Current side.</p>
        ${absorbedRows}</section>
      <section class="card"><h2>Annex A items no Enterprise Control covers (${UNCOVERED.length})</h2>
        <p class="muted">Every Annex A item that no row of section 4.3 maps to. Under the assumption above, these stay as base Controls.</p>
        ${uncoveredHtml}</section>`,
    };
  }

  // ---- model view ----
  function renderModel() {
    const rows = [
      ['The six environment columns (SaaS, AzPlat, AzWkld, AWS, OnPrem, Legacy)',
        'Deployment Facets are admin-curated classifications a System declares, and they only scope which Systems a Control applies to (for example On-Premises Datacenter, Cloud IaaS/PaaS, SaaS).',
        'Not the same thing. A Facet says where a System runs; it holds no implementation, test or evidence. Two Azure columns and an AWS column would all be Cloud IaaS/PaaS. The columns are a new dimension, closest to "which implementation of this Control".'],
      ['A landing zone (AzPlat, AWS, and the Azure workload zone that inherits it)',
        'A Provider is a System other Systems depend on and inherit Controls from, for example a landing zone (ADR 0008).',
        'Close. The platform landing zones would be Providers; a workload zone would be a System that depends on one. The document\'s COMMON and HYBRID origins correspond to Control Inheritance.'],
      ['Responsible party: P (Provider), SD and SI (shared), C (Customer)',
        'A Control Offering is Full or Shared; a Shared Offering carries a customer responsibility text, and the dependent System\'s own Control Assessment is the customer\'s half.',
        'P is close to a Full Offering, and SD or SI to a Shared one. C is a System-specific implementation. The document\'s distinction between SI and SD has no counterpart.'],
      ['Origin S / C / H and the compensating marker (*)',
        'A Control is either inherited (from the Organization or a Provider) or System-specific. There is no compensating approach.',
        'S is System-specific, C is Full inheritance, H is Shared inheritance. Compensating implementations have no counterpart today.'],
      ['Stage 0 to 6, target Stage at M8, assurance level (AAL0 to AAL3), test method, maximum evidence age',
        'Control Assessments record a status. There is no scale for how automated or continuous an implementation is.',
        'No counterpart today. These would be new concepts and new data.'],
      ['One Control per Annex A item versus 26 Enterprise Controls',
        'Base Controls are seeded 1:1 from ISO 27001:2022 Annex A (ADR 0005); Supplementary Controls cover Requirements with no base Control.',
        'The proposal replaces many base Controls with one. Adopting it would need a new glossary term and an ADR superseding part of ADR 0005. Until then "Enterprise Control Library" is only the name of this proposal.'],
    ];
    return {
      count: '',
      html: `<section class="card"><h2>How this maps to our model</h2>
        <p>Where the document's concepts line up with the domain model (<span class="mono">CONTEXT.md</span>) and where they do not. This is a reading aid for the discussion, not a design.</p>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>In Document F</th><th>In our model today</th><th>Fit</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}
        </tbody></table></div></section>`,
    };
  }

  // ---- detail: current side ----
  function currentDetail(c) {
    let extra = '';
    if (c.code.startsWith('A.')) {
      const from = MAPPED_FROM[c.code];
      extra = `<section><span class="label">In the Enterprise Control Library</span>${from
        ? `<p>Mapped from ${from.map((f) => `<button type="button" class="acell${f.verify ? ' vf' : ''}" data-goto-ctl="${f.id}"><span class="code">${f.id}</span><span>${esc(CTL_BY[f.id].name)}</span>${f.verify ? '<span>(to verify)</span>' : ''}</button>`).join('')}</p>`
        : '<p class="muted">Not covered by any Enterprise Control. In a hybrid library it would stay as this Annex A Control.</p>'}</section>`;
    }
    return detailHtml(c) + extra;
  }

  // ---- detail: enterprise side ----
  const kv = (k, v, isIll) => `<dt>${k}</dt><dd>${v}${isIll ? ill : ''}</dd>`;
  function defaults(c, cell, env) {
    const im = cell.impl;
    const now = cell.stageNow;
    let obs = 'OBSERVABLE';
    if (im.party === 'PROVIDER') obs = 'NOT_OBSERVABLE';
    else if (/NOT_OBSERVABLE/.test(cell.notes)) obs = 'OBSERVABLE, with NOT_OBSERVABLE parts (see notes)';
    return {
      target: 'typical: ' + env.targetTypes,
      obs,
      op: now >= 4 ? 'AUTOMATED' : now >= 2 ? 'SEMI_AUTOMATED' : 'MANUAL',
      resp: now >= 3 ? 'FINDING_AUTO_CREATED' : 'NONE',
      overlay: 'NONE',
    };
  }
  const pips = (now, target) => `<span class="pips" role="img" aria-label="Stage ${now}, target ${target}">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<i class="${i <= now ? 'on' : ''}${i === target ? ' tg' : ''}"></i>`).join('')}</span>`;
  function envCard(c, key, open) {
    const env = ENV_BY[key];
    const cell = c.cells[key];
    const code = c.overview[key];
    let body;
    if (cell.state === 'empty') {
      body = `<dl>${kv('Cell state', 'Empty: no implementation record exists yet. A work item.')}${kv('What the document says', esc(cell.mechanism))}${kv('Stage', `${pips(cell.stageNow, cell.stageTarget)}Stage ${cell.stageNow}, target Stage ${cell.stageTarget}`)}${kv('Notes', esc(cell.notes))}</dl>`;
    } else if (cell.state === 'na') {
      body = `<dl>${kv('Cell state', 'Not applicable, after an approved applicability determination.')}${kv('Reason', esc(cell.mechanism))}${kv('Notes', esc(cell.notes))}</dl>`;
    } else {
      const im = cell.impl;
      const d = cell.full ? null : defaults(c, cell, env);
      const t = cell.test;
      const overlayText = c.id === 'CTL-AC-001' && key === 'LEG' ? 'EXCEPTION_ACTIVE (EXC-2026-000007); the result stays FAIL' : null;
      body = `<dl>
        ${kv('Implementation', `<span class="code">${esc(im.id)}</span>`)}
        ${kv('Responsible party', `${esc(im.party)} <span class="muted">(${PARTY[im.party]})</span>`)}
        ${kv('Origin', esc(im.origin))}
        ${kv('Approach', esc(im.approach) + (im.approach === 'COMPENSATING' ? ' <span class="muted">(*)</span>' : ''))}
        ${kv('Status', esc(im.status))}
        ${kv('Target', cell.full ? esc(cell.targetType) : esc(d.target), !cell.full)}
        ${kv('Observability', esc(cell.full ? cell.observability : d.obs), !cell.full)}
        ${kv('Mechanism', esc(cell.mechanism))}
        ${kv('Test', `<span class="code">${esc(t.id)}</span> ${esc(t.method)}<br>Assurance level ${esc(t.aalNow)} now, designed ${esc(t.aalDesigned)}`)}
        ${kv('Criteria', `<div class="pfu"><p class="pass"><b>PASS</b> ${esc(t.pass)}</p><p class="fail"><b>FAIL</b> ${esc(t.fail)}</p><p class="unk"><b>UNKNOWN</b> ${esc(t.unknown)}</p></div>`)}
        ${kv('Automation', cell.full ? `${esc(cell.opAuto)}; ${esc(cell.respAuto)}` : `${esc(d.op)}; ${esc(d.resp)}`, !cell.full)}
        ${kv('Evidence source', esc(cell.evidence))}
        ${kv('Maximum age', `<span class="mono">${esc(cell.maxAge)}</span>`)}
        ${kv('Stage', `${pips(cell.stageNow, cell.stageTarget)}${cell.stageNow} ${esc(STAGE_NAME[cell.stageNow])}, target ${cell.stageTarget} ${esc(STAGE_NAME[cell.stageTarget])}`)}
        ${cell.full ? kv('Linkage', esc(cell.linkage)) : ''}
        ${kv('Overlay', esc(overlayText || d?.overlay || 'NONE'), !overlayText && !cell.full)}
        ${kv('Notes', esc(cell.notes))}
      </dl>`;
    }
    return `<details class="env" data-env="${key}"${open ? ' open' : ''}><summary><span>${esc(env.label)}</span><span class="cd">${esc(code)}</span></summary><div class="envbody">${body}</div></details>`;
  }
  function enterpriseDetail(c) {
    const openKey = state.env || ENVS.find((e) => c.cells[e.key].state === 'impl')?.key;
    const canon = c.canonical ? `<details class="fold"><summary>Canonical example in the document (illustrative)</summary><dl class="maprows" style="margin-top:8px">${Object.entries(c.canonical).filter(([k]) => !/^Statement$|^control_behavior$|^Owner role|^Parameters$/.test(k)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted" style="margin-top:8px">${esc(c.canonicalNote)}</p></details>` : '';
    const params = c.parameters || (c.canonical && c.canonical.Parameters);
    return `<div class="detail">
      <div class="detail-head">
        <span class="code">${esc(c.id)}</span>
        <h2>${esc(c.name)}</h2>
        <div class="detail-meta"><span class="chip">${esc(c.domainGroup)}</span><span class="chip both">${esc(c.behavior)}</span><span class="chip sup">First milestone ${esc(c.firstM)}</span></div>
      </div>
      <section><span class="label">Statement</span><p class="statement">${esc(c.statement)}</p>
        ${params ? `<p class="muted"><b>Parameters</b> ${esc(params)} ${ill.replace('Not stored in the document; derived from the defaults it states in section 6', 'Values are illustrative in the document')}</p>` : ''}</section>
      <section><span class="label">Control level</span>
        <dl><dt>Owner role</dt><dd>${esc(c.owner)}</dd><dt>Control behaviour</dt><dd>${esc(c.behavior)}</dd></dl></section>
      <section><span class="label">Framework mappings</span>
        <dl class="maprows">
          <dt>ISO 27001 Annex A</dt><dd>${c.annexA.length ? c.annexA.map((a) => `<button type="button" class="acell${a.verify ? ' vf' : ''}" data-goto-annex="${a.code}"><span class="code">${a.code}</span><span>${esc(ANNEX_BY[a.code] ? ANNEX_BY[a.code].title : '')}</span>${a.verify ? '<span>(to verify)</span>' : ''}</button>`).join('') : ''}${/none direct/.test(c.iso) ? esc(c.iso) : ''}</dd>
          <dt>NIST SP 800-53</dt><dd>${verifyMark(c.nist)}</dd>
          <dt>NIS2 Art. 21(2)</dt><dd>${verifyMark(c.nis2)}</dd>
        </dl></section>
      ${canon}
      <section><span class="label">Per environment</span>
        <p class="muted">Values come from the document's illustrative baseline. Fields it gives only as stated defaults carry an <span class="ill-tag" style="margin-left:0">illustrative</span> tag.</p>
        ${ENVS.map((e) => envCard(c, e.key, e.key === openKey)).join('')}</section>
    </div>`;
  }

  // ---- render ----
  function renderMain() {
    const ent = state.side === 'enterprise';
    let r;
    let tool = true;
    if (!ent) r = renderCurrentList();
    else if (state.view === 'crosswalk') { r = renderCrosswalk(); tool = false; }
    else if (state.view === 'model') { r = renderModel(); tool = false; }
    else r = renderMatrix();
    const searchVal = esc(state.q);
    const family = !ent ? `<select id="family" aria-label="Source"><option value="all">All sources</option><option value="ISO 27001 Annex A"${state.family === 'ISO 27001 Annex A' ? ' selected' : ''}>ISO 27001 Annex A</option><option value="CSA CCM Supplementary"${state.family === 'CSA CCM Supplementary' ? ' selected' : ''}>CSA CCM Supplementary</option></select>` : '';
    $('main').innerHTML = (tool ? `<div class="toolbar"><label class="search"><span class="sr">Search</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m11 11 3 3"/></svg><input id="q" type="search" placeholder="${ent ? 'Search code, name or Annex A item' : 'Search code, title or owner'}" value="${searchVal}" autocomplete="off"></label>${family}</div><p class="result" aria-live="polite">${esc(r.count)}</p>` : '') + r.html;
    const q = $('q');
    if (q && state.refocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); state.refocus = false; }
  }
  function renderPanel() {
    const ent = state.side === 'enterprise';
    let html = '';
    if (ent && state.sel) html = enterpriseDetail(CTL_BY[state.sel]);
    else if (!ent && state.sel) html = currentDetail(CONTROLS.find((c) => c.code === state.sel));
    else html = `<div class="empty">${ent ? 'Select an Enterprise Control, or a cell in the matrix, to see its control-level fields and what it looks like in each environment.' : 'Select a Control to see its details.'}</div>`;
    $('panelBody').innerHTML = html;
    document.body.classList.toggle('panel-open', !!state.sel);
  }
  function render() { renderTop(); renderMain(); renderPanel(); }

  // ---- events ----
  function select(id, env) {
    state.sel = id; state.env = env || null;
    writeHash(); renderMain(); renderPanel();
  }
  function setSide(side) { state.side = side; state.sel = null; state.env = null; state.q = ''; writeHash(); render(); }
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-side],[data-view],[data-ctl],[data-code],[data-goto-annex],[data-goto-ctl],#closePanel');
    if (!t) return;
    if (t.dataset.side) return setSide(t.dataset.side);
    if (t.dataset.view) { if (state.side === 'enterprise') { state.view = t.dataset.view; state.sel = null; state.env = null; state.q = ''; writeHash(); render(); } return; }
    if (t.dataset.code) return select(t.dataset.code);
    if (t.dataset.ctl) return select(t.dataset.ctl, t.dataset.env);
    if (t.dataset.gotoAnnex) { state.side = 'current'; state.q = ''; state.family = 'all'; state.sel = t.dataset.gotoAnnex; writeHash(); render(); const a = document.querySelector('.lrow.active'); if (a) a.scrollIntoView({ block: 'center' }); return; }
    if (t.dataset.gotoCtl) { state.side = 'enterprise'; state.view = 'matrix'; state.q = ''; state.sel = t.dataset.gotoCtl; state.env = null; writeHash(); render(); return; }
    if (t.id === 'closePanel') { state.sel = null; state.env = null; writeHash(); renderMain(); renderPanel(); }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') { state.q = ev.target.value; state.refocus = true; renderMain(); }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'family') { state.family = ev.target.value; renderMain(); }
  });
  document.addEventListener('toggle', (ev) => {
    if (ev.target.id === 'legend') state.legendOpen = ev.target.open;
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.sel && matchMedia('(max-width: 1100px)').matches) $('closePanel').click(); });
  window.addEventListener('hashchange', () => { readHash(); render(); });

  // Start from the hash; with none, fall back to the side remembered in this browser.
  if (location.hash) readHash();
  else {
    try { if (localStorage.getItem('enterprise-library-side') === 'enterprise') state.side = 'enterprise'; } catch (e) { /* storage may be blocked */ }
  }
  render();
})();
