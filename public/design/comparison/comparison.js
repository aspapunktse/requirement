/* Shared logic and parts of the Comparison proposals (#370). Every proposal is a different layout of the same two
   views, so this file holds what must not differ: the figures (computed from each Candidate's answers in data.js with
   the formula of docs/how-it-works/comparison.md), the ordering, who may see and do what, the dialogs (Add Candidate,
   Remove, Record outcome with the offer to close the others as Not selected, Reopen, New Comparison, Delete) and the
   small parts (status chip, classification chips, notices, the Control-by-Control table). A proposal supplies only
   the layout:

     CMP.mount({ list(lm) { return html }, page(m) { return html }, after(root, m) {} })

   lm = CMP.listModel() (the Comparisons the acting user may see, each with its model); m = CMP.model(cmp).

   The acting user is the app bar's (#role=..., the 'appbar:role' event). The view is kept in the query (?c=<id> is a
   Comparison's page, none is the list). Nothing persists: the buttons change this page only, and a reload resets it. */
(function (g) {
  'use strict';
  const D = g.CMP_DATA, Kit = g.Kit;
  const TODAY = '2026-11-16';
  const SYSTEM_PAGE = '/design/system/proposal-a.html';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const fmt = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const joinList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  const S = JSON.parse(JSON.stringify(D.comparisons));   // this page's copy; the buttons change it
  const POOL = JSON.parse(JSON.stringify(D.pool));
  const ui = { collapsed: {} };
  let proto = null, dlg = null, opener = null;

  // ---------- statuses ----------
  const STATUS = {
    F: { label: 'Fulfilled', glyph: '✓' },
    P: { label: 'In Progress', glyph: '◐' },
    N: { label: 'Not started', glyph: '○', long: 'Not started (unanswered)' },
    W: { label: 'Waived', glyph: 'W' },
    A: { label: 'Not Applicable', glyph: '–' },
    X: { label: 'Does not apply', glyph: '×', long: 'Does not apply to this Candidate' },
  };
  const stChip = (ch, compact) => `<span class="st st-${ch}${compact ? ' compact' : ''}" title="${esc(STATUS[ch].long || STATUS[ch].label)}"><i class="g" aria-hidden="true">${STATUS[ch].glyph}</i><span class="l">${esc(STATUS[ch].label)}</span></span>`;
  const legend = () => `<div class="legend" aria-label="Status key">${['F', 'P', 'N', 'W', 'A', 'X'].map((k) => stChip(k)).join('')}</div>`;

  // ---------- figures ----------
  // Comparison Score = Fulfilled / (first-round Controls that apply - Not Applicable). Waived, In Progress and unanswered
  // count as not fulfilled; a Control that does not apply (X) is not in the set at all. Answered = everything but unanswered.
  function figures(cmp, cand) {
    let total = 0, fulfilled = 0, na = 0, unanswered = 0, mandNF = 0;
    cand.st.split('').forEach((ch, i) => {
      if (ch === 'X') return;
      total++;
      if (ch === 'F') fulfilled++; else if (ch === 'A') na++; else if (ch === 'N') unanswered++;
      if (D.controls[cmp.controls[i]].mand && ch !== 'F' && ch !== 'A') mandNF++;
    });
    const counted = total - na;
    return { total, answered: total - unanswered, unanswered, counted, fulfilled, na, mandNF,
      ratio: counted ? fulfilled / counted : null, score: counted ? Math.round(fulfilled / counted * 100) : null, complete: unanswered === 0 };
  }
  // Complete Candidates first by score (highest first), then incomplete ones by score (no score last), then fewer
  // mandatory Controls not fulfilled, then name.
  function order(a, b) {
    if (a.f.complete !== b.f.complete) return a.f.complete ? -1 : 1;
    if (a.f.ratio !== b.f.ratio) { if (a.f.ratio === null) return 1; if (b.f.ratio === null) return -1; return b.f.ratio - a.f.ratio; }
    if (a.f.mandNF !== b.f.mandNF) return a.f.mandNF - b.f.mandNF;
    return a.c.name.localeCompare(b.c.name);
  }
  const scoreText = (f) => (f.score === null ? '—' : f.score + '%');

  // What differs between the Candidates' classifications
  const FACETS = [
    ['Deployment Facets', (c) => c.facets.slice().sort().join(', ')],
    ['Sensitivity Level', (c) => c.sens],
    ['Impact Levels', (c) => `Integrity ${c.integ}, Availability ${c.avail}`],
    ['Framework Scope', (c) => c.scope.slice().sort().join(', ')],
  ];
  function differences(cmp) {
    return FACETS.map(([label, fn]) => ({ label, values: [...new Set(cmp.cands.map(fn))] })).filter((x) => x.values.length > 1);
  }

  // ---------- the viewer ----------
  const SEES_ALL = ['ADMIN', 'RISK_OWNER', 'REVIEWER', 'COMPLIANCE_MANAGER'];   // also Internal Auditor and Risk Facilitator in the app
  const CAN_CREATE = ['SYSTEM_OWNER', 'RISK_OWNER', 'ADMIN'];
  function viewer(cmp) {
    const r = g.Appbar ? g.Appbar.role() : { key: 'SYSTEM_OWNER', label: 'System Owner', person: 'Marcus Lindqvist' };
    const p = r.person;
    const seesAll = SEES_ALL.includes(r.key), admin = r.key === 'ADMIN';
    const owner = cmp ? cmp.owner === p : false, participant = cmp ? cmp.participants.includes(p) : false;
    const ownsCand = cmp ? cmp.cands.some((c) => c.owner === p || c.bso === p) : false;
    const manage = owner || admin;
    return { key: r.key, label: r.label, person: p, admin, seesAll, owner, participant, ownsCand, manage,
      sees: seesAll || owner || participant || ownsCand,
      canCreate: CAN_CREATE.includes(r.key),
      canAdd: manage || participant,
      canRemove: (c) => manage || c.owner === p,
      canClose: (c) => c.state === 'active' && !c.ato && (admin || (owner && c.owner === p)),
      canOpen: (c) => seesAll || c.owner === p || c.bso === p };
  }

  // ---------- models ----------
  function model(cmp) {
    const v = viewer(cmp);
    const rows = cmp.cands.map((c) => ({ c, f: figures(cmp, c), open: v.canOpen(c) })).sort(order);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const ctl = cmp.controls.map((k) => ({ key: k, ...D.controls[k] }));
    const diverge = ctl.filter((c, i) => rows.some((r) => r.c.st[i] === 'X')).length;
    const differing = ctl.filter((c, i) => new Set(rows.map((r) => r.c.st[i])).size > 1).length;
    return { cmp, v, rows, ctl, diff: differences(cmp), diverge, differing, closed: cmp.closed, asOf: cmp.closed && cmp.outcome ? cmp.outcome.on : null };
  }
  function listModel() {
    const items = S.filter((c) => viewer(c).sees).map((c) => model(c));
    return { items, open: items.filter((m) => !m.closed), closed: items.filter((m) => m.closed), v: viewer(null), hidden: S.length - items.length };
  }
  const curId = () => new URLSearchParams(location.search).get('c');
  const cur = () => S.find((c) => c.id === curId());

  // ---------- small parts ----------
  const chip = (tone, text, plain) => `<span class="chip ${tone || ''} ${plain ? 'plain' : ''}">${esc(text)}</span>`;
  const person = (name) => `<span class="person"><span class="av" aria-hidden="true">${esc(initials(name))}</span><span class="nm">${esc(name)}</span></span>`;
  const roleKey = () => (g.Appbar ? g.Appbar.roleKey() : 'SYSTEM_OWNER');
  const cmpHref = (id) => location.pathname + (id ? '?c=' + id : '') + location.hash;

  function candName(r) {
    return r.open
      ? `<a class="cname" href="${SYSTEM_PAGE}#role=${roleKey()}">${esc(r.c.name)}</a>`
      : `<span class="nolink">${esc(r.c.name)}</span> <span class="lim" title="You can't open this System. Name, vendor, owner, classification, score, counts and status per Control only.">Limited</span>`;
  }
  // Where the Candidate stands: Rejected can't be chosen; after the outcome the chosen one and the closed ones show.
  function stateChip(r, cmp) {
    const c = r.c;
    if (c.state === 'rejected') return chip('danger', 'Rejected');
    if (c.state === 'notselected') return chip('done', 'Not selected');
    if (cmp.closed && cmp.outcome && cmp.outcome.pick === c.id) return chip('success', 'Chosen');
    if (c.ato) return chip('success', 'Authorized to operate');
    return chip('', c.stage, true);
  }
  function classChips(c, full) {
    const lv = D.SENS.indexOf(c.sens);
    return `<div class="cls"><span class="chip sens plain" data-l="${lv}" title="Sensitivity Level">${esc(c.sens)}</span>${c.facets.map((f) => `<span class="facet" title="Deployment Facet">${esc(f)}</span>`).join('')}
      <small title="Integrity and Availability Impact Levels">${full ? `Integrity ${esc(c.integ)} · Availability ${esc(c.avail)}` : `I ${esc(c.integ)} · A ${esc(c.avail)}`}</small>${full ? `<small title="Framework Scope">${esc(c.scope.join(', '))}</small>` : ''}</div>`;
  }
  const SEV = [['CRITICAL', 'C', 'Critical'], ['HIGH', 'H', 'High'], ['MEDIUM', 'M', 'Medium'], ['LOW', 'L', 'Low']];
  function riskPills(c) {
    const on = SEV.filter(([k]) => c.risks[k] > 0);
    if (!on.length) return '<span class="rks">No open Risks</span>';
    return `<span class="rks" aria-label="Open Risks by severity">${on.map(([k, s, l]) => `<span class="${s}"><b>${c.risks[k]}</b> ${l}</span>`).join('')}</span>`;
  }
  const answeredText = (f) => (f.complete ? `All ${f.total} answered` : `incomplete: ${f.answered} of ${f.total} answered`);
  const answered = (f) => (f.complete ? `<span class="ans">${answeredText(f)}</span>` : `<span class="qbadge" title="${f.unanswered} first-round Controls have no answer yet">${answeredText(f)}</span>`);
  const mandNF = (f) => `<span class="mnf ${f.mandNF ? 'bad' : ''}" title="Mandatory first-round Controls that are not fulfilled">${f.mandNF ? '⚠ ' : ''}${f.mandNF} mandatory not fulfilled</span>`;
  const frozenTag = (m) => (m.closed ? `<span class="frozen" title="Figures frozen when the outcome was recorded">as of ${esc(fmt(m.asOf))}</span>` : '');

  function removeBtn(r, m, cls) {
    return !m.closed && m.v.canRemove(r.c) ? `<button type="button" class="btn sm ghost ${cls || ''}" data-act="remove" data-id="${esc(r.c.id)}" aria-label="Remove ${esc(r.c.name)} from this Comparison">Remove</button>` : '';
  }

  // ---------- page parts ----------
  function actions(m) {
    const { cmp, v } = m, out = [];
    if (!cmp.closed) {
      if (v.canAdd) out.push(`<button type="button" class="btn" data-act="add" ${cmp.cands.length >= 5 ? 'disabled aria-describedby="hint"' : ''}>+ Add Candidate</button>`);
      if (v.manage) out.push(`<button type="button" class="btn primary" data-act="record" ${cmp.cands.length < 2 ? 'disabled aria-describedby="hint"' : ''}>Record outcome</button>`);
      if (v.manage) out.push(`<button type="button" class="btn ghost" data-act="toast" data-msg="Would edit the name, the need and the participants">Edit details</button>`);
      if (v.manage) out.push(`<button type="button" class="btn ghost danger" data-act="del">Delete Comparison</button>`);
    } else if (v.manage) {
      out.push(`<button type="button" class="btn" data-act="reopen">Reopen</button>`);
    }
    return out.join('');
  }
  function hint(m) {
    const { cmp, v } = m;
    if (cmp.closed || !v.canAdd) return '';
    if (cmp.cands.length >= 5) return 'A Comparison holds at most five Candidates. Remove one to add another.';
    if (v.manage && cmp.cands.length < 2) return 'Add at least two Candidates to record an outcome.';
    return '';
  }
  function hero(m) {
    const { cmp, rows } = m, n = rows.length, done = rows.filter((r) => r.f.complete).length;
    const h = hint(m);
    return `<section class="hero" aria-labelledby="pageH">
      <div>
        <div class="eyebrow">Comparison</div>
        <h1 id="pageH">${esc(cmp.name)}</h1>
        <p class="lede"><b>The need.</b> ${esc(cmp.need)}</p>
        <div class="chips">
          ${cmp.closed ? chip('done', 'Closed') + frozenTag(m) : chip('success', 'Open')}
          <span class="meta-i">Owner ${person(cmp.owner)}</span>
          <span class="meta-i">Participants ${cmp.participants.length ? cmp.participants.map(person).join(' ') : '<span>none</span>'}</span>
          <span class="meta-i">${plural(n, 'Candidate')}</span>
        </div>
        <div class="actions">${actions(m)}</div>
        ${h ? `<p class="hint" id="hint">${esc(h)}</p>` : ''}
      </div>
      <div class="move">${Kit.ring(n ? [[done / n, 'var(--ok)'], [(n - done) / n, 'var(--gold)']] : [], 76, 9, `${done}/${n}`, 'complete')}
        <ul><li><i style="background:var(--ok)"></i><b>${done}</b> complete</li><li><i style="background:var(--gold)"></i><b>${n - done}</b> incomplete</li>
        ${rows.some((r) => r.c.state === 'rejected') ? `<li><i style="background:var(--bad)"></i><b>${rows.filter((r) => r.c.state === 'rejected').length}</b> rejected</li>` : ''}</ul></div>
    </section>`;
  }
  function outcome(m) {
    const { cmp } = m;
    if (!cmp.closed) return '';
    const o = cmp.outcome, pick = cmp.cands.find((c) => c.id === o.pick), r = pick && m.rows.find((x) => x.c === pick);
    const left = cmp.cands.filter((c) => c !== pick);
    return `<section class="card outcome" aria-labelledby="outH"><div class="card-h"><h2 id="outH">Outcome</h2><p>Recorded ${esc(fmt(o.on))} by ${esc(o.by)}</p></div><div class="card-b">
      <p class="pick">${pick ? `${chip('success', 'Chosen')} ${candName(r)} <span class="muted small">${esc(pick.vendor)}</span>` : `${chip('', 'None chosen')} <span class="muted small">No Candidate was picked</span>`}</p>
      <blockquote>${esc(o.comment)}</blockquote>
      <p class="muted small" style="margin-top:12px">This Comparison is read-only. The scores, counts and statuses below are frozen as of ${esc(fmt(o.on))}.${left.some((c) => c.state === 'notselected') ? ` ${joinList(left.filter((c) => c.state === 'notselected').map((c) => c.name))} ${left.filter((c) => c.state === 'notselected').length === 1 ? 'was' : 'were'} closed as Not selected; only an Admin can reopen ${left.filter((c) => c.state === 'notselected').length === 1 ? 'it' : 'them'}.` : ''}</p>
    </div></section>`;
  }
  function note(tone, title, body) {
    return `<aside class="note ${tone || ''}" role="note"><span class="ico" aria-hidden="true">${tone === 'warn' ? '!' : 'i'}</span><div><p><b>${title}</b></p>${body}</div></aside>`;
  }
  function diffNotice(m) {
    if (!m.diff.length) return '';
    return note('warn', `Candidates differ in ${joinList(m.diff.map((d) => d.label))}`,
      `<p>Their scores rest on different sets of Controls, so compare them with care. ${m.diverge ? `${plural(m.diverge, 'Control')} ${m.diverge === 1 ? 'does' : 'do'} not apply to at least one Candidate and read “Does not apply” in the table.` : ''}</p>
       <ul class="small" style="margin:4px 0 0;padding-left:18px">${m.diff.map((d) => `<li><b>${esc(d.label)}:</b> ${d.values.map(esc).join(' · ')}</li>`).join('')}</ul>`);
  }
  function roleNote(m) {
    const { v, cmp, rows } = m, lim = rows.filter((r) => !r.open), parts = [];
    if (lim.length) {
      const why = v.owner ? 'you own it' : v.participant ? 'you are a participant' : 'you own or are Business System Owner of a Candidate';
      parts.push(`<p>You see this Comparison because ${why}, but you can open only ${rows.some((r) => r.open) ? joinList(rows.filter((r) => r.open).map((r) => r.c.name)) : 'none of its Candidates'} as a System. ${joinList(lim.map((r) => r.c.name))} ${lim.length === 1 ? 'shows' : 'show'} a limited summary: name, vendor, owner, classification, score, counts and the status per Control. There is no evidence, notes or Risk details, and the name is not a link. The same happens to any viewer who may not open a System.</p>`);
    }
    if (v.manage) parts.push(`<p>${v.owner ? 'You own this Comparison, so you can add and remove Candidates, record the outcome and reopen it.' : 'As an Admin you can do everything on every Comparison.'}</p>`);
    else if (v.canAdd) parts.push(`<p>As a participant you can add Systems you own and remove your own Candidates while it is open. Recording the outcome is for ${esc(cmp.owner)} and Admins.</p>`);
    else if (!cmp.closed || !lim.length) parts.push(`<p>${v.ownsCand ? 'You can remove your own Candidate while it is open.' : `As ${esc(v.label)} you see every Candidate in full and can't change this Comparison. Only its owner and Admins can.`}</p>`);
    return note(lim.length ? 'warn' : '', `Acting as ${esc(v.label)}, ${esc(v.person)}`, parts.join(''));
  }
  function emptyCard(m) {
    return `<section class="card"><div class="empty"><h2>No Candidates yet</h2><p>A Comparison holds two to five Candidates. Add a System that is staged and not closed, or create a new one and answer its first round.</p>${m.v.canAdd && !m.closed ? '<button type="button" class="btn primary" data-act="add">+ Add Candidate</button>' : ''}</div></section>`;
  }
  function noAccess(m) {
    return `<nav class="crumb"><a href="${cmpHref()}" data-act="list">Comparisons</a> / ${esc(m.cmp.name)}</nav>
      <section class="card"><div class="empty"><h2>You can't see this Comparison</h2><p>A Comparison is seen by its owner, its participants, the owner and Business System Owner of each Candidate, and the roles that see every System. Acting as ${esc(m.v.label)} you are none of those.</p><button type="button" class="btn" data-act="list">Back to the list</button></div></section>`;
  }

  // The Control-by-Control table. One row per first-round Control, one column per Candidate; a Control that does not apply
  // to a Candidate reads "Does not apply". opts: filter(ctl, i), group (by Framework, collapsible), cols (rows to show).
  function matrix(m, o) {
    o = o || {};
    const cols = o.cols || m.rows;
    const items = m.ctl.map((c, i) => ({ c, i })).filter((x) => !o.filter || o.filter(x.c, x.i));
    const head = `<tr><th scope="col" class="ctl">Control <span class="muted" style="font-weight:500">(${items.length} of ${m.ctl.length})</span></th>${cols.map((r) => o.headCell ? `<th scope="col" class="cand">${o.headCell(r)}</th>` : `<th scope="col" class="cand">${candName(r)}<br><span class="score ${r.f.score === null ? 'none' : ''}" style="font-size:.95rem">${scoreText(r.f)}</span>${r.f.complete ? '' : ' <span class="ans" title="' + esc(answeredText(r.f)) + '">incomplete</span>'}</th>`).join('')}</tr>`;
    const row = ({ c, i }) => {
      const sts = cols.map((r) => r.c.st[i]), diff = new Set(sts).size > 1;
      return `<tr class="${diff ? 'diff' : ''}"><th scope="row" class="ctl">${esc(c.name)}${c.mand ? '<span class="mand">Mandatory</span>' : ''}<span class="code">${esc(c.code)} · ${esc(c.fw)}</span></th>${sts.map((ch) => `<td class="cell">${stChip(ch, true)}</td>`).join('')}</tr>`;
    };
    let body = '';
    if (!items.length) body = `<tr><td colspan="${cols.length + 1}" class="muted" style="padding:18px">No Controls match.</td></tr>`;
    else if (o.group) {
      const fws = [...new Set(items.map((x) => x.c.fw))];
      body = fws.map((fw) => {
        const its = items.filter((x) => x.c.fw === fw), shut = !!ui.collapsed[fw];
        const fulfilledAll = its.filter((x) => cols.every((r) => r.c.st[x.i] === 'F' || r.c.st[x.i] === 'X')).length;
        return `<tr class="grp"><th scope="colgroup" colspan="${cols.length + 1}" class="ctl" style="position:static;max-width:none;background:var(--raised)"><button type="button" class="link" data-act="grp" data-fw="${esc(fw)}" aria-expanded="${!shut}" style="font-weight:750;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">${shut ? '▸' : '▾'} ${esc(fw)} <span style="font-weight:500;text-transform:none;letter-spacing:0">· ${plural(its.length, 'Control')}, ${fulfilledAll} fulfilled by all</span></button></th></tr>${shut ? '' : its.map(row).join('')}`;
      }).join('');
    } else body = items.map(row).join('');
    return `<div class="mx-wrap" tabindex="0" role="region" aria-label="Control-by-Control table, scrolls sideways">
      <table class="mx"><caption class="sr">One row per first-round Control, one column per Candidate</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  // What a closed Comparison came to, for the list
  function outcomeText(m) {
    if (!m.closed) return '';
    const pick = m.cmp.cands.find((c) => c.id === m.cmp.outcome.pick);
    return pick ? 'Chosen: ' + pick.name : 'None chosen';
  }

  // ---------- dialogs ----------
  function dialog(html, cls) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus(); opener = null; });
      document.body.appendChild(dlg);
    }
    if (!dlg.open) opener = document.activeElement;
    dlg.className = 'cmp-dlg ' + (cls || '');
    dlg.innerHTML = html;
    const hh = dlg.querySelector('h2'); if (hh) dlg.setAttribute('aria-label', hh.textContent);
    if (!dlg.open) dlg.showModal();
    const f = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([disabled]),textarea,select,button');
    if (f) f.focus();
  }
  const closeDlg = () => { if (dlg && dlg.open) dlg.close(); };
  const cancelBtn = '<button type="button" class="btn" data-act="close">Cancel</button>';

  function addDialog() {
    const cmp = cur(), v = viewer(cmp);
    const taken = new Set(cmp.cands.map((c) => c.name));
    const pool = POOL.filter((p) => !taken.has(p.name) && (v.manage ? true : p.owner === v.person));
    dialog(`<form class="dlg-in" data-form="add"><h2>Add Candidate</h2>
      <p class="muted small">A Candidate is a System that is staged and not closed. ${v.manage ? 'You can add a System you can see.' : 'As a participant you can add Systems you own.'} Adding it gives nobody new rights to change it.</p>
      <fieldset><legend>How</legend>
        <label class="opt"><input type="radio" name="how" value="existing" checked><span>An existing System<small>Pick one from the list.</small></span></label>
        <label class="opt"><input type="radio" name="how" value="new"><span>Create a new System<small>The onboarding interview runs; the System joins this Comparison when it is created.</small></span></label>
      </fieldset>
      <div data-show="existing"><label class="fld">System
        <select name="sys" ${pool.length ? '' : 'disabled'}>${pool.length ? pool.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.vendor)}, owner ${esc(p.owner)})</option>`).join('') : '<option>No System you can add</option>'}</select></label></div>
      <div data-show="new" hidden>
        <label class="fld">Name of the new System <input type="text" name="name" autocomplete="off"></label>
        <label class="fld">Classification
          <select name="from"><option value="">Start empty (answer the interview from scratch)</option>${cmp.cands.map((c) => `<option value="${esc(c.id)}">Start from ${esc(c.name)}'s classification</option>`).join('')}</select></label>
        <p class="why">Starting from a Candidate fills in Deployment Facets, Information Types, Sensitivity Level, Impact Levels and Framework Scope. You can change any of them before you create the System.</p></div>
      <footer>${cancelBtn}<button type="submit" class="btn primary">Add Candidate</button></footer></form>`);
  }
  function recordDialog() {
    const cmp = cur();
    const opts = cmp.cands.map((c) => {
      const rej = c.state === 'rejected';
      return `<label class="opt"><input type="radio" name="pick" value="${esc(c.id)}" required ${rej ? 'disabled' : ''}><span>${esc(c.name)}<small>${rej ? 'Rejected at a gate: it can’t be chosen.' : esc(c.vendor)}</small></span></label>`;
    }).join('');
    dialog(`<form class="dlg-in" data-form="record"><h2>Record outcome</h2>
      <p class="muted small">This closes the Comparison. It becomes read-only and each Candidate’s score and counts are frozen as of today. The chosen Candidate does not have to be the top scorer.</p>
      <fieldset><legend>Who is chosen</legend>${opts}
        <label class="opt"><input type="radio" name="pick" value="none" required><span>None chosen<small>No Candidate meets the need.</small></span></label></fieldset>
      <label class="fld">Comment (required)<textarea name="comment" required placeholder="Why this one, or why none"></textarea></label>
      <footer>${cancelBtn}<button type="submit" class="btn primary">Record outcome</button></footer></form>`);
  }
  // After the outcome: the offer to close each Candidate not chosen as Not selected. Never automatic.
  function offerDialog() {
    const cmp = cur(), v = viewer(cmp), pick = cmp.outcome && cmp.outcome.pick;
    const left = cmp.cands.filter((c) => c.id !== pick && c.state !== 'rejected');
    if (!left.length) return;
    dialog(`<div class="dlg-in"><h2>Close the others as Not selected?</h2>
      <p class="muted small">Nothing is closed automatically. A System closed as Not selected is read-only and kept for the record; an Admin can reopen it later. A Candidate you leave open stays an ordinary System.</p>
      <div>${left.map((c) => {
        let right;
        if (c.state === 'notselected') right = chip('done', 'Not selected');
        else if (c.ato) right = '<span class="why">Authorized to operate: it can’t be closed this way.</span>';
        else if (v.canClose(c)) right = `<button type="button" class="btn sm" data-act="notsel" data-id="${esc(c.id)}">Close as Not selected</button>`;
        else right = `<span class="why">Owned by ${esc(c.owner)}: only an Admin can close it.</span>`;
        return `<div class="rowline"><span><b>${esc(c.name)}</b><br><span class="why">${esc(c.stage)}, owner ${esc(c.owner)}</span></span>${right}</div>`;
      }).join('')}</div>
      <footer><button type="button" class="btn primary" data-act="close" autofocus>Done, leave the rest open</button></footer></div>`);
  }
  function simpleDialog(form, title, text, ok, tone) {
    dialog(`<form class="dlg-in" data-form="${form}"><h2>${title}</h2><p class="muted small">${text}</p><footer>${cancelBtn}<button type="submit" class="btn ${tone === 'danger' ? '' : 'primary'}" ${tone === 'danger' ? 'style="color:var(--bad);border-color:var(--bad)"' : ''}>${ok}</button></footer></form>`);
  }
  function newDialog() {
    dialog(`<form class="dlg-in" data-form="new"><h2>New Comparison</h2>
      <p class="muted small">Name the need and add two to five Candidates afterwards. You become its owner.</p>
      <label class="fld">Name <input type="text" name="name" required placeholder="New HR system 2027" autocomplete="off"></label>
      <label class="fld">The need it answers <textarea name="need" required placeholder="What should the chosen System do for whom?"></textarea></label>
      <footer>${cancelBtn}<button type="submit" class="btn primary">Create Comparison</button></footer></form>`);
  }

  const forms = {
    add(f) {
      const cmp = cur(), v = viewer(cmp);
      let base, name, vendor = '—';
      if (f.elements.how.value === 'existing') {
        const p = POOL.find((x) => x.id === f.elements.sys.value); if (!p) return;
        base = p; name = p.name; vendor = p.vendor; POOL.splice(POOL.indexOf(p), 1);
      } else {
        name = f.elements.name.value.trim() || 'New System';
        base = cmp.cands.find((c) => c.id === f.elements.from.value) || { facets: [], sens: 'Internal', integ: 'Low', avail: 'Low', scope: ['ISO 27001'] };
      }
      if (!cmp.controls.length) cmp.controls = D.defaultControls.slice();
      cmp.cands.push({ id: 'n' + Date.now(), name, vendor, owner: f.elements.how.value === 'existing' ? base.owner : v.person, bso: null, stage: 'First round', state: 'active',
        facets: base.facets.slice(), sens: base.sens, integ: base.integ, avail: base.avail, scope: base.scope.slice(), risks: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, st: 'N'.repeat(cmp.controls.length) });
      closeDlg(); render(); Kit.toast(`${name} added. Its first round is still unanswered.`);
    },
    remove(f) {
      const cmp = cur(), c = cmp.cands.find((x) => x.id === f.dataset.id);
      cmp.cands.splice(cmp.cands.indexOf(c), 1);
      closeDlg(); render(); Kit.toast(`${c.name} removed. The System itself is untouched.`);
    },
    record(f) {
      const cmp = cur(), pick = f.elements.pick.value;
      cmp.closed = true;
      cmp.outcome = { pick: pick === 'none' ? null : pick, by: viewer(cmp).person, on: TODAY, comment: f.elements.comment.value.trim() };
      render();
      if (cmp.cands.some((c) => c.id !== cmp.outcome.pick && c.state !== 'rejected')) offerDialog(); else closeDlg();
      Kit.toast('Outcome recorded. The Comparison is closed.');
    },
    reopen() {
      const cmp = cur(); cmp.closed = false; cmp.outcome = null;
      closeDlg(); render(); Kit.toast('Reopened. The figures are live again.');
    },
    del() {
      const cmp = cur(); S.splice(S.indexOf(cmp), 1);
      closeDlg(); go(null); Kit.toast('Comparison deleted. Its Systems are untouched.');
    },
    new(f) {
      const v = viewer(null), id = 'n' + Date.now();
      S.push({ id, name: f.elements.name.value.trim(), need: f.elements.need.value.trim(), owner: v.person, participants: [], created: TODAY, closed: false, outcome: null, controls: [], cands: [] });
      closeDlg(); go(id);
    },
  };

  // ---------- events ----------
  const acts = {
    open: (b) => go(b.dataset.id),
    list: () => go(null),
    add: addDialog,
    record: recordDialog,
    reopen: () => simpleDialog('reopen', 'Reopen this Comparison?', 'The outcome is cleared and the figures are live again. Systems closed as Not selected stay closed until an Admin reopens them.', 'Reopen'),
    del: () => simpleDialog('del', 'Delete this Comparison?', 'Only an open Comparison can be deleted. Its Systems are untouched.', 'Delete Comparison', 'danger'),
    new: newDialog,
    remove: (b) => {
      const c = cur().cands.find((x) => x.id === b.dataset.id);
      dialog(`<form class="dlg-in" data-form="remove" data-id="${esc(c.id)}"><h2>Remove ${esc(c.name)}?</h2><p class="muted small">It leaves this Comparison and the System is untouched. A Candidate’s history records that it was removed.</p><footer>${cancelBtn}<button type="submit" class="btn" style="color:var(--bad);border-color:var(--bad)">Remove Candidate</button></footer></form>`);
    },
    notsel: (b) => {
      const c = cur().cands.find((x) => x.id === b.dataset.id);
      c.state = 'notselected'; render(); offerDialog(); Kit.toast(`${c.name} closed as Not selected. An Admin can reopen it.`);
    },
    grp: (b) => { ui.collapsed[b.dataset.fw] = !ui.collapsed[b.dataset.fw]; render(); const n = document.querySelector(`[data-act="grp"][data-fw="${CSS.escape(b.dataset.fw)}"]`); if (n) n.focus(); },
    close: closeDlg,
    toast: (b) => Kit.toast(b.dataset.msg || 'Would do this in the app'),
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (acts[b.dataset.act]) { e.preventDefault(); acts[b.dataset.act](b, e); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    if (forms[f.dataset.form]) forms[f.dataset.form](f);
  });
  document.addEventListener('change', (e) => {
    if (e.target.name !== 'how') return;
    const f = e.target.form;
    f.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== e.target.value; });
    const nm = f.elements.name; if (nm) nm.required = e.target.value === 'new';
  });

  // ---------- routing and render ----------
  function go(id) {
    history.pushState(null, '', cmpHref(id));
    render(); window.scrollTo(0, 0);
  }
  function render() {
    const root = document.getElementById('page');
    const cmp = cur();
    let m = null;
    if (cmp) {
      m = model(cmp);
      if (!m.v.sees) root.innerHTML = noAccess(m);
      else root.innerHTML = `<nav class="crumb" aria-label="Breadcrumb"><a href="${cmpHref()}" data-act="list">Comparisons</a> / ${esc(cmp.name)}</nav>${m.rows.length ? proto.page(m) : hero(m) + roleNote(m) + emptyCard(m)}`;
      document.title = `${cmp.name}: Comparison`;
    } else {
      root.innerHTML = proto.list(listModel());
      document.title = 'Comparisons';
    }
    if (proto.after) proto.after(root, m);
  }
  function mount(p) {
    proto = p;
    addEventListener('appbar:role', () => { closeDlg(); render(); });
    addEventListener('popstate', render);
    render();
  }

  // Palette entries for the app bar: the Comparisons the acting user may see, and New Comparison
  const paletteItems = () => {
    const lm = listModel();
    const out = lm.items.map((m) => ({ group: 'Comparisons', label: m.cmp.name, sub: m.closed ? 'Closed' : `Open, ${plural(m.rows.length, 'Candidate')}`, icon: 'columns', run: () => go(m.cmp.id) }));
    out.unshift({ group: 'Comparisons', label: 'All Comparisons', sub: 'the list', icon: 'columns', run: () => go(null) });
    if (lm.v.canCreate) out.push({ group: 'Comparisons', label: 'New Comparison', sub: 'action', icon: 'plus', run: () => { go(null); newDialog(); } });
    return out;
  };

  g.CMP = { D, S, ui, esc, plural, fmt, initials, joinList, chip, person, stChip, legend, figures, scoreText, model, listModel, viewer, candName, stateChip, classChips, riskPills, answered, answeredText, mandNF,
    frozenTag, removeBtn, hero, outcome, note, diffNotice, roleNote, matrix, outcomeText, mount, go, paletteItems, render, cmpHref, STATUS, openNew: newDialog, dialog, SYSTEM_PAGE };
})(window);
