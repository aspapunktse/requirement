// Shared model for the Internal Audits list and single-audit proposals (audits-list, audit-detail).
// Builds a register of example Internal Audits on top of window.AUD (audit.js): drafts, launched
// and closed audits, each launched one with its Check-ups (Control, target System or the
// Organization, current recipient, response, evaluation or withdrawal, overdue, the Risk a
// Nonconformity opened). Follows CONTEXT.md: Internal Audit, Check-up, Last audited. Illustrative only.
(function () {
  const A = window.AUD;
  let seed = 977;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const esc = A.esc;
  const day = (n) => A.iso(new Date(Date.now() + n * 864e5));
  const TODAY = A.iso(new Date());
  const AUDITOR = 'Eva Nyström';

  const pack = (id) => (A.PACKS.find((p) => p.id === id) || { codes: [] }).codes;
  const sysWhere = (fn, n) => A.systems.filter(fn).slice(0, n).map((s) => s.id);
  const ANSWERS = ['Yes', 'Yes', 'Yes', 'Yes', 'No', 'N/A'];
  const REASONS = ['The System was retired before the audit closed.', 'Wrong recipient: the Control is covered by the Organization Check-up.', 'Out of scope after the scope was narrowed with the CISO.'];

  // [id, title, scope, status, due offset (days), launched offset, closed offset, codes, systems, org, progress 0..1]
  const SPEC = [
    ['ia-q4-access', 'Q4 2026 · Access control', 'Identities, privileged access and authentication on the business-critical SaaS estate.', 'LAUNCHED', 9, -21, null, pack('access'), sysWhere((s) => s.facets.includes('S'), 8), true, 0.62],
    ['ia-q4-logging', 'Q4 2026 · Logging and monitoring', 'Are logs collected, kept and watched on cloud platforms?', 'LAUNCHED', -3, -40, null, pack('logging'), sysWhere((s) => s.facets.includes('C'), 7), false, 0.8],
    ['ia-suppliers', 'Supplier agreements 2026', 'Agreements, ICT supply chain and cloud services for every vendor-run System.', 'LAUNCHED', 26, -6, null, pack('supplier'), sysWhere((s) => !!s.vendor, 6), true, 0.18],
    ['ia-continuity', 'Backup and continuity check', 'Backups restore and redundancy works where an outage would hurt most.', 'LAUNCHED', 2, -30, null, pack('continuity'), sysWhere((s) => s.c === 'HIGH' || s.a === 'HIGH', 6), true, 1],
    ['ia-draft-crypto', 'Q1 2027 · Cryptography', 'Key management and encryption at rest.', 'DRAFT', 60, null, null, ['A.8.24', 'A.5.31', 'A.8.11', 'A.8.12'].filter((c) => A.byCode.has(c)), sysWhere((s) => s.facets.includes('C'), 5), false, 0],
    ['ia-draft-overdue', 'Not audited in 12 months', '', 'DRAFT', 45, null, null, pack('overdue').slice(0, 9), [], true, 0],
    ['ia-draft-hr', 'People controls · HR systems', 'Screening, terms of employment and awareness, checked with HR.', 'DRAFT', 33, null, null, A.controls.filter((c) => c.domain === 'A.6 People').slice(0, 6).map((c) => c.code), sysWhere((s) => /HR|Workday|People/i.test(s.name + ' ' + (s.units || []).join(' ')), 3), true, 0],
    ['ia-q3-physical', 'Q3 2026 · Physical security', 'Datacenter and office perimeter, on-premises Systems only.', 'CLOSED', -50, -95, -44, A.controls.filter((c) => c.domain === 'A.7 Physical').slice(0, 5).map((c) => c.code), sysWhere((s) => s.facets.includes('O'), 5), true, 1],
    ['ia-q2-access', 'Q2 2026 · Access control', 'Access rights review after the IAM migration.', 'CLOSED', -150, -190, -142, pack('access'), sysWhere((s) => s.facets.includes('S'), 6), true, 1],
    ['ia-q1-logging', 'Q1 2026 · Logging', '', 'CLOSED', -240, -275, -233, pack('logging'), sysWhere((s) => s.facets.includes('C'), 9), false, 1],
    ['ia-2025-supplier', '2025 · Supplier review', 'Annual supplier review.', 'CLOSED', -365, -400, -360, pack('supplier'), sysWhere((s) => !!s.vendor, 8), true, 1],
  ];

  function checkUpsFor(a, progress) {
    const out = [];
    let n = 0;
    for (const code of a.codes) {
      const c = A.byCode.get(code); if (!c) continue;
      const q = [c.question || `Show how ${c.title.toLowerCase()} works in practice.`];
      if (c.applicability !== 'ORGANIZATIONAL') for (const id of a.systems) {
        const s = A.bySys.get(id); if (!s || !A.applies(c, s)) continue;
        out.push({ id: `${a.id}-${++n}`, code, control: c, target: { kind: 'system', id: s.id, name: s.name }, recipient: s.owner, questions: q });
      }
      if (a.org && A.hasOrgImpl(c)) out.push({ id: `${a.id}-${++n}`, code, control: c, target: { kind: 'org', name: 'Organization' }, recipient: c.owner, questions: q });
    }
    const closed = a.status === 'CLOSED';
    for (const cu of out) {
      const r = rnd();
      cu.answered = closed ? r < 0.94 : r < progress + 0.15;
      if (cu.answered) {
        cu.answer = pick(ANSWERS);
        cu.respondedAt = day(Math.round((a.launchedOffset || -10) / 2) + Math.floor(rnd() * 5));
        cu.description = cu.answer === 'Yes' ? 'Reviewed in the last access review; screenshots and the ticket are linked.' : cu.answer === 'No' ? 'Not in place yet: the work is planned for next quarter.' : 'The Control does not apply here: no such data is stored.';
        cu.evidence = cu.answer === 'Yes' ? ['https://confluence.example/evidence/' + cu.id] : [];
      }
      const evaluate = closed || (cu.answered && rnd() < progress);
      if (cu.answered && evaluate) {
        cu.outcome = cu.answer === 'No' ? 'NONCONFORMITY' : rnd() < 0.18 ? 'OBSERVATION' : 'CONFORMING';
        cu.evaluatedAt = day((a.closedOffset || -1) - Math.floor(rnd() * 4));
        cu.evaluatedBy = AUDITOR;
        if (cu.outcome === 'NONCONFORMITY') cu.risk = { id: 'R-' + (200 + out.indexOf(cu)), title: `${cu.control.title}: ${cu.target.name}`, status: closed && rnd() < 0.5 ? 'Mitigated' : 'Open' };
      }
      if (!cu.outcome && (closed || rnd() < 0.05)) cu.withdrawn = { reason: pick(REASONS), by: AUDITOR, at: day(-2) };
      if (!cu.recipient && !cu.withdrawn && !closed) cu.noRecipient = true;
      cu.overdue = a.status === 'LAUNCHED' && !cu.answered && !cu.withdrawn && a.due < TODAY;
    }
    return out;
  }

  const audits = SPEC.map(([id, title, scope, status, due, launched, closed, codes, systems, org, progress]) => {
    const a = { id, title, scope, status, due: day(due), codes, systems, org, createdBy: AUDITOR, launchedOffset: launched, closedOffset: closed,
      launchedAt: launched == null ? null : day(launched), closedAt: closed == null ? null : day(closed), closedBy: closed == null ? null : AUDITOR };
    a.checkUps = status === 'DRAFT' ? [] : checkUpsFor(a, progress);
    return a;
  });
  const byId = new Map(audits.map((a) => [a.id, a]));

  /** Counts for an audit's Check-ups: the progress a launched audit shows and the findings a closed one keeps. */
  function stats(a) {
    const cu = a.checkUps;
    const s = { total: cu.length, answered: 0, notAnswered: 0, awaiting: 0, evaluated: 0, withdrawn: 0, overdue: 0, CONFORMING: 0, OBSERVATION: 0, NONCONFORMITY: 0, risks: 0 };
    for (const c of cu) {
      if (c.withdrawn) { s.withdrawn++; continue; }
      if (c.answered) s.answered++; else s.notAnswered++;
      if (c.outcome) { s.evaluated++; s[c.outcome]++; if (c.risk) s.risks++; } else if (c.answered) s.awaiting++;
      if (c.overdue) s.overdue++;
    }
    s.open = s.total - s.evaluated - s.withdrawn;
    s.done = s.total ? (s.evaluated + s.withdrawn) / s.total : 0;
    s.canClose = a.status === 'LAUNCHED' && s.open === 0;
    return s;
  }

  /** A draft's launch plan, from the same simplified planLaunch the New Internal Audit proposals use. */
  function plan(a) {
    return A.plan({ title: a.title, scope: a.scope, due: a.due, org: a.org, controls: new Set(a.codes), systems: new Set(a.systems), questions: {} });
  }

  /** A Check-up's state, in the words the pages use. */
  function cuState(c) {
    if (c.withdrawn) return { key: 'withdrawn', label: 'Withdrawn', tone: '' };
    if (c.outcome) return { key: 'evaluated', label: OUTCOME[c.outcome].label, tone: OUTCOME[c.outcome].tone };
    if (c.answered) return { key: 'awaiting', label: 'Awaiting evaluation', tone: 'warn' };
    if (c.overdue) return { key: 'overdue', label: 'Overdue', tone: 'danger' };
    return { key: 'notAnswered', label: 'Not answered', tone: '' };
  }
  const OUTCOME = {
    CONFORMING: { label: 'Conforming', tone: 'success', color: 'var(--ok)' },
    OBSERVATION: { label: 'Observation', tone: 'warn', color: 'var(--gold)' },
    NONCONFORMITY: { label: 'Nonconformity', tone: 'danger', color: 'var(--bad)' },
  };
  const STATE_COLOR = { notAnswered: 'var(--line)', overdue: 'var(--bad)', awaiting: 'var(--gold)', evaluated: 'var(--ok)', withdrawn: 'var(--faint)' };
  const STATUS = { DRAFT: { label: 'Draft', tone: '' }, LAUNCHED: { label: 'Launched', tone: 'success' }, CLOSED: { label: 'Closed', tone: 'done' } };

  const chip = (tone, text) => `<span class="chip ${tone || ''}">${esc(text)}</span>`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const isAuditor = () => window.Appbar && Appbar.role && Appbar.role().key === 'INTERNAL_AUDITOR';
  const READERS = ['INTERNAL_AUDITOR', 'ADMIN', 'COMPLIANCE_MANAGER', 'RISK_OWNER'];
  const canRead = () => !window.Appbar || READERS.includes(Appbar.role().key);
  const dueText = (a) => { const n = A.daysUntil(a.due); return a.status !== 'LAUNCHED' ? A.fmtDate(a.due) : n < 0 ? `${-n} days overdue` : n === 0 ? 'Due today' : `Due in ${n} days`; };
  const roleNote = () => `<section class="card"><div class="done-state"><h3>Internal Audits are not available to your role</h3><p>Switch the acting user to the Internal Auditor, an Admin, a Compliance Manager or a Risk Owner in the header.</p></div></section>`;

  // Palette entries: every audit, so Ctrl+K jumps to one.
  const paletteItems = (href) => () => audits.map((a) => ({ group: 'Internal Audits', label: a.title, sub: STATUS[a.status].label + ' · ' + dueText(a), icon: 'audit', href: href(a) }));

  window.AUDS = { audits, byId, stats, plan, cuState, OUTCOME, STATE_COLOR, STATUS, chip, plural, isAuditor, canRead, dueText, roleNote, paletteItems, AUDITOR, TODAY };
})();
