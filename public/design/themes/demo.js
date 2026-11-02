// The sample app page for the Themes proposals: hero with a ring, stat cards, tabs with counts, a register table
// with status chips, buttons, inputs, a chart, a popover, a drawer and focus states. Built from the shared kit
// (public/design/shared) and the Register tokens, so a theme is judged on the same parts the app has.
//
//   ThemeDemo.mount(el, { palette: 'slate', mode: 'dark' })   renders into el (el gets class "dm")
//
// palette / mode are optional: they set data-palette / data-mode on the box, to show one theme beside another
// (see the element-scoped blocks at the top of themes.css). Without them the box follows the page.
(function () {
  const { ring, spark, esc } = window.Kit;
  const SYSTEMS = [
    ['Payroll', 'Visma · Finance', 'APPROVED', 'success', 'Approved', 'MS', 'Marcus Lindqvist', 82, ['SaaS'], [3, 3, 2], 0],
    ['Customer portal', 'In-house · Sales', 'IN_REVIEW', 'warn', 'In review', 'SE', 'Sara Ek', 61, ['Cloud', 'On-prem'], [2, 3, 3], 2],
    ['Data warehouse', 'Snowflake · BI', 'ONBOARDED', 'done', 'Onboarded', 'JB', 'Johan Berg', 94, ['Cloud'], [4, 3, 2], 0],
    ['Legacy CRM', 'Oracle · Sales', 'REJECTED', 'danger', 'Rejected', 'LH', 'Lena Holm', 34, ['On-prem'], [1, 2, 1], 5],
    ['Meeting rooms', 'Ricoh · Facilities', 'DRAFT', '', 'Draft', 'AS', 'Anna Sjöberg', 12, ['SaaS'], [0, 1, 0], 0],
  ];
  const BARS = [[14, 8, 3, 2], [16, 9, 3, 3], [19, 8, 2, 4], [21, 8, 2, 5], [24, 7, 2, 6], [27, 6, 1, 7]]; // ok, in review, bad, done per month
  const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];

  function chart() {
    const W = 300, H = 140, base = 120, max = 40, bw = 28, gap = (W - 30 - bw * 6) / 5;
    const cols = ['var(--ok)', 'var(--gold)', 'var(--bad)', 'var(--done)'];
    let g = '';
    [0, 10, 20, 30, 40].forEach((v) => { const y = base - v / max * 100; g += `<line class="grid" x1="26" x2="${W}" y1="${y}" y2="${y}"/><text class="axis" x="22" y="${y + 3}" text-anchor="end">${v}</text>`; });
    BARS.forEach((b, i) => {
      const x = 30 + i * (bw + gap); let y = base;
      b.forEach((v, k) => { const h = v / max * 100; y -= h; g += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0, h - 1)}" rx="2" fill="${cols[k]}"/>`; });
      g += `<text class="axis" x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${MONTHS[i]}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Systems per status by month, rising from 27 in June to 41 in November">${g}</svg>
      <div class="legend"><span><i style="background:var(--ok)"></i>Approved</span><span><i style="background:var(--gold)"></i>In review</span><span><i style="background:var(--bad)"></i>Rejected</span><span><i style="background:var(--done)"></i>Onboarded</span></div>`;
  }

  function html() {
    const segs = [[.46, 'var(--ok)'], [.2, 'var(--gold)'], [.1, 'var(--bad)'], [.24, 'var(--done)']];
    const rows = SYSTEMS.map((s, i) => `<tr${i === 1 ? ' class="sel"' : ''}>
        <td><div class="name"><b>${esc(s[0])}</b><small>${esc(s[1])}</small></div></td>
        <td><span class="chip ${s[3]}">${esc(s[4])}</span></td>
        <td><div class="owner"><span class="av">${esc(s[5])}</span>${esc(s[6])}</div></td>
        <td><div class="facets">${s[8].map((f) => `<span class="facet">${esc(f)}</span>`).join('')}</div></td>
        <td><span class="cia" aria-label="C I A impact">${s[9].map((l) => `<i data-l="${l}"></i>`).join('')}</span></td>
        <td><div class="prog" style="min-width:110px"><div class="track"><div class="fill" style="width:${s[7]}%"></div></div><span>${s[7]}%</span></div></td>
        <td>${s[10] ? `<span class="qbadge">${s[10]} questions</span>` : '<span class="muted">none</span>'}</td>
        <td><button type="button" class="link" data-open-drawer>Review</button></td></tr>`).join('');
    return `
      <section class="hero" aria-label="Overview">
        <div>
          <div class="eyebrow">Systems · Compliance Manager</div>
          <h1>Compliance overview</h1>
          <p class="lede"><span class="num">41</span> Systems are in the register. <span class="num">8</span> are waiting for a decision and <span class="num">4</span> need attention before the audit on 12 December.</p>
          <div class="chips"><span class="chip warn">8 in review</span><span class="chip danger">4 need attention</span><span class="chip success">19 approved</span><span class="chip done">10 onboarded</span><span class="chip">Draft: 3</span></div>
          <div class="actions"><button type="button" class="btn primary">+ New System</button><button type="button" class="btn">Export CSV</button><button type="button" class="btn danger">Reject</button><button type="button" class="btn ghost">Cancel</button></div>
        </div>
        <div class="move">${ring(segs, 96, 10, '71%', 'fulfilled')}
          <ul><li><i style="background:var(--ok)"></i><b>19</b>Approved</li><li><i style="background:var(--gold)"></i><b>8</b>In review</li><li><i style="background:var(--bad)"></i><b>4</b>Rejected</li><li><i style="background:var(--done)"></i><b>10</b>Onboarded</li></ul></div>
      </section>
      <section class="stats" aria-label="Saved views">
        <button type="button" class="card stat spot" aria-pressed="true"><span class="k">All Systems <em>Shown</em></span><span class="v">41</span>${spark([22, 25, 24, 30, 33, 37, 41], 70, 28)}</button>
        <button type="button" class="card stat spot warn" aria-pressed="false"><span class="k">Awaiting review <em>Show</em></span><span class="v">8</span>${spark([3, 4, 6, 5, 7, 9, 8], 70, 28, 'var(--gold)')}</button>
        <button type="button" class="card stat spot danger" aria-pressed="false"><span class="k">Needs attention <em>Show</em></span><span class="v">4</span>${spark([1, 2, 2, 3, 3, 5, 4], 70, 28, 'var(--bad)')}</button>
        <button type="button" class="card stat spot ok" aria-pressed="false"><span class="k">Fulfilled <em>Show</em></span><span class="v">71%</span>${spark([52, 55, 61, 63, 66, 70, 71], 70, 28, 'var(--ok)')}</button>
      </section>
      <section class="card reg" aria-label="Register">
        <div class="card-h"><h2>Register</h2><p><span class="kbd">/</span> to search · <span class="kbd">Ctrl K</span> to jump</p></div>
        <div class="tabs" role="tablist" aria-label="Status">
          <button type="button" role="tab" aria-selected="true">All <span class="n">41</span></button>
          <button type="button" role="tab" aria-selected="false">In review <span class="n">8</span></button>
          <button type="button" role="tab" aria-selected="false">Approved <span class="n">19</span></button>
          <button type="button" role="tab" aria-selected="false">Rejected <span class="n">4</span></button>
        </div>
        <div class="toolbar">
          <label class="search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m14 14 4 4"/></svg><input type="search" placeholder="Search name, vendor or owner" aria-label="Search Systems" autocomplete="off"></label>
          <label class="muted">Group by <select class="sel" aria-label="Group by"><option>None</option><option>Owner</option><option>Business Unit</option></select></label>
          <button type="button" class="btn ghost">Compact</button>
        </div>
        <div class="tablewrap" tabindex="0" role="region" aria-label="Systems table">
          <table><thead><tr><th>System</th><th>Status</th><th>Owner</th><th>Deployment</th><th>C · I · A</th><th>Controls fulfilled</th><th>Open</th><th><span class="sr" style="position:absolute;left:-9999px">Action</span></th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </section>
      <div class="trio">
        <section class="card"><div class="card-b chart"><h2 style="font-size:1rem;margin-bottom:8px">Systems by status</h2>
          <div class="kpi"><b class="num">41</b><small>+4 this month</small></div>${chart()}</div></section>
        <section class="card"><div class="card-b form"><h2 style="font-size:1rem">Edit System</h2>
          <label class="f">Name<input class="fld" value="Customer portal"></label>
          <label class="f">Owner<select class="fld"><option>Sara Ek</option><option>Marcus Lindqvist</option></select></label>
          <label class="f">Vendor<input class="fld bad" value="" placeholder="Required" aria-invalid="true"><span class="help bad">Enter the vendor, or choose In-house.</span></label>
          <label class="row"><input type="checkbox" checked> <span>Provider to other Organizations</span></label>
          <div class="row"><button type="button" class="btn primary">Save</button><button type="button" class="btn">Cancel</button><button type="button" class="btn" disabled>Disabled</button><button type="button" class="btn is-focus">Focused</button></div>
        </div></section>
        <section class="card"><div class="card-b form"><h2 style="font-size:1rem">Menu and drawer</h2>
          <div class="pop" role="menu" aria-label="Sample menu"><span class="lbl">Act as</span>
            <button type="button" role="menuitemradio" aria-checked="true"><span class="av">MS</span>Marcus Lindqvist</button>
            <button type="button" role="menuitemradio" aria-checked="false" class="is-focus"><span class="av">SE</span>Sara Ek</button>
            <button type="button" role="menuitemradio" aria-checked="false"><span class="av">JB</span>Johan Berg</button></div>
          <div class="row"><button type="button" class="btn" data-open-drawer>Open drawer</button><span class="help">Tab through the page to see the focus ring.</span></div>
        </div></section>
      </div>
      <div class="scrim" data-close-drawer></div>
      <aside class="drawer" role="dialog" aria-modal="false" aria-label="Review decision">
        <header><h2>Review: Customer portal</h2><button type="button" class="btn ghost" data-close-drawer aria-label="Close drawer">✕</button></header>
        <div class="body"><div class="row"><span class="chip warn">In review</span><span class="qbadge">2 questions</span></div>
          <p class="muted">Sara Ek asked for the vendor's ISO 27001 certificate before this System can be approved.</p>
          <label class="f">Decision note<input class="fld" placeholder="Why this decision?"></label>
          <label class="row"><input type="radio" name="dm-d" checked> <span>Approve</span></label><label class="row"><input type="radio" name="dm-d"> <span>Reject</span></label></div>
        <footer><button type="button" class="btn" data-close-drawer>Cancel</button><button type="button" class="btn danger">Reject</button><button type="button" class="btn primary">Approve</button></footer>
      </aside>`;
  }

  function mount(el, o) {
    o = o || {};
    el.classList.add('dm');
    if (o.palette) el.setAttribute('data-palette', o.palette);
    if (o.mode) el.setAttribute('data-mode', o.mode);
    el.innerHTML = html();
    const drawer = el.querySelector('.drawer');
    const set = (open) => { el.classList.toggle('drawer-open', open); drawer.toggleAttribute('inert', !open); if (open) drawer.querySelector('button').focus(); };
    drawer.toggleAttribute('inert', true);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-drawer]')) set(true);
      else if (e.target.closest('[data-close-drawer]')) set(false);
      const tab = e.target.closest('[role=tab]');
      if (tab) tab.parentElement.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      const st = e.target.closest('button.stat');
      if (st) { el.querySelectorAll('button.stat').forEach((b) => b.setAttribute('aria-pressed', String(b === st))); }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('drawer-open')) set(false); });
    return el;
  }
  // Helpers the pickers share: the mode in effect (System follows the OS), a swatch strip, and a mode-change hook
  const mode = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'dark' || t === 'light' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); };
  const swatch = (id, m) => `<span class="sw" aria-hidden="true">${window.Themes.get(id).swatch[m || mode()].map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
  const onMode = (fn) => { addEventListener('appbar:mode', fn); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fn); };
  window.ThemeDemo = { mount, mode, swatch, onMode };
})();
