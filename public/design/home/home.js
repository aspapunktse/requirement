// Shared helpers for the Home-by-role proposals: the role switch (kept in the URL hash, so
// "see A" / "see B" open the same role), icons, the ring and sparkline graphics, count-up
// numbers, the spotlight hover, and one picture per role type drawn from HOME.roles[].picture.
(function () {
  const H = window.HOME;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const initials = (n) => { const w = n.split(' '); return (w.length > 1 ? w.map((p) => p[0]).join('') : n).slice(0, 2); };
  const ago = (d) => d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} d ago` : d < 365 ? `${Math.round(d / 30)} mo ago` : `${Math.floor(d / 365)} y ago`;
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const first = (name) => name.split(' ')[0];

  const P = {
    plus: 'M10 4v12M4 10h12',
    stack: 'M3 6l7-3 7 3-7 3-7-3zM3 10l7 3 7-3M3 14l7 3 7-3',
    check: 'M4 10.5l3.5 3.5L16 6',
    book: 'M4 4h5a2 2 0 0 1 2 2v10a2 2 0 0 0-2-2H4zM16 4h-5M16 4v10h-5',
    doc: 'M6 3h6l3 3v11H6zM12 3v3h3M8 10h5M8 13h5',
    search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4',
    grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
    alert: 'M10 3l8 14H2zM10 8v4M10 14.5v.5',
    chart: 'M4 16V9M8 16V5M12 16v-6M16 16V7',
    layers: 'M10 3l7 4-7 4-7-4zM3 11l7 4 7-4',
    building: 'M4 17V4h8v13M12 8h4v9M7 7h2M7 10h2M7 13h2',
    system: 'M3 4h14v9H3zM7 17h6M10 13v4',
    query: 'M4 4h12v9H9l-4 3v-3H4zM8 8h4',
    risk: 'M10 3l6 3v4c0 4-3 6-6 7-3-1-6-3-6-7V6z',
    control: 'M4 10l4 4 8-8M3 3h14v14H3z',
    checkup: 'M6 3h8v14H6zM8 7h4M8 10l1.5 1.5L12 9',
    audit: 'M4 4h9l3 3v10H4zM8 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M11.5 12.5L14 15',
    arrow: 'M5 10h10M11 6l4 4-4 4',
    bolt: 'M11 2L4 11h5l-1 7 7-9h-5z',
  };
  const icon = (k, size = 18) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k] || P.grid}"/></svg>`;

  const KIND = {
    System: { icon: 'system', hue: 'var(--accent)' },
    Query: { icon: 'query', hue: '#6c7fd8' },
    Risk: { icon: 'risk', hue: 'var(--bad)' },
    Control: { icon: 'control', hue: 'var(--ok)' },
    'Check-up': { icon: 'checkup', hue: '#b07a12' },
    Audit: { icon: 'audit', hue: '#8a5cc2' },
  };

  // Progress ring; segments = [[fraction, color], ...]
  function ring(segments, size = 64, stroke = 8, center = '', sub = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let off = 0;
    const arcs = segments.map(([f, col]) => {
      const len = Math.max(0, Math.min(1, f)) * c;
      const a = `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${c}" stroke-dashoffset="${-off}" style="--len:${len}"/>`;
      off += len; return a;
    }).join('');
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(center)} ${esc(sub)}">
      <g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="${stroke}"/>${arcs}</g>
      ${center ? `<text x="50%" y="${sub ? '47%' : '53%'}" text-anchor="middle" dominant-baseline="middle" class="ring-num" style="font-size:${Math.round(size / 4.2)}px">${esc(center)}</text>` : ''}
      ${sub ? `<text x="50%" y="66%" text-anchor="middle" class="ring-sub">${esc(sub)}</text>` : ''}</svg>`;
  }

  // Sparkline with a soft area and an end dot
  function spark(vals, w = 92, h = 28, color = 'var(--accent)') {
    if (!vals || vals.length < 2) return '';
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = vals.map((v, i) => [i * (w - 4) / (vals.length - 1) + 2, h - 3 - (v - min) / span * (h - 8)]);
    const line = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    const last = pts[pts.length - 1];
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="2,${h} ${line} ${w - 2},${h}" fill="url(#${id})"/>
      <polyline class="spark-line" points="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/></svg>`;
  }
  const toneColor = (t) => ({ warn: 'var(--gold)', danger: 'var(--bad)', ok: 'var(--ok)', success: 'var(--ok)' })[t] || 'var(--accent)';

  // Numbers count up once when they come into view
  function countUp(root = document) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const raw = el.dataset.count, m = raw.match(/^(\d+)(.*)$/);
      if (!m || reduced) { el.textContent = raw; return; }
      const end = +m[1], suffix = m[2], t0 = performance.now(), dur = 700 + Math.min(end, 200) * 2;
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(end * e) + suffix; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }

  // Spotlight hover: a soft glow follows the pointer on .spot elements
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.spot'); if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  // Role in the hash
  function roleKey() { const m = location.hash.match(/role=([A-Z_]+)/); return m && H.roles.some((r) => r.key === m[1]) ? m[1] : H.roles[0].key; }
  const role = (key = roleKey()) => H.roles.find((r) => r.key === key);
  function onRole(cb) {
    const fire = () => { document.querySelectorAll('[data-keep-role]').forEach((a) => { a.href = a.getAttribute('href').split('#')[0] + '#role=' + roleKey(); }); cb(role()); };
    addEventListener('hashchange', fire); fire();
  }
  const setRole = (key) => { history.replaceState(null, '', '#role=' + key); dispatchEvent(new HashChangeEvent('hashchange')); };

  // One picture per role
  const STAGE_TONE = ['var(--faint)', 'var(--gold)', 'var(--accent)', 'var(--ok)'];
  const pctTone = (p) => p >= 90 ? 'var(--ok)' : p >= 70 ? 'var(--accent)' : p >= 50 ? 'var(--gold)' : 'var(--bad)';
  function picture(p) {
    switch (p.type) {
      case 'pipeline': return `<div class="pic-pipe">${p.stages.map((s, i) => {
        const items = p.items.filter((x) => x.stage === i);
        return `<div class="pp-col"><div class="pp-h"><i style="background:${STAGE_TONE[i]}"></i>${esc(s)}<b>${items.length}</b></div>
          ${items.map((x) => `<div class="pp-item${x.flag ? ' flag' : ''}"><span>${esc(x.name)}</span>${x.flag ? `<em>${esc(x.flag)}</em>` : ''}<span class="pp-bar"><i style="--w:${x.pct}%"></i></span><small>${x.pct}% assessed</small></div>`).join('') || '<div class="pp-empty">—</div>'}</div>`;
      }).join('')}</div>`;
      case 'bars': {
        const max = Math.max(...p.items.map((x) => x.value), p.target || 0);
        return `<div class="pic-bars">${p.items.map((x) => `<div class="pb-row"><span class="pb-n">${esc(x.name)}</span>
          <span class="pb-track">${p.target ? `<i class="pb-target" style="left:${p.target / max * 100}%"></i>` : ''}<i class="pb-fill${p.target && x.value > p.target ? ' over' : ''}" style="--w:${x.value / max * 100}%"></i></span>
          <b class="num">${x.value}${p.target ? ' d' : ''}</b></div>`).join('')}</div>`;
      }
      case 'heat': {
        const sev = (r, c) => { const s = (3 - r) + c; return s >= 5 ? 'var(--bad)' : s >= 4 ? '#d9693f' : s >= 2 ? 'var(--gold)' : 'var(--ok)'; };
        const lv = ['High', 'Med', 'Low', 'Rare'];
        return `<div class="pic-heat"><span class="ph-y">Likelihood</span><div class="ph-grid">${p.cells.map((row, r) => `<span class="ph-l">${lv[r]}</span>${row.map((n, c) =>
          `<span class="ph-c${n ? '' : ' zero'}" style="--c:${sev(r, c)}" title="${n} Risk${n === 1 ? '' : 's'}">${n ? `<b>${n}</b>` : ''}</span>`).join('')}`).join('')}
          <span></span>${['Minor', 'Moderate', 'Major', 'Severe'].map((x) => `<span class="ph-x">${x}</span>`).join('')}</div><span class="ph-xl">Impact</span></div>`;
      }
      case 'portfolio': return `<div class="pic-port">${p.stages.map((s, i) => {
        const items = p.items.filter((x) => x.stage === i);
        return `<div class="po-col"><div class="pp-h"><i style="background:${STAGE_TONE[i]}"></i>${esc(s)}<b>${items.length}</b></div><div class="po-cells">
          ${items.map((x) => `<span class="po-c" style="--c:${pctTone(x.pct)}" title="${esc(x.name)} · ${x.pct}% compliant${x.risks ? ` · ${x.risks} open Risk${x.risks > 1 ? 's' : ''}` : ''}"><b>${x.pct}</b>${x.risks ? `<em>${x.risks}</em>` : ''}<small>${esc(x.name)}</small></span>`).join('')}</div></div>`;
      }).join('')}</div>`;
      case 'rings': return `<div class="pic-rings">${p.items.map((x) => `<div class="pr-i">${ring([[x.value / 100, pctTone(x.value)]], 66, 7, `${x.value}%`)}<span>${esc(x.name)}</span></div>`).join('')}</div>`;
      case 'audits': return `<div class="pic-audits">${p.items.map((x) => {
        const tot = x.parts.reduce((a, b) => a + b, 0);
        return `<div class="pa-row"><div class="pa-h"><b>${esc(x.name)}</b><span class="num">${x.parts[0]}/${tot} evaluated</span></div>
          <span class="pa-bar">${x.parts.map((n, i) => n ? `<i style="--w:${n / tot * 100}%;background:${p.legend[i][1]}" title="${n} ${p.legend[i][0]}"></i>` : '').join('')}</span></div>`;
      }).join('')}<div class="legend-row">${p.legend.map(([l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div></div>`;
      case 'mosaic': return `<div class="pic-mosaic">${p.groups.map((g) => `<div class="pm-g"><div class="pm-h">${esc(g.name)}<b>${g.items.length}</b></div><div class="pm-cells">
        ${g.items.map((n, i) => `<span class="pm-c" style="--d:${i * 40}ms" title="${esc(n)}">${esc(initials(n))}</span>`).join('')}</div></div>`).join('')}</div>`;
    }
    return '';
  }
  // Bars and rings grow in once drawn
  function grow(root) { requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('in'))); }

  window.Home = { H, esc, reduced, initials, ago, greeting, first, icon, KIND, ring, spark, toneColor, countUp, role, roleKey, onRole, setRole, picture, grow };
})();
