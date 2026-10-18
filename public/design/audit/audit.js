// Shared model for the New Internal Audit proposals. It reuses the example Controls
// (../controls/data.js) and Systems (../systems/data.js), adds what planning an audit needs
// (when each Control was last audited, each System's Framework scope, the recipients' open
// Check-ups, previous audits and starting packs), and mirrors src/lib/check-up-rules.ts
// planLaunch in a simplified form: which Check-ups a draft would generate, which System and
// Control pairs it skips, who receives them, and what would block the launch. Illustrative only.
(function () {
  const { systems: SYSTEMS, STATUSES, OWNERS, initials } = window.SYS;
  let seed = 41;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const FACET = { S: 'SaaS', C: 'Cloud IaaS/PaaS', O: 'On-Premises Datacenter' };
  const FRAMEWORKS = ['ISO/IEC 27001:2022', 'GDPR', 'Export Control (EAR/ITAR)'];
  const ANNEX = ['A.5 Organizational', 'A.6 People', 'A.7 Physical', 'A.8 Technological'];

  // Controls: months since each was last audited (null = never), and a short domain label.
  const controls = window.CONTROLS.map((c) => {
    const r = rnd();
    const annex = ANNEX.includes(c.category);
    // Most Controls have a Control Owner here, so a missing one reads as the exception it is.
    const owner = c.owner || (rnd() < 0.85 ? OWNERS[Math.floor(rnd() * OWNERS.length)] : null);
    return {
      ...c,
      owner,
      annex,
      domain: annex ? c.category : c.category.replace(/,? (and|&) .*$/, '').replace('CCM cloud provider obligations', 'Cloud provider obligations'),
      lastAudit: r < 0.32 ? null : Math.round(1 + rnd() * rnd() * 30),
    };
  });
  const byCode = new Map(controls.map((c) => [c.code, c]));

  // Systems: everyone is in scope of the base Framework; some add GDPR or Export Control.
  const systems = SYSTEMS.map((s) => ({
    ...s,
    frameworks: [FRAMEWORKS[0], ...(rnd() < 0.45 ? [FRAMEWORKS[1]] : []), ...(rnd() < 0.12 ? [FRAMEWORKS[2]] : [])],
    facetNames: s.facets.map((f) => FACET[f]),
  }));
  const bySys = new Map(systems.map((s) => [s.id, s]));

  // Open Check-ups each person already has, so a plan can warn about piling more on someone.
  const people = [...new Set([...systems.map((s) => s.owner), ...controls.map((c) => c.owner).filter(Boolean)])];
  const openLoad = Object.fromEntries(people.map((p) => [p, Math.floor(rnd() * rnd() * 14)]));

  const RANK = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
  const meets = (level, min) => !min || (level != null && RANK[level] >= RANK[min]);
  /** Simplified controlAppliesToSystem: applicability, Deployment Facets and CIA thresholds. */
  function applies(c, s) {
    if (c.applicability === 'ORGANIZATIONAL') return false;
    if (c.facets.length && !c.facets.some((f) => s.facetNames.includes(f))) return false;
    return meets(s.c, c.c) && meets(s.i, c.i) && meets(s.a, c.a);
  }
  const hasOrgImpl = (c) => c.applicability === 'ORGANIZATIONAL' || c.applicability === 'BOTH';

  const codes = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
  const PACKS = [
    { id: 'access', icon: 'key', title: 'Access control', note: 'Identities, rights and authentication', codes: [...codes('A.5.', 15, 18), ...codes('A.8.', 2, 5)] },
    { id: 'supplier', icon: 'truck', title: 'Suppliers and cloud', note: 'Agreements, ICT supply chain, cloud services', codes: codes('A.5.', 19, 23) },
    { id: 'logging', icon: 'pulse', title: 'Logging and monitoring', note: 'Logs, monitoring, clock sync', codes: ['A.8.15', 'A.8.16', 'A.8.17'] },
    { id: 'continuity', icon: 'life', title: 'Backup and continuity', note: 'Backups, redundancy, ICT readiness', codes: ['A.5.29', 'A.5.30', 'A.8.13', 'A.8.14'] },
    { id: 'overdue', icon: 'clock', title: 'Not audited in 12 months', note: 'Annex A Controls nobody has verified for a year', codes: controls.filter((c) => c.annex && (c.lastAudit == null || c.lastAudit >= 12)).map((c) => c.code) },
  ].map((p) => ({ ...p, codes: p.codes.filter((k) => byCode.has(k)) }));

  const sysNamed = (...names) => names.map((n) => systems.find((s) => s.name === n)).filter(Boolean).map((s) => s.id);
  const PREVIOUS = [
    { id: 'p1', title: 'Q2 2026 · Access control', closed: '2026-06-28', codes: PACKS[0].codes, systems: sysNamed('Jira', 'Confluence', 'Microsoft 365', 'Workday', 'Salesforce', 'ServiceNow'), org: true, findings: 3 },
    { id: 'p2', title: 'Q1 2026 · Logging', closed: '2026-03-30', codes: PACKS[2].codes, systems: systems.filter((s) => s.facets.includes('C')).slice(0, 9).map((s) => s.id), org: false, findings: 1 },
    { id: 'p3', title: '2025 · Supplier review', closed: '2025-11-20', codes: PACKS[1].codes, systems: systems.filter((s) => s.vendor).slice(0, 12).map((s) => s.id), org: true, findings: 5 },
  ];

  // ---- the draft ----
  function blank() { return { title: '', scope: '', due: '', org: false, controls: new Set(), systems: new Set(), questions: {} }; }
  const question = (d, c) => (d.questions[c.code] ?? c.question ?? '').trim();

  /** What launching the draft would create, skip and be blocked by (planLaunch, simplified). */
  function plan(d) {
    const cs = [...d.controls].map((k) => byCode.get(k)).filter(Boolean);
    const ss = [...d.systems].map((k) => bySys.get(k)).filter(Boolean);
    const recipients = new Map();
    const add = (who, role, n = 1) => { const r = recipients.get(who) || { who, role: new Set(), n: 0, load: openLoad[who] || 0 }; r.role.add(role); r.n += n; recipients.set(who, r); };
    let sys = 0, org = 0, skipped = 0;
    const perControl = new Map(), perSystem = new Map(ss.map((s) => [s.id, 0]));
    for (const c of cs) {
      let n = 0;
      if (c.applicability !== 'ORGANIZATIONAL') for (const s of ss) {
        if (applies(c, s)) { sys++; n++; perSystem.set(s.id, perSystem.get(s.id) + 1); add(s.owner, 'System Owner'); } else skipped++;
      }
      if (d.org && hasOrgImpl(c)) { org++; n++; if (c.owner) add(c.owner, 'Control Owner'); }
      perControl.set(c.code, n);
    }
    const noQuestion = cs.filter((c) => !question(d, c));
    const noOwner = d.org ? cs.filter((c) => hasOrgImpl(c) && !c.owner) : [];
    const draftProblems = [];
    if (!d.title.trim()) draftProblems.push('A title is required');
    if (!cs.length) draftProblems.push('Pick at least one Control');
    if (!d.due) draftProblems.push('A due date is required');
    else if (d.due < iso(new Date())) draftProblems.push("The due date can't be in the past");
    if (!ss.length && !d.org) draftProblems.push('Pick at least one System or include the Organization');
    const launch = [];
    if (noQuestion.length) launch.push({ kind: 'question', text: `${noQuestion.length} Control${noQuestion.length === 1 ? ' has' : 's have'} no question yet`, codes: noQuestion.map((c) => c.code) });
    if (noOwner.length) launch.push({ kind: 'owner', text: `${noOwner.length} Organization-level Control${noOwner.length === 1 ? ' has' : 's have'} no Control Owner`, codes: noOwner.map((c) => c.code) });
    if (!draftProblems.length && sys + org === 0) launch.push({ kind: 'empty', text: 'No Check-up would be generated: no picked Control applies to a picked System', codes: [] });
    return {
      controls: cs, systems: ss, sys, org, total: sys + org, skipped,
      recipients: [...recipients.values()].sort((a, b) => b.n - a.n || a.who.localeCompare(b.who)),
      perControl, perSystem, noQuestion, noOwner, draftProblems, launch,
      canSave: draftProblems.length === 0,
    };
  }

  /** The launch summary sentence, as launchSummaryText words it. */
  function summary(p) {
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    return `${pl(p.total, 'Check-up', 'Check-ups')} (${p.sys} System-level, ${p.org} Organization-level); ${p.skipped ? `${pl(p.skipped, 'System and Control pair', 'System and Control pairs')} skipped because the Control doesn't apply to the System` : 'none skipped'}`;
  }

  /** Systems matching every given criterion (the "Select Systems by filter" panel). */
  function matchSystems(f) {
    return systems.filter((s) => (!f.framework || s.frameworks.includes(f.framework)) && (!f.facet || s.facets.includes(f.facet)) && (!f.unit || s.units.includes(f.unit)) && (!f.status || s.status === f.status));
  }

  // ---- dates ----
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const endOfQuarter = () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3); return iso(new Date(d.getFullYear(), q * 3 + 3, 0)); };
  const QUICK_DUES = [['2 weeks', () => addDays(14)], ['30 days', () => addDays(30)], ['6 weeks', () => addDays(42)], ['End of quarter', endOfQuarter]];
  const daysUntil = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); };
  const workdays = (s) => { const n = daysUntil(s); if (n == null || n < 0) return 0; let w = 0; const d = new Date(); for (let i = 1; i <= n; i++) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) w++; } return w; };
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const quarterName = () => { const d = new Date(); return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`; };
  const auditedLabel = (m) => m == null ? 'Never audited' : m < 12 ? `Audited ${m} mo ago` : `Audited ${Math.floor(m / 12)} y ${m % 12 ? `${m % 12} mo ` : ''}ago`;

  // ---- graphics ----
  const P = {
    plus: 'M10 4v12M4 10h12', check: 'M4 10.5l3.5 3.5L16 6', x: 'M5 5l10 10M15 5L5 15',
    search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4', calendar: 'M4 5h12v11H4zM4 8h12M7 3v4M13 3v4',
    control: 'M4 10l4 4 8-8M3 3h14v14H3z', system: 'M3 4h14v9H3zM7 17h6M10 13v4', building: 'M4 17V4h8v13M12 8h4v9M7 7h2M7 10h2M7 13h2',
    user: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c0-3 3-5 6-5s6 2 6 5', alert: 'M10 3l8 14H2zM10 8v4M10 14.5v.5',
    key: 'M12 4a4 4 0 1 1-3.5 6L3 15.5V17h3v-2h2v-2l1.5-1.5', truck: 'M2 5h10v8H2zM12 8h3l3 3v2h-6M5 16a1.5 1.5 0 1 0 0-.01M14 16a1.5 1.5 0 1 0 0-.01',
    pulse: 'M2 10h4l2-5 4 10 2-5h4', life: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 5l3 3M15 5l-3 3M5 15l3-3M15 15l-3-3',
    clock: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6v4l3 2', repeat: 'M4 8a6 6 0 0 1 11-2M16 12a6 6 0 0 1-11 2M15 3v3h-3M5 17v-3h3',
    file: 'M6 3h6l3 3v11H6zM12 3v3h3', filter: 'M3 4h14l-5 7v5l-4-2v-3z', arrow: 'M5 10h10M11 6l4 4-4 4', back: 'M15 10H5M9 6l-4 4 4 4',
    send: 'M3 10l14-6-5 14-2-6z', edit: 'M4 16h3l9-9-3-3-9 9zM12 5l3 3', sparkle: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2',
  };
  const icon = (k, size = 18) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k] || P.file}"/></svg>`;

  /** Progress ring: segments = [[fraction, color], ...]. */
  function ring(segments, size = 120, stroke = 12, center = '', sub = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let off = 0;
    const arcs = segments.map(([f, col]) => {
      const len = Math.max(0, Math.min(1, f)) * c;
      const a = len > 0 ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-off}"/>` : '';
      off += len; return a;
    }).join('');
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(center)} ${esc(sub)}">
      <g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="${stroke}"/>${arcs}</g>
      <text x="50%" y="${sub ? '46%' : '52%'}" text-anchor="middle" dominant-baseline="middle" class="ring-num" style="font-size:${Math.round(size / 4.4)}px">${esc(center)}</text>
      ${sub ? `<text x="50%" y="66%" text-anchor="middle" class="ring-sub">${esc(sub)}</text>` : ''}</svg>`;
  }

  /** Animates a number from its last value to `to`. */
  function tween(el, to) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 420;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  let toastTimer;
  function toast(html) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = html; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }

  /** The "Draft created" moment: an animated check over a scrim. */
  function celebrate(title, p) {
    const el = document.createElement('div');
    el.className = 'celebrate';
    el.innerHTML = `<div class="celebrate-card" role="dialog" aria-label="Draft created">
      <svg width="64" height="64" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" fill="none" stroke="var(--ok)" stroke-width="3"/><path d="M15 27l7 7 15-15" fill="none" stroke="var(--ok)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Draft created</h2><p><b>${esc(title)}</b> is saved as a draft. Nothing has been sent yet: ${p.launch.length ? 'fix what blocks the launch, then launch it from the audit page.' : `launching it will send ${p.total} Check-ups.`}</p>
      <button class="btn primary" type="button">Back to the proposal</button></div>`;
    document.body.appendChild(el);
    el.querySelector('button').onclick = () => el.remove();
    el.onclick = (e) => { if (e.target === el) el.remove(); };
  }

  window.AUD = {
    controls, systems, byCode, bySys, people, openLoad, PACKS, PREVIOUS, FRAMEWORKS, FACET, STATUSES, ANNEX,
    applies, hasOrgImpl, blank, plan, summary, question, matchSystems,
    iso, addDays, QUICK_DUES, daysUntil, workdays, fmtDate, quarterName, auditedLabel,
    esc, icon, ring, tween, toast, celebrate, initials,
  };
})();
