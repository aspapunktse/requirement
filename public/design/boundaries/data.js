// Example data for the Compliance Boundary proposals (#417, from the examples in #416) and the few derivations the
// pages need: counted Systems, the worst status of a Requirement, the pooled Compliance Percentage, the effective
// Framework Scope of a System and the join preview. All of it is made up for the prototype. The Requirement codes of
// DEF STAN 05-138 are illustrative, not the standard's own numbering.
(function () {
  // Frameworks: each speaks its own language, so a statement's rows are "Annex A controls", "practices", "measures" or "themes".
  const FW = {
    iso: { id: 'iso', name: 'ISO/IEC 27001', short: 'ISO 27001', base: true, unit: 'Annex A controls', one: 'Annex A control', controls: 93 },
    cmmc: { id: 'cmmc', name: 'CMMC Level 1', short: 'CMMC L1', unit: 'practices', one: 'Practice', controls: 17 },
    defstan: { id: 'defstan', name: 'DEF STAN 05-138', short: 'DEF STAN 05-138', unit: 'measures', one: 'Measure', controls: 24 },
    ce: { id: 'ce', name: 'Cyber Essentials', short: 'Cyber Essentials', unit: 'themes', one: 'Theme', controls: 11 },
  };

  // Lifecycle: ONBOARDED and ATO are counted; EVALUATION is "not yet operating"; NOT_SELECTED and REJECTED are closed.
  const STATE = {
    ONBOARDED: { label: 'Onboarded', tone: 'done', group: 'counted' },
    ATO: { label: 'ATO granted', tone: 'success', group: 'counted' },
    EVALUATION: { label: 'In evaluation', tone: 'warn', group: 'pending' },
    NOT_SELECTED: { label: 'Not selected', tone: '', group: 'closed' },
    REJECTED: { label: 'Rejected', tone: 'danger', group: 'closed' },
  };

  // `declared`: Frameworks the System declares (it is prepared for them); `inherit`: share of any new Controls already
  // effectively Fulfilled through what the System inherits from its Providers.
  const SYSTEMS = [
    { id: 'jira', name: 'Jira', bu: 'Corporate IT', owner: 'Marcus Lindqvist', state: 'ONBOARDED', declared: [], inherit: 0.5 },
    { id: 'catia', name: 'CATIA', bu: 'Aerospace Defense', owner: 'Marcus Lindqvist', state: 'ONBOARDED', declared: ['ce'], inherit: 0.2 },
    { id: 'unily', name: 'Unily', bu: 'Corporate IT', owner: 'Johan Berg', state: 'ATO', declared: ['cmmc'], inherit: 0.4 },
    { id: 'm365', name: 'Microsoft 365', bu: 'Corporate IT', owner: 'Sara Ek', state: 'ONBOARDED', declared: ['ce'], inherit: 0.6 },
    { id: 'gh', name: 'GitHub', bu: 'Corporate IT', owner: 'Johan Berg', state: 'ONBOARDED', declared: ['cmmc'], inherit: 0.45 },
    { id: 'entra', name: 'Entra ID SSO', bu: 'Corporate IT', owner: 'Sara Ek', state: 'ONBOARDED', declared: [], inherit: 0.55 },
    { id: 'snow', name: 'ServiceNow', bu: 'Corporate IT', owner: 'Lena Holm', state: 'EVALUATION', declared: [], inherit: 0.3 },
    { id: 'plm', name: 'Legacy PLM', bu: 'Aerospace Defense', owner: 'Marcus Lindqvist', state: 'NOT_SELECTED', declared: [], inherit: 0 },
  ];

  const BOUNDARIES = [
    {
      id: 'isms', name: 'ISMS scope (ISO 27001)', bu: null, owner: 'Anna Sjöberg', fws: ['iso'],
      desc: 'The organization-wide ISMS. Seeded from the old Statement of Applicability and holds every System; the justifications moved onto its Annex A controls.',
      members: ['jira', 'catia', 'unily', 'm365', 'gh', 'entra', 'snow', 'plm'], created: '2026-11-22',
    },
    {
      id: 'fci', name: 'FCI boundary (CMMC Level 1)', bu: 'Aerospace Defense', owner: 'Marcus Lindqvist', fws: ['cmmc'],
      desc: 'Where Federal Contract Information is stored, processed or transmitted for the Aerospace Defense contracts.',
      members: ['jira', 'catia', 'm365', 'entra', 'snow'], created: '2026-11-22',
    },
    {
      id: 'uk', name: 'UK contract X (DEF STAN 05-138 and Cyber Essentials)', bu: 'UK Defence', owner: 'Johan Berg', fws: ['defstan', 'ce'],
      desc: 'Contract reference UKD-2026-0417. The supplier assurance questionnaire is due 2027-01-31.',
      members: ['jira', 'catia', 'gh', 'entra'], created: '2026-11-22',
    },
    {
      id: 'pilot', name: 'Supplier portal pilot (Cyber Essentials)', bu: 'Corporate IT', owner: 'Sara Ek', fws: ['ce'],
      desc: 'Planning the certification of a new supplier portal before it goes live. Nothing is operating yet.',
      members: ['snow'], created: '2026-11-22',
    },
    {
      id: 'ukw', name: 'UK contract W (Cyber Essentials)', bu: 'UK Defence', owner: 'Lena Holm', fws: ['ce'],
      desc: 'Contract reference UKD-2025-0212.',
      members: ['jira', 'm365'], created: '2025-03-04',
      retired: { by: 'Anna Sjöberg', on: '2026-09-30', why: 'The contract ended and the customer no longer asks for the certificate.' },
    },
  ];

  // Requirements per Framework. `s` is a string of "system:status" pairs (M met, P partially met, N not met, A not applicable);
  // `o` is the status of the Organization's implementation of the Controls behind it. One record per System and Requirement:
  // every Boundary the System is in reads the same one. A System without an entry gets the Organization's status, or A.
  const rq = (code, title, s, o) => ({ code, title, s: Object.fromEntries((s || '').split(' ').filter(Boolean).map((p) => p.split(':'))), o: o || null });
  const REQ = {
    iso: [
      rq('A.5.1', 'Policies for information security', '', 'M'),
      rq('A.5.15', 'Access control', 'jira:M catia:M unily:M m365:M gh:P entra:M'),
      rq('A.5.23', 'Information security for use of cloud services', 'jira:M catia:A unily:M m365:P gh:M entra:M'),
      rq('A.6.3', 'Information security awareness, education and training', '', 'P'),
      rq('A.7.4', 'Physical security monitoring', 'jira:A catia:A unily:A m365:A gh:A entra:A'),
      rq('A.8.4', 'Access to source code', 'jira:A catia:A unily:A m365:A gh:M entra:A'),
      rq('A.8.5', 'Secure authentication', 'jira:M catia:M unily:M m365:M gh:M entra:P'),
      rq('A.8.8', 'Management of technical vulnerabilities', 'jira:P catia:N unily:M m365:M gh:M entra:M'),
      rq('A.8.13', 'Information backup', 'jira:M catia:M unily:N m365:M gh:P entra:M'),
      rq('A.8.15', 'Logging', 'jira:M catia:P unily:M m365:M gh:M entra:M'),
      rq('A.8.24', 'Use of cryptography', 'jira:M catia:M unily:M m365:M gh:M entra:M'),
      rq('A.8.26', 'Application security requirements', 'jira:A catia:A unily:A m365:A gh:A entra:A'),
      rq('A.8.28', 'Secure coding', 'jira:A catia:A unily:A m365:A gh:P entra:A'),
      rq('A.8.30', 'Outsourced development', 'jira:A catia:A unily:A m365:A gh:A entra:A'),
      rq('A.8.32', 'Change management', 'jira:M catia:M unily:P m365:M gh:M entra:M'),
    ],
    cmmc: [
      rq('AC.L1-3.1.1', 'Authorized access control', 'jira:M catia:M m365:M entra:M snow:P'),
      rq('AC.L1-3.1.2', 'Transaction and function control', 'jira:M catia:P m365:M entra:M snow:M'),
      rq('AC.L1-3.1.20', 'External connections', 'jira:M catia:M m365:M entra:M snow:M'),
      rq('AC.L1-3.1.22', 'Control public information', 'jira:M catia:A m365:P entra:A snow:M'),
      rq('IA.L1-3.5.1', 'Identify system users', 'jira:M catia:M m365:M entra:M snow:M'),
      rq('IA.L1-3.5.2', 'Authenticate users', 'jira:M catia:N m365:M entra:P snow:M'),
      rq('MP.L1-3.8.3', 'Sanitize or destroy media', 'jira:A catia:A m365:A entra:A snow:A'),
      rq('PE.L1-3.10.1', 'Limit physical access', '', 'M'),
      rq('SC.L1-3.13.1', 'Boundary protection', 'jira:M catia:M m365:M entra:M snow:M'),
      rq('SC.L1-3.13.5', 'Public-access system separation', 'jira:M catia:A m365:M entra:M snow:P'),
      rq('SI.L1-3.14.1', 'Flaw remediation', 'jira:P catia:N m365:M entra:M snow:P'),
      rq('SI.L1-3.14.2', 'Malicious code protection', 'jira:M catia:M m365:M entra:M snow:M'),
    ],
    defstan: [
      rq('M.01', 'Governance and accountability', '', 'M'),
      rq('M.04', 'Access control', 'jira:M catia:M gh:P entra:M'),
      rq('M.07', 'Secure configuration', 'jira:M catia:P gh:M entra:M'),
      rq('M.09', 'Supply chain assurance', '', 'P'),
      rq('M.11', 'Vulnerability management', 'jira:P catia:N gh:M entra:M'),
      rq('M.14', 'Security monitoring', 'jira:M catia:M gh:M entra:M'),
      rq('M.16', 'Incident response', '', 'M'),
      rq('M.18', 'Removable media', 'jira:A catia:A gh:A entra:A'),
      rq('M.20', 'Secure development', 'jira:A catia:A gh:P entra:A'),
    ],
    ce: [
      rq('CE-1', 'Firewalls', 'jira:M catia:M gh:M entra:M m365:M snow:M'),
      rq('CE-2', 'Secure configuration', 'jira:M catia:P gh:M entra:M m365:M snow:P'),
      rq('CE-3', 'Security update management', 'jira:P catia:N gh:M entra:M m365:M snow:P'),
      rq('CE-4', 'User access control', 'jira:M catia:M gh:P entra:M m365:M snow:M'),
      rq('CE-5', 'Malware protection', 'jira:M catia:M gh:M entra:M m365:M snow:M'),
    ],
  };

  // Exclusion justifications, stored per (Boundary, Requirement). A derived exclusion without one is flagged "missing".
  const JUST = {
    isms: {
      'A.7.4': 'None of our Systems runs on premises we operate. Physical monitoring sits with the hosting providers, whose certificates we review each year.',
      'A.8.30': 'Software is developed in-house. If development is ever outsourced this Requirement will apply automatically.',
    },
    fci: { 'MP.L1-3.8.3': 'FCI is never held on removable media. Media handling is covered by the Organization’s own procedure, outside the Systems in this Boundary.' },
    uk: {},
    pilot: {},
  };

  const STATUS = {
    M: { label: 'Met', tone: 'success', color: 'var(--ok)', rank: 1 },
    P: { label: 'Partially met', tone: 'warn', color: 'var(--gold)', rank: 2 },
    N: { label: 'Not met', tone: 'danger', color: 'var(--bad)', rank: 3 },
    A: { label: 'Not applicable', tone: '', color: 'var(--line)', rank: 0 },
  };

  const sys = (id) => SYSTEMS.find((s) => s.id === id);
  const bnd = (id) => BOUNDARIES.find((b) => b.id === id);
  const fwOf = (b) => b.fws.map((f) => FW[f]);
  const group = (s) => STATE[s.state].group;
  const split = (b) => {
    const m = b.members.map(sys);
    return { counted: m.filter((s) => group(s) === 'counted'), pending: m.filter((s) => group(s) === 'pending'), closed: m.filter((s) => group(s) === 'closed') };
  };
  const eff = (r, sid) => r.s[sid] || r.o || 'A';
  const worst = (list) => list.reduce((w, st) => (STATUS[st].rank > STATUS[w].rank ? st : w), 'M');

  // One row of a statement: included when it applies to a counted System or the Organization implements it.
  function row(b, fwId, r) {
    const { counted } = split(b);
    const per = counted.map((s) => ({ sys: s, st: eff(r, s.id) }));
    const app = per.filter((p) => p.st !== 'A');
    const included = app.length > 0 || !!r.o;
    const orgOnly = !!r.o && !Object.keys(r.s).length;
    const st = app.length ? worst(app.map((p) => p.st)) : r.o || null;
    return { fw: fwId, code: r.code, title: r.title, per, app, included, orgOnly, org: r.o, st, met: app.filter((p) => p.st === 'M').length, of: app.length, key: b.id + ':' + r.code };
  }
  const rows = (b, fwId) => REQ[fwId].map((r) => row(b, fwId, r));

  // Compliance Percentage for one Framework: pooled over the counted Systems (total Met / total applicable), null with nothing applicable.
  function pct(b, fwId) {
    const { counted } = split(b);
    let met = 0, app = 0;
    counted.forEach((s) => REQ[fwId].forEach((r) => { const st = eff(r, s.id); if (st !== 'A') { app++; if (st === 'M') met++; } }));
    return { met, app, systems: counted.length, value: app ? Math.round((met / app) * 100) : null };
  }

  // Where each Framework of a System's effective scope comes from.
  function scope(s) {
    const via = (f) => BOUNDARIES.filter((b) => !b.retired && b.members.includes(s.id) && b.fws.includes(f));
    return Object.keys(FW).map((f) => ({ fw: FW[f], base: !!FW[f].base, declared: s.declared.includes(f), via: via(f) }))
      .filter((r) => r.base || r.declared || r.via.length);
  }
  const boundariesOf = (s) => BOUNDARIES.filter((b) => b.members.includes(s.id));

  // Systems prepared for (declare) a non-base Framework of the Boundary, not in it and not closed.
  function candidates(b) {
    if (b.retired) return [];
    return SYSTEMS.filter((s) => !b.members.includes(s.id) && group(s) !== 'closed' && b.fws.some((f) => !FW[f].base && s.declared.includes(f)));
  }
  // Systems that can still be added at all (not closed, not a member, not a candidate).
  const addable = (b) => SYSTEMS.filter((s) => !b.members.includes(s.id) && group(s) !== 'closed' && !candidates(b).includes(s));

  // What joining would bring. A Framework is new for the System unless it is the base, declared, or already held by another of its Boundaries.
  function preview(b, s) {
    const others = BOUNDARIES.filter((x) => x.id !== b.id && !x.retired && x.members.includes(s.id));
    const prepared = b.fws.filter((f) => !FW[f].base && s.declared.includes(f));
    const fresh = b.fws.filter((f) => !FW[f].base && !s.declared.includes(f) && !others.some((o) => o.fws.includes(f)));
    const viaOther = b.fws.filter((f) => !FW[f].base && !s.declared.includes(f) && others.some((o) => o.fws.includes(f)));
    const controls = fresh.reduce((n, f) => n + FW[f].controls, 0);
    const fulfilled = Math.round(controls * s.inherit);
    const onboarded = s.state === 'ONBOARDED';
    return { prepared, fresh, viaOther, others, controls, fulfilled, review: onboarded && controls > 0, onboarded, counted: group(s) === 'counted' };
  }

  window.BND = { FW, STATE, SYSTEMS, BOUNDARIES, REQ, JUST, STATUS, sys, bnd, fwOf, group, split, row, rows, pct, scope, boundariesOf, candidates, addable, preview, eff };
})();
