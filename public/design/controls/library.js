/* Helpers both Control Library proposals share: escaping, labels, chips and the detail panel. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const APPLICABILITY = { ORGANIZATIONAL: 'Organizational', PER_SYSTEM: 'Per System', BOTH: 'Both' };
  const STATUS = { IMPLEMENTED: 'Implemented', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started' };
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);

  // Stable ids and derived fields used by filters.
  CONTROLS.forEach((c, i) => {
    c.id = i;
    c.mapped = c.maps.length > 0;
    c.satisfies = c.maps.reduce((s, m) => s + m.full + m.partial, 0);
    c.family = c.code.startsWith('A.') ? 'ISO 27001 Annex A' : 'CSA CCM Supplementary';
    c.hay = (c.code + ' ' + c.title + ' ' + c.description + ' ' + c.category + ' ' + (c.owner || '')).toLowerCase();
  });

  function highlight(text, q) {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  const appChip = (c) => `<span class="chip ${c.applicability === 'ORGANIZATIONAL' ? 'org' : c.applicability === 'BOTH' ? 'both' : ''}">${APPLICABILITY[c.applicability]}</span>`;
  const ownerHtml = (c, short) => c.owner
    ? `<span class="owner"><span class="avatar" aria-hidden="true">${initials(c.owner)}</span><span>${esc(short ? c.owner.split(' ')[0] : c.owner)}</span></span>`
    : `<span class="owner muted"><span class="avatar none" aria-hidden="true"></span><span>Unassigned</span></span>`;
  const statusKey = (c) => c.status || 'NA';
  const statusHtml = (c) => `<span class="owner"><span class="dot st-${statusKey(c)}"></span><span>${c.status ? STATUS[c.status] : 'Per System only'}</span></span>`;

  function detailHtml(c) {
    const thresholds = [['Confidentiality', c.c], ['Integrity', c.i], ['Availability', c.a]].filter(([, v]) => v);
    return `<div class="detail">
      <div class="detail-head">
        <span class="code">${esc(c.code)}</span>
        <h2>${esc(c.title)}</h2>
        <div class="detail-meta">${appChip(c)}${c.origin ? `<span class="chip sup">Supplementary · ${esc(c.origin)}</span>` : ''}${c.mandatory ? '' : '<span class="chip both">Optional</span>'}</div>
      </div>
      <p>${esc(c.description)}</p>
      ${c.question ? `<section><span class="label">Self-assessment question</span><p class="question">${esc(c.question)}</p></section>` : ''}
      <section><span class="label">Ownership</span>
        <dl><dt>Control Owner</dt><dd>${ownerHtml(c)}</dd>
        <dt>Organization status</dt><dd>${statusHtml(c)}</dd>
        ${c.applicability !== 'ORGANIZATIONAL' ? `<dt>Assessed on</dt><dd class="num">${c.systems} Systems</dd>` : ''}</dl></section>
      <section><span class="label">Scope</span>
        <dl><dt>Category</dt><dd>${esc(c.category)}</dd>
        <dt>Deployment Facets</dt><dd>${c.facets.length ? c.facets.map(esc).join(', ') : '<span class="muted">Any</span>'}</dd>
        <dt>Impact thresholds</dt><dd>${thresholds.length ? thresholds.map(([k, v]) => `${k} ≥ ${v[0] + v.slice(1).toLowerCase()}`).join('<br>') : '<span class="muted">None</span>'}</dd></dl></section>
      <section><span class="label">Satisfies</span>
        ${c.maps.length ? `<div class="maps">${c.maps.map((m) => `<div class="map"><span>${esc(m.fw)}</span><span class="muted num">${m.full ? m.full + ' full' : ''}${m.full && m.partial ? ' · ' : ''}${m.partial ? m.partial + ' partial' : ''}</span></div>`).join('')}</div>`
          : '<span class="chip warn">Not mapped to any Requirement</span>'}</section>
    </div>`;
  }

  window.Lib = { esc, highlight, appChip, ownerHtml, statusHtml, statusKey, detailHtml, APPLICABILITY, STATUS, initials };
})();
