// Graphics and small behaviours from the Home command center (#226), shared by later proposals:
// the ring, the sparkline, count-up numbers, the spotlight hover on .spot and a toast.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Progress ring; segments = [[fraction, color], ...]
  function ring(segments, size = 64, stroke = 8, center = '', sub = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let off = 0;
    const arcs = segments.map(([f, col]) => {
      const len = Math.max(0, Math.min(1, f)) * c;
      const a = len ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-dasharray="${len} ${c}" stroke-dashoffset="${-off}"/>` : '';
      off += len; return a;
    }).join('');
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(center)} ${esc(sub)}">
      <g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="${stroke}"/>${arcs}</g>
      ${center ? `<text x="50%" y="${sub ? '47%' : '53%'}" text-anchor="middle" dominant-baseline="middle" class="ring-num" style="font-size:${Math.round(size / 4.2)}px">${esc(center)}</text>` : ''}
      ${sub ? `<text x="50%" y="66%" text-anchor="middle" class="ring-sub">${esc(sub)}</text>` : ''}</svg>`;
  }

  // Sparkline with a soft area and an end dot
  function spark(vals, w = 86, h = 30, color = 'var(--accent)') {
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

  // [data-count] numbers count up from 0
  function countUp(root = document) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const raw = el.dataset.count, m = raw.match(/^(\d+)(.*)$/);
      if (!m || reduced) { el.textContent = raw; return; }
      const end = +m[1], suffix = m[2], t0 = performance.now(), dur = 700 + Math.min(end, 200) * 2;
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(end * e) + suffix; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }

  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.spot'); if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('kitToast');
    if (!el) { el = document.createElement('div'); el.id = 'kitToast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  const CHECK = '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><circle cx="28" cy="28" r="24" stroke="var(--accent)" stroke-width="3"/><path d="M18 29l7 7 13-14" stroke="var(--accent)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  window.Kit = { esc, reduced, ring, spark, toneColor, countUp, toast, CHECK };
})();
