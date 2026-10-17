/* Shared helpers for the System detail proposals: labels and tones, counts over the example
   data, and the small graphics both pages draw (progress ring, stacked bar, risk grid). */
(function () {
  const D = window.SYSTEM_DETAIL;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STATUS = {
    FULFILLED: { label: 'Fulfilled', tone: 'success', color: 'var(--ok)' },
    IN_PROGRESS: { label: 'In progress', tone: 'warn', color: 'var(--gold)' },
    NOT_STARTED: { label: 'Not started', tone: 'neutral', color: 'var(--line)' },
    WAIVED: { label: 'Waived', tone: 'done', color: 'var(--accent)' },
    NOT_APPLICABLE: { label: 'Not applicable', tone: 'neutral', color: 'var(--faint)' },
  };
  const STATUS_ORDER = ['FULFILLED', 'WAIVED', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_APPLICABLE'];
  const SOURCE = {
    org: { label: 'Organization', short: 'Org' },
    provider: { label: 'Provider, full', short: 'Provider' },
    shared: { label: 'Provider, shared', short: 'Shared' },
    own: { label: 'This System', short: 'Own' },
  };
  const LIFECYCLE = [['DRAFT', 'Draft'], ['IN_REVIEW', 'In review'], ['APPROVED', 'Approved'], ['ONBOARDED', 'Onboarded']];
  const LEVELS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
  const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);

  const countBy = (list, key) => list.reduce((m, x) => (m[x[key]] = (m[x[key]] || 0) + 1, m), {});
  const controls = D.controls;
  const statusCounts = countBy(controls, 'status');
  const sourceCounts = countBy(controls, 'source');
  const themes = [...new Set(controls.map((c) => c.theme))];
  const done = (c) => c.status === 'FULFILLED' || c.status === 'WAIVED' || c.status === 'NOT_APPLICABLE';
  const fwPct = (f) => { const app = f.met + f.partial + f.notMet; return app ? (f.met / app) * 100 : 0; };

  // Things that block or slow down the review, worst first.
  const attention = [
    ...controls.filter((c) => c.mandatory && c.status === 'NOT_STARTED' && c.source === 'own')
      .map((c) => ({ kind: 'control', tone: 'danger', title: `${c.code} ${c.title}`, note: 'Mandatory, no Assessment yet', code: c.code })),
    ...controls.filter((c) => c.openQuery)
      .map((c) => ({ kind: 'query', tone: 'warn', title: c.openQuery, note: `Open question on ${c.code}`, code: c.code })),
    ...D.risks.filter((r) => r.status === 'OPEN' && (r.severity === 'CRITICAL' || r.severity === 'HIGH'))
      .map((r) => ({ kind: 'risk', tone: r.severity === 'CRITICAL' ? 'danger' : 'warn', title: r.title, note: `${cap(r.severity)} risk, open` })),
    ...controls.filter((c) => c.source === 'shared' && c.status !== 'FULFILLED')
      .map((c) => ({ kind: 'shared', tone: 'warn', title: `${c.code} ${c.title}`, note: `Your half of a shared Offering from ${c.provider}`, code: c.code })),
  ];

  // Donut ring that sweeps in. pct 0–100.
  function ring(pct, { size = 120, stroke = 12, color = 'var(--accent)', label = '', sub = '' } = {}) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || Math.round(pct) + '%')}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="${stroke}"/>
      <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${reduced ? off : c}" data-off="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="${sub ? '47%' : '50%'}" text-anchor="middle" dominant-baseline="middle" class="ring-num">${esc(label || Math.round(pct) + '%')}</text>
      ${sub ? `<text x="50%" y="64%" text-anchor="middle" dominant-baseline="middle" class="ring-sub">${esc(sub)}</text>` : ''}
    </svg>`;
  }

  // Horizontal stacked bar from [{value, color, label}].
  function stack(parts, { height = 10 } = {}) {
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    return `<div class="stack" style="height:${height}px">${parts.filter((p) => p.value).map((p) =>
      `<i style="--w:${(p.value / total) * 100}%;background:${p.color}" title="${esc(p.label)}: ${p.value}"></i>`).join('')}</div>`;
  }
  const statusStack = (list, opts) => {
    const counts = countBy(list, 'status');
    return stack(STATUS_ORDER.map((k) => ({ value: counts[k] || 0, color: STATUS[k].color, label: STATUS[k].label })), opts);
  };
  const fwStack = (f, opts) => stack([
    { value: f.met, color: 'var(--ok)', label: 'Met' },
    { value: f.partial, color: 'var(--gold)', label: 'Partially met' },
    { value: f.notMet, color: 'var(--bad)', label: 'Not met' },
    { value: f.na, color: 'var(--line)', label: 'Not applicable' },
  ], opts);

  // Severity × likelihood grid with the open risks placed in it.
  function riskGrid(risks, { cell = 34 } = {}) {
    const heat = (s, l) => { const v = s + l; return v >= 6 ? 'var(--bad)' : v >= 4 ? 'var(--gold)' : v >= 2 ? 'color-mix(in srgb, var(--gold) 45%, var(--surface))' : 'var(--ok-soft)'; };
    let html = `<div class="rgrid" style="--cell:${cell}px" role="img" aria-label="Risks by severity and likelihood">`;
    for (let s = 3; s >= 0; s--) {
      html += `<span class="rg-y">${RISK_LEVELS[s][0]}</span>`;
      for (let l = 0; l < 4; l++) {
        const here = risks.filter((r) => RISK_LEVELS.indexOf(r.severity) === s && RISK_LEVELS.indexOf(r.likelihood) === l);
        html += `<span class="rg-c" style="background:${heat(s, l)}" title="${esc(here.map((r) => r.title).join('\n'))}">${here.length ? `<b>${here.length}</b>` : ''}</span>`;
      }
    }
    html += `<span></span>${RISK_LEVELS.map((l) => `<span class="rg-x">${l[0]}</span>`).join('')}</div>`;
    return html;
  }

  // Animate rings, bars and count-ups once they are on screen.
  function animate(root = document) {
    if (reduced) { root.querySelectorAll('[data-count]').forEach((el) => { el.textContent = el.dataset.count; }); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target; io.unobserve(el);
      if (el.classList.contains('ring-arc')) requestAnimationFrame(() => { el.style.strokeDashoffset = el.dataset.off; });
      else if (el.classList.contains('stack')) el.classList.add('in');
      else if (el.dataset.count) {
        const to = parseFloat(el.dataset.count), dec = (el.dataset.count.split('.')[1] || '').length, t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / 900), v = to * (1 - Math.pow(1 - k, 3)); el.textContent = v.toFixed(dec); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
    }), { threshold: .2 });
    root.querySelectorAll('.ring-arc, .stack:not(.in), [data-count]').forEach((el) => io.observe(el));
  }

  window.SD = { D, esc, STATUS, STATUS_ORDER, SOURCE, LIFECYCLE, LEVELS, RISK_LEVELS, cap, initials, countBy, statusCounts, sourceCounts, themes, done, fwPct, attention, ring, stack, statusStack, fwStack, riskGrid, animate, reduced };
})();
