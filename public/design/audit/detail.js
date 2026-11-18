// Shared parts of the single Internal Audit proposals (audit-detail A, B, C): which audit to show
// (?id=, or the Draft / Launched / Closed switch), the hero with the audit's state and actions, the draft's
// read view (scope, launch preview, Controls with their questions, Systems), the close banner and the
// Check-up panel (questions, response, evaluation or withdrawal). Each proposal draws the launched and
// closed body its own way. Actions are mocked: they show a toast and change nothing.
(function () {
  const A = window.AUD, S = window.AUDS, { esc, icon } = A, Kit = window.Kit;
  const params = new URLSearchParams(location.search);
  const SAMPLE = { DRAFT: 'ia-draft-crypto', LAUNCHED: 'ia-q4-access', CLOSED: 'ia-q3-physical' };
  let current = S.byId.get(params.get('id')) || S.byId.get(SAMPLE[params.get('state')] || SAMPLE.LAUNCHED);

  function setState(st) { current = S.byId.get(SAMPLE[st]); history.replaceState(null, '', `?state=${st}${location.hash}`); window.dispatchEvent(new Event('audit:change')); }

  function stateSwitch() {
    return `<div class="seg" role="group" aria-label="Show an audit that is">${['DRAFT', 'LAUNCHED', 'CLOSED'].map((k) => `<button type="button" data-state="${k}" aria-pressed="${current.status === k}">${S.STATUS[k].label}</button>`).join('')}</div>`;
  }

  function hero(a, st, extra = '') {
    const auditor = S.isAuditor();
    let actions = '';
    if (auditor && a.status === 'DRAFT') { const p = S.plan(a); actions = `<a class="btn" href="proposal-a.html${location.hash}">${icon('edit', 15)} Edit</a><button class="btn" type="button" data-mock="Deleted the draft (mock)">Delete</button><button class="btn primary" type="button" ${p.launch.length || !p.total ? 'disabled title="Fix what blocks the launch first"' : ''} data-mock="Launched: ${p.total} Check-ups sent (mock)">${icon('send', 15)} Launch</button>`; }
    if (auditor && a.status === 'LAUNCHED') actions = `<button class="btn primary" type="button" ${st.canClose ? '' : `disabled title="${st.open} Check-ups are neither evaluated nor withdrawn"`} data-mock="Closed the audit (mock)">Close audit</button>`;
    const line = a.status === 'DRAFT' ? 'Draft · nothing has been sent to anyone and no Check-up exists'
      : a.status === 'LAUNCHED' ? `Launched ${A.fmtDate(a.launchedAt)} by ${a.createdBy} · its Controls, Systems and questions can no longer change`
      : `Closed ${A.fmtDate(a.closedAt)} by ${a.closedBy} · the audit, its Check-ups, responses, evaluations and withdrawals are read-only for everyone`;
    return `<div class="crumb" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span style="font-size:.8rem;color:var(--muted)"><a href="list-a.html${location.hash}" style="color:var(--accent);font-weight:650;text-decoration:none">Internal Audits</a> / ${esc(a.title)}</span><span style="display:flex;gap:8px;align-items:center"><span class="muted" style="font-size:.76rem">Preview an audit that is</span>${stateSwitch()}</span></div>
      <section class="hero" aria-labelledby="pageH"><div>
        <div class="eyebrow">Internal Audit</div><h1 id="pageH">${esc(a.title)}</h1>
        <p class="lede">${a.scope ? esc(a.scope) : '<span style="color:var(--faint)">No scope description.</span>'}</p>
        <div class="chips">${S.chip(S.STATUS[a.status].tone, S.STATUS[a.status].label)}${S.chip(a.status === 'LAUNCHED' && A.daysUntil(a.due) < 0 ? 'danger' : '', a.status === 'LAUNCHED' ? S.dueText(a) : 'Due ' + A.fmtDate(a.due))}<span class="muted" style="font-size:.8rem">${esc(line)}</span></div>
        ${actions ? `<div class="chips" style="margin-top:14px">${actions}</div>` : ''}</div>${extra}</section>`;
  }

  /** The draft's read view: what launching would generate and what it is made of. */
  function draftBody(a) {
    const p = S.plan(a), t = Math.max(1, p.total + p.skipped);
    const blockers = p.launch.length ? p.launch.map((b) => `<li class="warn"><span class="mk">${icon('alert', 12)}</span><span>${esc(b.text)}<small>${esc(b.codes.slice(0, 6).join(', '))}</small></span></li>`).join('')
      : `<li class="ok"><span class="mk">${icon('check', 12)}</span><span>Nothing blocks the launch<small>Launching sends ${p.total} Check-ups now</small></span></li>`;
    const max = Math.max(1, ...p.recipients.map((r) => r.n + r.load));
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;align-items:start" class="dgrid">
      <div style="display:grid;gap:18px;min-width:0">
        <section class="card"><div class="card-h"><h2>Controls and questions</h2><p>${S.plural(a.codes.length, 'Control')} · each Check-up carries a copy of its Control's questions</p></div>
          <div class="card-b" style="display:grid;gap:2px">${a.codes.map((k) => { const c = A.byCode.get(k); return `<div style="display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft);align-items:start"><span class="code">${esc(k)}</span><span><b style="font-size:.88rem">${esc(c.title)}</b><small style="display:block;color:${c.question ? 'var(--muted)' : 'var(--bad)'};font-size:.8rem">${esc(c.question || 'No question yet: write one before launch')}</small></span><span class="appl ${c.applicability}">${c.applicability === 'PER_SYSTEM' ? 'Per System' : c.applicability === 'BOTH' ? 'Both' : 'Organizational'}</span></div>`; }).join('')}</div></section>
        <section class="card"><div class="card-h"><h2>Where</h2><p>${S.plural(a.systems.length, 'System')}${a.org ? ' and the Organization' : ''}</p></div>
          <div class="card-b chips">${a.systems.map((id) => `<span class="chip plain">${esc(A.bySys.get(id).name)}</span>`).join('') || '<span class="muted">No Systems picked.</span>'}${a.org ? `<span class="chip done">Organization Control Implementations</span>` : ''}</div></section>
      </div>
      <aside class="card"><div class="card-h"><h2>If launched now</h2><p>updates when the draft changes</p></div>
        <div class="card-b" style="display:grid;gap:14px">
          <div style="display:flex;gap:14px;align-items:center">${A.ring([[p.sys / t, 'var(--accent)'], [p.org / t, '#8a5cc2'], [p.skipped / t, 'var(--line)']], 108, 11, String(p.total), 'Check-ups')}
            <div class="legend-row" style="display:grid"><span><i style="background:var(--accent)"></i><b>${p.sys}</b> System-level</span><span><i style="background:#8a5cc2"></i><b>${p.org}</b> Organization-level</span><span><i style="background:var(--line)"></i><b>${p.skipped}</b> skipped pairs</span></div></div>
          <div><div class="label" style="margin-bottom:4px">Before it can launch</div><ul class="ready">${blockers}</ul></div>
          <div><div class="label" style="margin-bottom:6px">Who receives Check-ups · ${p.recipients.length}</div><div class="load">${p.recipients.slice(0, 6).map((r) => `<div class="load-row"><span class="av">${esc(A.initials(r.who))}</span><span class="nm"><span>${esc(r.who)}</span><small>${[...r.role].join(' · ')}${r.load ? ` · ${r.load} open` : ''}</small></span><b>${r.n}</b><span class="load-track"><i style="width:${r.n / max * 100}%;background:var(--accent)"></i><i style="width:${r.load / max * 100}%;background:var(--gold)"></i></span></div>`).join('')}</div></div>
        </div></aside></div>`;
  }

  /** Closed: the findings, kept as they were. Launched: whether the audit can be closed. */
  function closeBanner(a, st) {
    if (a.status === 'CLOSED') {
      return `<section class="card"><div class="card-h"><h2>Findings</h2><p>kept as they were when the audit closed</p></div><div class="card-b" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${[['CONFORMING', st.CONFORMING], ['OBSERVATION', st.OBSERVATION], ['NONCONFORMITY', st.NONCONFORMITY]].map(([k, n]) => `<div class="stat card" style="box-shadow:none"><span class="k">${S.OUTCOME[k].label}</span><span class="v" style="color:${S.OUTCOME[k].color}">${n}</span></div>`).join('')}
        <div class="stat card" style="box-shadow:none"><span class="k">Risks opened</span><span class="v">${st.risks}</span></div><div class="stat card" style="box-shadow:none"><span class="k">Withdrawn</span><span class="v" style="color:var(--faint)">${st.withdrawn}</span></div></div></section>`;
    }
    if (st.canClose) return `<div class="note" style="background:var(--ok-soft);color:var(--ok);border:0">${icon('check', 16)} Every Check-up is evaluated or withdrawn. ${S.isAuditor() ? 'Close the audit to make it read-only.' : 'The Internal Auditor can close it.'}</div>`;
    return `<div class="note">${icon('clock', 16)} ${S.plural(st.open, 'Check-up is', 'Check-ups are')} neither evaluated nor withdrawn, so the audit can't be closed yet.</div>`;
  }

  /** One Check-up in full: the questions, the response and the evaluation (or the form, for the Internal Auditor). */
  function checkUpPanel(a, c) {
    const s = S.cuState(c), auditor = S.isAuditor() && a.status === 'LAUNCHED';
    const resp = c.answered ? `<div style="display:grid;gap:4px"><div class="label">Response · ${esc(c.recipient || '')}, ${esc(A.fmtDate(c.respondedAt))}</div><p><b>${esc(c.answer)}</b> · ${esc(c.description)}</p>${c.evidence.map((e) => `<a href="#" style="font-size:.82rem;color:var(--accent)">${esc(e)}</a>`).join('')}</div>`
      : `<p class="muted">${c.overdue ? '<b style="color:var(--bad)">Overdue:</b> ' : ''}Not answered yet${c.recipient ? ` by ${esc(c.recipient)}` : ''}.</p>`;
    let ev = '';
    if (c.withdrawn) ev = `<div class="note">Withdrawn by ${esc(c.withdrawn.by)} on ${esc(A.fmtDate(c.withdrawn.at))}: ${esc(c.withdrawn.reason)}</div>`;
    else if (c.outcome) ev = `<div style="display:grid;gap:6px"><div class="label">Evaluation · ${esc(c.evaluatedBy)}, ${esc(A.fmtDate(c.evaluatedAt))}</div><div>${S.chip(s.tone, s.label)}</div>${c.risk ? `<p style="font-size:.84rem">Opened Risk <a href="#" style="color:var(--accent);font-weight:650">${esc(c.risk.id)}</a> · ${esc(c.risk.status)}</p>` : ''}</div>`;
    else if (auditor && c.answered) ev = `<div style="display:grid;gap:8px"><div class="label">Evaluate</div><div class="seg" role="group" aria-label="Outcome">${Object.entries(S.OUTCOME).map(([k, o]) => `<button type="button" data-mock="Evaluated as ${o.label} (mock)">${o.label}</button>`).join('')}</div><small class="muted">A Nonconformity opens a Risk and sets a Fulfilled assessment back to In Progress.</small></div>`;
    const withdraw = auditor && !c.outcome && !c.withdrawn ? `<button class="btn" type="button" data-mock="Withdrawn with a reason (mock)">Withdraw…</button>` : '';
    return `<div style="display:grid;gap:14px">
      <div><span class="code">${esc(c.code)}</span> <b>${esc(c.control.title)}</b><div class="muted" style="font-size:.82rem;margin-top:2px">${c.target.kind === 'org' ? 'Organization' : esc(c.target.name)} · ${c.recipient ? esc(c.recipient) : '<span style="color:var(--bad)">No Control Owner</span>'} · ${S.chip(s.tone, s.label)}</div></div>
      <div><div class="label">${c.questions.length === 1 ? 'Question' : 'Questions'}</div><ol style="margin:4px 0 0;padding-left:18px">${c.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>
      ${resp}${ev}${withdraw ? `<div>${withdraw}</div>` : ''}</div>`;
  }

  function mount(render, label, siblings) {
    const draw = () => { const root = document.getElementById('page'); root.innerHTML = S.canRead() ? render(current) : S.roleNote(); };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-state]'); if (b) setState(b.dataset.state);
      const m = e.target.closest('[data-mock]'); if (m && !m.disabled) A.toast(esc(m.dataset.mock));
    });
    addEventListener('audit:change', draw); addEventListener('appbar:role', draw);
    Appbar.mount({ current: 'audits', proposal: { label, siblings }, items: S.paletteItems((a) => `?id=${a.id}${location.hash}`) });
    draw();
    return draw;
  }

  window.AUDD = { current: () => current, hero, draftBody, closeBanner, checkUpPanel, mount };
})();
