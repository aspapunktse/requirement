/* Shared data and helpers for the Statement of Applicability proposals. Derives one SoA row per
   Control from the Control Library example data (../controls/data.js, ~300 Controls): whether it
   is included, the generated inclusion justification, an authored exclusion justification (or
   none), the Organization's implementation status and the Systems' effective-status rollup.
   Everything generated is deterministic, so both proposals show the same Statement. */
(function () {
  const { esc, highlight } = Lib;

  // Small deterministic hash so the same Control always gets the same generated values.
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };

  const STATUS = { FULFILLED: 'Fulfilled', IN_PROGRESS: 'In Progress', NOT_STARTED: 'Not Started', WAIVED: 'Waived', NOT_APPLICABLE: 'Not Applicable' };
  const ROLLUP_ORDER = ['FULFILLED', 'IN_PROGRESS', 'NOT_STARTED', 'WAIVED', 'NOT_APPLICABLE'];
  const ORG_FROM_LIBRARY = { IMPLEMENTED: 'FULFILLED', IN_PROGRESS: 'IN_PROGRESS', NOT_STARTED: 'NOT_STARTED' };
  const APPLIES = { ORGANIZATIONAL: 'Organizational', PER_SYSTEM: 'Per System', BOTH: 'Both' };

  const CCM_DOMAINS = {
    'Audit & Assurance': 'A&A', 'Application & Interface Security': 'AIS', 'Business Continuity Management and Operational Resilience': 'BCR',
    'Change Control and Configuration Management': 'CCC', 'Cryptography, Encryption & Key Management': 'CEK', 'Datacenter Security': 'DCS',
    'Data Security and Privacy Lifecycle Management': 'DSP', 'Governance, Risk and Compliance': 'GRC', 'Human Resources': 'HRS',
    'Identity & Access Management': 'IAM', 'Interoperability & Portability': 'IPY', 'Infrastructure Security': 'I&S', 'Logging and Monitoring': 'LOG',
    'Security Incident Management, E-Discovery, & Cloud Forensics': 'SEF', 'Supply Chain Management, Transparency, and Accountability': 'STA',
    'Threat & Vulnerability Management': 'TVM', 'Universal Endpoint Management': 'UEM', 'CCM cloud provider obligations': 'CCM',
  };
  // Short names for the domains, used where space is tight (tiles, group headers on phones).
  const SHORT = {
    'A.5 Organizational': 'Organizational', 'A.6 People': 'People', 'A.7 Physical': 'Physical', 'A.8 Technological': 'Technological',
    'Business Continuity Management and Operational Resilience': 'Business continuity', 'Change Control and Configuration Management': 'Change & configuration',
    'Cryptography, Encryption & Key Management': 'Cryptography & keys', 'Data Security and Privacy Lifecycle Management': 'Data security & privacy',
    'Security Incident Management, E-Discovery, & Cloud Forensics': 'Incidents & forensics', 'Supply Chain Management, Transparency, and Accountability': 'Supply chain',
    'Application & Interface Security': 'Application security', 'Governance, Risk and Compliance': 'Governance & risk', 'Identity & Access Management': 'Identity & access',
    'Threat & Vulnerability Management': 'Threats & vulnerabilities', 'Universal Endpoint Management': 'Endpoints', 'CCM cloud provider obligations': 'Cloud provider obligations',
    'Interoperability & Portability': 'Interoperability',
  };

  const EXCLUSION_TEXTS = [
    'We run no datacenter of our own; all hosting is in Azure and AWS, covered by the providers’ SOC 2 Type II reports.',
    'No System in scope develops software in-house; all applications are SaaS bought under the supplier agreement process (A.5.20).',
    'No System processes cardholder data, and the risk assessment of 2026-03 found no other information this Control protects.',
    'Outsourced to the managed service provider under contract MSP-2024-07; their ISAE 3402 report is reviewed yearly (A.5.22).',
    'No removable media is allowed on managed endpoints; USB storage is blocked by policy, so there is nothing to handle.',
    'Physical offices hold no information processing facilities beyond end-user devices; see the risk assessment, section 4.2.',
  ];
  const TEMPLATES = [
    { label: 'Not in our scope', text: 'No System or process in the ISMS scope uses this; see the scope statement (clause 4.3).' },
    { label: 'Covered by a provider', text: 'Implemented by our cloud provider; we rely on their attestation, reviewed under A.5.22.' },
    { label: 'Risk accepted', text: 'The risk assessment found no risk this Control would treat; the Risk Owner accepted this on ' },
    { label: 'Outsourced', text: 'Outsourced under contract ; the supplier’s assurance report is reviewed yearly.' },
  ];

  function requirementCodes(c) {
    if (c.code.startsWith('A.')) {
      const extra = { 'A.5.1': '5.2, ', 'A.5.2': '5.3, ', 'A.5.4': '5.1, ', 'A.5.31': '4.2, ', 'A.5.35': '9.2, ', 'A.5.36': '9.1, ' }[c.code] || '';
      return [{ fw: 'ISO/IEC 27001:2022', codes: extra + c.code }].concat(hash(c.code + 'ccm') < 0.45 ? [{ fw: 'CSA CCM 4.1.1', codes: 'GRC-' + String(1 + Math.floor(hash(c.code) * 9)).padStart(2, '0') }] : []);
    }
    const dom = CCM_DOMAINS[c.category] || 'CCM';
    const n = String(1 + Math.floor(hash(c.code) * 14)).padStart(2, '0');
    const out = [{ fw: 'CSA CCM 4.1.1', codes: `${dom}-${n}` }];
    if (hash(c.code + 'nis') < 0.3) out.push({ fw: 'Cybersäkerhetslagen', codes: '3 kap. ' + (1 + Math.floor(hash(c.code + 'p') * 9)) + ' §' });
    return out;
  }

  const rows = CONTROLS.map((c) => {
    const r = hash(c.code + 'soa');
    const appliesToOrganization = c.applicability !== 'PER_SYSTEM';
    let systems = c.applicability === 'ORGANIZATIONAL' ? 0 : c.systems;
    // Exclusions: Per-System Controls no System needs, plus a few Organizational ones that are out of scope.
    let included = true;
    if (c.applicability === 'PER_SYSTEM' && (systems === 0 || r < 0.12)) { included = false; systems = 0; }
    if (c.applicability !== 'PER_SYSTEM' && r < 0.045) included = false;
    const exclusion = included ? null : (r * 1000) % 1 < 0.62 ? EXCLUSION_TEXTS[Math.floor(hash(c.code + 'x') * EXCLUSION_TEXTS.length)] : null;

    const orgStatus = included && appliesToOrganization ? ORG_FROM_LIBRARY[c.status] || 'NOT_STARTED' : null;
    let rollup = null;
    if (included && systems > 0) {
      // Spread the Systems over effective statuses; most are Fulfilled, as in the live data.
      const f = 0.45 + hash(c.code + 'f') * 0.5, ip = hash(c.code + 'i') * (1 - f) * 0.6, w = hash(c.code + 'w') < 0.12 ? (1 - f - ip) * 0.5 : 0;
      const counts = { FULFILLED: Math.round(systems * f), IN_PROGRESS: Math.round(systems * ip), WAIVED: Math.round(systems * w), NOT_APPLICABLE: hash(c.code + 'n') < 0.1 ? 1 : 0 };
      counts.NOT_STARTED = Math.max(0, systems - counts.FULFILLED - counts.IN_PROGRESS - counts.WAIVED - counts.NOT_APPLICABLE);
      rollup = counts;
    }
    const fulfilledShare = rollup ? (rollup.FULFILLED + rollup.WAIVED + rollup.NOT_APPLICABLE) / systems : null;
    return {
      id: c.id, control: c, code: c.code, title: c.title, description: c.description, domain: c.category, short: SHORT[c.category] || c.category,
      family: c.code.startsWith('A.') ? 'ISO/IEC 27001:2022 Annex A' : 'CSA CCM Supplementary',
      applicability: c.applicability, owner: c.owner,
      included, appliesToOrganization: included && appliesToOrganization, systems,
      requirements: included ? requirementCodes(c) : [],
      exclusion, missing: !included && !exclusion,
      orgStatus, rollup, fulfilledShare,
      hay: (c.code + ' ' + c.title + ' ' + c.category + ' ' + (exclusion || '')).toLowerCase(),
    };
  });

  // Implementation progress of one row, 0..1: the Organization's status and the share of Systems fulfilled.
  function progress(r) {
    if (!r.included) return null;
    const parts = [];
    if (r.orgStatus) parts.push(r.orgStatus === 'FULFILLED' ? 1 : r.orgStatus === 'IN_PROGRESS' ? 0.5 : 0);
    if (r.rollup) parts.push(r.fulfilledShare);
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  }
  rows.forEach((r) => { r.progress = progress(r); });

  const domains = [];
  rows.forEach((r) => { let d = domains.find((x) => x.name === r.domain); if (!d) domains.push(d = { name: r.domain, short: r.short, family: r.family, rows: [] }); d.rows.push(r); });

  const SYSTEM_NAMES = ['Payroll (Workday)', 'Customer Portal', 'Data Warehouse', 'HR Core', 'Ticketing (Jira SM)', 'Azure Landing Zone', 'E-commerce Platform', 'CRM (Dynamics)', 'Document Archive', 'Identity Platform', 'Logistics Planner', 'Billing Engine', 'Analytics Workbench', 'Field Service App', 'Intranet', 'Mail & Collaboration', 'Contract Register', 'Treasury', 'Supplier Portal', 'Build Pipeline'];

  // Systems for the detail view, matching the rollup counts.
  function systemsOf(r) {
    if (!r.rollup) return [];
    const out = [];
    let i = Math.floor(hash(r.code) * SYSTEM_NAMES.length);
    for (const s of ROLLUP_ORDER) for (let k = 0; k < r.rollup[s]; k++) out.push({ name: SYSTEM_NAMES[i++ % SYSTEM_NAMES.length] + (out.length >= SYSTEM_NAMES.length ? ' ' + (Math.floor(out.length / SYSTEM_NAMES.length) + 1) : ''), status: s });
    return out;
  }

  const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
  function totals(list) {
    const inc = list.filter((r) => r.included);
    const org = { FULFILLED: 0, IN_PROGRESS: 0, NOT_STARTED: 0 };
    inc.forEach((r) => { if (r.orgStatus) org[r.orgStatus]++; });
    const sys = Object.fromEntries(ROLLUP_ORDER.map((s) => [s, sum(inc, (r) => (r.rollup ? r.rollup[s] : 0))]));
    return {
      all: list.length, included: inc.length, excluded: list.length - inc.length, missing: list.filter((r) => r.missing).length,
      justified: list.filter((r) => !r.included && !r.missing).length, org, sys,
      progress: inc.length ? sum(inc, (r) => r.progress) / inc.length : 0,
    };
  }

  const statusClass = (s) => 's-' + s;
  const statusDot = (s) => `<span class="dot ${statusClass(s)}" aria-hidden="true"></span>`;
  const statusText = (s) => `<span class="owner">${statusDot(s)}<span>${STATUS[s]}</span></span>`;
  function rollupBar(r, wide) {
    if (!r.rollup) return '';
    const segs = ROLLUP_ORDER.filter((s) => r.rollup[s]).map((s) => `<i class="${statusClass(s)}" style="flex:${r.rollup[s]}"></i>`).join('');
    const title = ROLLUP_ORDER.filter((s) => r.rollup[s]).map((s) => `${r.rollup[s]} ${STATUS[s]}`).join(', ');
    return `<span class="rbar${wide ? ' wide' : ''}" title="${title}" role="img" aria-label="Systems: ${title}">${segs}</span>`;
  }
  const rollupText = (r) => ROLLUP_ORDER.filter((s) => r.rollup[s]).map((s) => `${r.rollup[s]} ${STATUS[s]}`).join(', ');
  const reqChips = (r, q) => r.requirements.map((m) => `<span class="req"><b>${esc(m.fw)}</b> ${highlight(m.codes, q)}</span>`).join('');
  const appliesHtml = (r) => !r.included ? '<span class="muted">Nothing</span>'
    : [r.appliesToOrganization ? 'Organization' : '', r.systems ? `${r.systems} System${r.systems === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ');

  // An SVG ring for a 0..1 share (or several stacked shares).
  function ring(parts, size = 64, stroke = 8, label = '') {
    const rad = (size - stroke) / 2, circ = 2 * Math.PI * rad;
    let off = 0;
    const arcs = parts.map(([share, cls]) => {
      const len = Math.max(0, share * circ);
      const a = `<circle class="${cls}" r="${rad}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-off}" />`;
      off += len; return a;
    }).join('');
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}"><circle class="ring-track" r="${rad}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke-width="${stroke}"/><g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g></svg>`;
  }

  window.SOA = { rows, domains, totals, systemsOf, STATUS, ROLLUP_ORDER, APPLIES, TEMPLATES, statusDot, statusText, statusClass, rollupBar, rollupText, reqChips, appliesHtml, ring, hash };
})();
