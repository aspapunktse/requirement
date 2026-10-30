// Helpers shared by the Framework list and Framework coverage proposals. Needs data.js, kit.js
// and appbar.js first. Coverage rules follow CONTEXT.md: a Requirement is covered when at least
// one Control Mapping is Full; Partial mappings alone leave a Coverage Gap; an accepted gap
// counts as resolved.
(function () {
  const { FRAMEWORKS, BASE, DETAIL } = window.FW_DATA;
  const esc = Kit.esc;
  const byId = (id) => FRAMEWORKS.find((f) => f.id === id);
  const label = (f) => `${f.name}:${f.version}`;
  const name = (f) => `<span class="fwn"><b>${esc(f.name)}</b><code>${esc(f.version)}</code></span>`;
  const resolved = (f) => f.requirements ? Math.round((f.covered + f.accepted) / f.requirements * 100) : null;
  const unmapped = (f) => f.gaps - f.partialOnly;
  const status = (f) => f.status === 'PUBLISHED' ? '<span class="chip success">Published</span>' : '<span class="chip warn">Draft</span>';
  const tags = (f) => (f.base ? '<span class="tag base">Base Framework</span>' : '') + (f.strict ? '<span class="tag strict" title="Only Fulfilled counts: Waived and Not Applicable get no credit">Strict</span>' : '');

  // Stacked bar: covered, accepted, gap with Partial mappings, gap with none
  function bar(f, cls = '') {
    if (!f.requirements) return `<div class="cbar empty ${cls}" role="img" aria-label="No Requirements yet"></div>`;
    const seg = [[f.covered, 'COVERED'], [f.accepted, 'ACCEPTED_GAP'], [f.partialOnly, 'PARTIAL'], [unmapped(f), 'NONE']];
    return `<div class="cbar ${cls}" role="img" aria-label="${f.covered} covered, ${f.accepted} accepted, ${f.gaps} gaps of ${f.requirements}">${seg.filter(([n]) => n > 0).map(([n, s]) => `<i class="st-${s}" style="flex-grow:${n}"></i>`).join('')}</div>`;
  }
  const ringOf = (f, size = 64, stroke = 8) => f.requirements
    ? Kit.ring([[f.covered / f.requirements, 'var(--c-cov)'], [f.accepted / f.requirements, 'var(--c-acc)']], size, stroke, resolved(f) + '%', size >= 64 ? 'resolved' : '')
    : Kit.ring([], size, stroke, '—', size >= 64 ? 'no reqs' : '');
  const odo = (n, cls = '') => `<span class="odo ${cls}" aria-label="${n}">${String(n).split('').map((d) => `<span aria-hidden="true">${d}</span>`).join('')}</span>`;
  const legend = () => `<div class="lg"><span><i class="st-COVERED"></i>Covered</span><span><i class="st-ACCEPTED_GAP"></i>Accepted gap</span><span><i class="st-PARTIAL"></i>Gap, Partial mappings only</span><span><i class="st-NONE"></i>Gap, no mapping</span></div>`;

  // Controls: the base Annex A seed plus the Supplementary Controls in the detail data
  const SUP = {};
  Object.entries(DETAIL).forEach(([fw, reqs]) => reqs.forEach((r) => r.maps.forEach((m) => { if (m.supplementary) SUP[m.control] = { code: m.control, title: m.title, origin: fw }; })));
  const control = (code) => BASE.find((c) => c.code === code) || SUP[code] || { code, title: '' };
  const ctl = (m) => { const c = control(m.control); return `<span class="ctl${m.supplementary ? ' sup' : ''}" title="${esc(c.title)}${m.supplementary ? ' (Supplementary)' : ''}"><b>${esc(c.code)}</b><span>${esc(c.title)}</span><em class="${m.coverage}">${m.coverage === 'FULL' ? 'Full' : 'Partial'}</em></span>`; };
  const STATE_LABEL = { COVERED: 'Covered', GAP: 'Coverage Gap', ACCEPTED_GAP: 'Accepted gap' };
  const cst = (s) => `<span class="cst ${s}">${STATE_LABEL[s]}</span>`;
  // A gap's kind: Partial mappings only, or nothing mapped
  const kind = (r) => r.state === 'COVERED' ? 'COVERED' : r.state === 'ACCEPTED_GAP' ? 'ACCEPTED_GAP' : r.maps.length ? 'PARTIAL' : 'NONE';
  const recount = (reqs) => ({ requirements: reqs.length, covered: reqs.filter((r) => r.state === 'COVERED').length, accepted: reqs.filter((r) => r.state === 'ACCEPTED_GAP').length, gaps: reqs.filter((r) => r.state === 'GAP').length, partialOnly: reqs.filter((r) => r.state === 'GAP' && r.maps.length).length });
  const sections = (reqs) => { const m = new Map(); reqs.forEach((r) => { if (!m.has(r.section)) m.set(r.section, []); m.get(r.section).push(r); }); return [...m.entries()]; };

  // Only a Compliance Manager (or an Admin) curates; everyone else reads
  const canCurate = () => Appbar.roleKey() === 'COMPLIANCE_MANAGER';
  const coverageHref = (id, p = 'a') => Appbar.withRole(`/design/framework-coverage/proposal-${p}.html?fw=${id}`);
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const supCode = (r) => 'CMMC-' + r.code.split('-').pop();

  // Palette entries: every Framework
  const paletteItems = (p = 'a') => () => FRAMEWORKS.map((f) => ({ group: 'Frameworks', label: label(f), sub: f.requirements ? `${f.gaps} gaps` : 'no Requirements', icon: 'framework', href: coverageHref(f.id, p) }));

  window.FW = { FRAMEWORKS, BASE, DETAIL, byId, label, name, resolved, unmapped, status, tags, bar, ringOf, odo, legend, control, ctl, cst, kind, STATE_LABEL, recount, sections, canCurate, coverageHref, fmtDate, supCode, paletteItems, esc };
})();
