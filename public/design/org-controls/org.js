// Example data and helpers for the Organization Control Implementation proposals. Needs
// ../controls/data.js (CONTROLS), ../shared/kit.js and ../shared/appbar.js first.
// Rules as production has them (src/lib/organization-implementation-rules.ts, CONTEXT.md):
//  - the rows are every Organizational and Both Control; a Control with no implementation reads
//    as Not Started;
//  - the Control Owner, a Compliance Manager or an Admin may edit status and description;
//  - Waived and Not Applicable need a description (the reason);
//  - a Both Control's Fulfilled implementation is inherited by every System it applies to; an
//    Organizational Control's status counts on every System with its Framework in scope.
(function () {
  const esc = Kit.esc;
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const STATUSES = [
    { key: 'NOT_STARTED', label: 'Not Started', tone: 'neutral', short: 'Not started' },
    { key: 'IN_PROGRESS', label: 'In Progress', tone: 'warn', short: 'In progress' },
    { key: 'FULFILLED', label: 'Fulfilled', tone: 'success', short: 'Fulfilled' },
    { key: 'WAIVED', label: 'Waived', tone: 'warn', short: 'Waived' },
    { key: 'NOT_APPLICABLE', label: 'Not Applicable', tone: 'neutral', short: 'N/A' },
  ];
  const NEEDS_REASON = ['WAIVED', 'NOT_APPLICABLE'];
  const statusOf = (k) => STATUSES.find((s) => s.key === k);

  // Short theme for each category, for tabs and grouping
  const THEMES = [
    ['A5', 'Annex A.5 Organizational', (c) => c.category.startsWith('A.5')],
    ['A6', 'Annex A.6 People', (c) => c.category.startsWith('A.6')],
    ['A7', 'Annex A.7 Physical', (c) => c.category.startsWith('A.7')],
    ['A8', 'Annex A.8 Technological', (c) => c.category.startsWith('A.8')],
    ['CCM', 'CSA CCM Supplementary', () => true],
  ];
  const themeOf = (c) => THEMES.find((t) => t[2](c))[0];

  const SAMPLES = {
    FULFILLED: [
      'Approved by the CISO and published on the intranet; reviewed every year in the management review.',
      'Process runs from the ITSM tool with a monthly report to the security forum; last sample check passed.',
      'Owned by Group IT; contract clauses and a yearly attestation cover the suppliers in scope.',
      'Implemented in the HR onboarding checklist; completion tracked per new joiner.',
      'Covered by the Group policy set v4.2; evidence filed in the ISMS document register.',
    ],
    IN_PROGRESS: [
      'Draft procedure with Legal for review; rollout planned for Q1.',
      'Tooling bought; configuration and first run scheduled for December.',
      'Pilot running in two Business Units before group-wide rollout.',
    ],
    WAIVED: ['Accepted by the risk committee on 2026-09-12 until the new site opens; compensating guard patrols in place.', 'Risk accepted for the transition year; re-evaluated at the next management review.'],
    NOT_APPLICABLE: ['The Organization runs no own datacenter; all hosting is with cloud providers.', 'No software is developed in-house; the requirement sits with suppliers.', 'No outsourced development takes place.'],
  };
  const PEOPLE = ['Anna Sjöberg', 'Marcus Lindqvist', 'Sofia Nilsson', 'Kenji Mori', 'Amira Haddad', 'Default Admin'];
  const day = (n) => new Date(Date.UTC(2026, 9, 30) - n * 864e5).toISOString().slice(0, 10);

  let naLeft = 5; // a few Controls the Organization has ruled out, with the reason on record
  const ROWS = window.CONTROLS.filter((c) => c.applicability !== 'PER_SYSTEM').map((c) => {
    let status = c.status === 'IMPLEMENTED' ? 'FULFILLED' : c.status || 'NOT_STARTED';
    const r = rnd();
    if (status !== 'FULFILLED' && r < 0.05) status = 'WAIVED';
    else if (status === 'NOT_STARTED' && naLeft > 0 && /A\.7|Datacenter|Application/.test(c.category)) { status = 'NOT_APPLICABLE'; naLeft--; }
    const touched = status !== 'NOT_STARTED' || rnd() < 0.15;
    const pool = SAMPLES[status];
    const description = pool ? pool[Math.floor(rnd() * pool.length)] : (touched ? 'Scoping started with the Control Owner.' : null);
    const updatedAt = touched ? day(Math.floor(rnd() * rnd() * 160)) : null;
    const updatedBy = touched ? (c.owner && rnd() < 0.7 ? c.owner : PEOPLE[Math.floor(rnd() * PEOPLE.length)]) : null;
    const history = [];
    if (touched) {
      history.push({ at: updatedAt, by: updatedBy, to: status, text: description });
      if (status === 'FULFILLED' && rnd() < 0.7) history.push({ at: day(Math.floor(rnd() * 200) + 40), by: updatedBy, to: 'IN_PROGRESS', text: SAMPLES.IN_PROGRESS[0] });
    }
    return {
      id: c.code, code: c.code, title: c.title, summary: c.description, category: c.category, theme: themeOf(c),
      applicability: c.applicability, owner: c.owner, systems: c.applicability === 'BOTH' ? c.systems : 0,
      maps: c.maps, status, description, updatedAt, updatedBy, history,
    };
  });

  const byId = (id) => ROWS.find((r) => r.id === id);
  const me = () => Appbar.role().person;
  const canEdit = (row) => ['COMPLIANCE_MANAGER', 'ADMIN'].includes(Appbar.roleKey()) || (!!row.owner && row.owner === me());
  const isMine = (row) => row.owner === me();
  const refusal = (status, description) => NEEDS_REASON.includes(status) && !(description || '').trim() ? 'A description is required to set the status to Waived or Not Applicable' : null;
  function save(id, status, description) {
    const row = byId(id);
    const err = refusal(status, description); if (err) return { error: err };
    if (!canEdit(row)) return { error: 'Only the Control Owner, a Compliance Manager or an Admin can change this' };
    const changed = row.status !== status;
    row.status = status; row.description = (description || '').trim() || null;
    row.updatedAt = '2026-10-30'; row.updatedBy = me();
    row.history.unshift({ at: row.updatedAt, by: row.updatedBy, to: status, text: row.description, now: true });
    return { row, changed };
  }
  const counts = (rows = ROWS) => Object.fromEntries(STATUSES.map((s) => [s.key, rows.filter((r) => r.status === s.key).length]));

  // Status colour for bars, rings and dots: Waived and N/A hatched, as accepted gaps are elsewhere
  const COLOR = { NOT_STARTED: 'var(--line)', IN_PROGRESS: 'var(--gold)', FULFILLED: 'var(--ok)', WAIVED: 'var(--gold-ink)', NOT_APPLICABLE: 'var(--faint)' };
  const chip = (k) => { const s = statusOf(k); return `<span class="chip ${s.tone}">${esc(s.label)}</span>`; };
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const av = (name) => name ? `<span class="av" title="${esc(name)}">${esc(initials(name))}</span>` : '<span class="av none" title="No Control Owner">?</span>';
  const owner = (row) => row.owner ? `<span class="own">${av(row.owner)}${esc(row.owner)}</span>` : '<span class="own none">' + av(null) + 'No Control Owner</span>';
  const applies = (row) => row.applicability === 'BOTH' ? `<span class="tag both" title="Also assessed per System; while Fulfilled here, it is inherited">Both</span>` : '<span class="tag">Organizational</span>';
  // What this implementation does for Systems, in one line
  function reach(row) {
    if (!row.maps.length) return 'Not mapped to any Requirement yet, so its status counts on no System.';
    const fws = row.maps.map((m) => m.fw).join(', ');
    if (row.applicability === 'BOTH') return row.status === 'FULFILLED'
      ? `Inherited as Fulfilled by <b>${row.systems}</b> Systems. Maps to ${esc(fws)}.`
      : `Once Fulfilled, inherited by <b>${row.systems}</b> Systems. Maps to ${esc(fws)}.`;
    return `Counts as this status on every System with ${esc(fws)} in scope.`;
  }
  // Stacked status bar
  function bar(rows, cls = '') {
    const c = counts(rows), n = rows.length || 1;
    return `<div class="sbar ${cls}" role="img" aria-label="${STATUSES.map((s) => `${c[s.key]} ${s.label}`).join(', ')}">${STATUSES.filter((s) => c[s.key]).map((s) => `<i class="s-${s.key}" style="flex-grow:${c[s.key]}" title="${c[s.key]} ${s.label}"></i>`).join('')}</div>`;
  }
  const legend = () => `<div class="lg">${STATUSES.map((s) => `<span><i class="s-${s.key}"></i>${s.label}</span>`).join('')}</div>`;
  const fulfilledPct = (rows = ROWS) => rows.length ? Math.round(rows.filter((r) => r.status === 'FULFILLED').length / rows.length * 100) : 0;
  const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const ago = (d) => { if (!d) return 'never'; const n = Math.round((Date.UTC(2026, 9, 30) - Date.parse(d + 'T00:00:00Z')) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 30 ? n + ' d ago' : Math.round(n / 30) + ' mo ago'; };
  const owners = () => { const m = new Map(); ROWS.forEach((r) => { const k = r.owner || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : b[1].length - a[1].length)); };
  const readOnlyNote = () => `You are viewing as ${esc(Appbar.role().person)}, ${esc(Appbar.role().label)}: you can change the Controls you own. A Compliance Manager or an Admin can change any.`;

  // Reason templates for Waived / Not Applicable
  const TEMPLATES = ['Risk accepted by the risk committee on …', 'Not relevant: the Organization does not …', 'Covered by the supplier’s certification until …'];

  // The editor every proposal uses: status as pills, the description, reason templates and the
  // same refusal the API gives. bindEditor wires one rendered editor; onSaved gets the result.
  function editor(row, { next = false, compact = false } = {}) {
    if (!canEdit(row)) return `<p class="readonly-note">${readOnlyNote()}</p>`;
    return `<form class="ed${compact ? ' compact' : ''}" data-ed="${esc(row.id)}" novalidate>
      <fieldset class="spick"><legend>Status of ${esc(row.code)}</legend>${STATUSES.map((s) => `<label class="sp-${s.key}"><input type="radio" name="status" value="${s.key}" ${row.status === s.key ? 'checked' : ''}><i></i>${s.label}</label>`).join('')}</fieldset>
      <label class="field">How the Organization implements it<textarea name="description" rows="${compact ? 3 : 4}" placeholder="What is in place, where the evidence is, or why it is waived">${esc(row.description || '')}</textarea></label>
      <div class="tpls" hidden>${TEMPLATES.map((t) => `<button type="button" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <p class="refuse" aria-live="polite"></p>
      <div class="edrow"><button class="btn primary" type="submit">Save</button>${next ? '<button class="btn" type="submit" data-next>Save and next</button>' : ''}<button class="btn" type="button" data-edcancel>Cancel</button><span class="kh">Ctrl+Enter saves</span></div>
    </form>`;
  }
  function bindEditor(root, onSaved, onCancel) {
    const fm = root.querySelector('form.ed'); if (!fm) return;
    const id = fm.dataset.ed;
    const sync = () => {
      const st = fm.querySelector('[name=status]:checked').value, desc = fm.description.value;
      const err = refusal(st, desc);
      fm.querySelector('.refuse').textContent = err ? err + '.' : '';
      fm.querySelector('.tpls').hidden = !NEEDS_REASON.includes(st);
      fm.querySelectorAll('[type=submit]').forEach((b) => { b.disabled = !!err; });
      fm.description.setAttribute('aria-invalid', String(!!err));
    };
    let nextWanted = false;
    fm.addEventListener('change', sync); fm.addEventListener('input', sync);
    fm.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tpl]'); if (t) { fm.description.value = t.dataset.tpl; fm.description.focus(); sync(); }
      if (e.target.closest('[data-edcancel]') && onCancel) onCancel();
      nextWanted = !!e.target.closest('[data-next]');
    });
    fm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fm.requestSubmit(); }
      if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
    });
    fm.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = save(id, fm.querySelector('[name=status]:checked').value, fm.description.value);
      if (res.error) { fm.querySelector('.refuse').textContent = res.error + '.'; return; }
      Kit.toast(`${res.row.code} saved${res.changed ? ' as ' + statusOf(res.row.status).label : ''}`);
      onSaved(res, nextWanted); nextWanted = false;
    });
    sync();
  }

  const paletteItems = (run) => () => ROWS.map((r) => ({ group: 'Organization Controls', label: `${r.code} ${r.title}`, sub: statusOf(r.status).label, icon: 'control', run: () => run(r.id) }));

  window.ORG = { ROWS, STATUSES, NEEDS_REASON, THEMES, statusOf, byId, canEdit, isMine, refusal, save, counts, COLOR, chip, av, owner, applies, reach, bar, legend, fulfilledPct, fmtDate, ago, owners, readOnlyNote, TEMPLATES, editor, bindEditor, paletteItems, esc, me };
})();
