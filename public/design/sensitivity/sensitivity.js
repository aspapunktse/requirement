// Sensitivity Level proposals (#289): colour maths, the level state, the surfaces and the settings logic that
// all three proposals share. A proposal supplies a variant V and mounts the page:
//
//   Sens.mount(document.getElementById('stage'), V)
//
//   V.cue                             words for the non-colour cue, used in a sentence ("ticks", "ladder", "icon")
//   V.chip(n, { style, label, size }) the chip as HTML; n = 1..5, or null for "Not set"
//   V.picker(el, { value, name, onPick })   the owner's picker (renders into el, calls onPick(n))
//   V.filter(el, { V, selected, counts, onChange })   the Systems-list filter by level (optional; default is toggle chips)
//   V.cell(n)                         the Systems-list cell (optional; default is the chip)
//   V.minCell(n)                      a Control's minimum, "From Highly Sensitive"
//   V.settings(el)                    the Admin settings section; use Sens.bindLevel() for the logic
//
// Colours: the Admin sets a text and a background colour per level for LIGHT mode. Dark mode is derived from them
// (Sens.deriveDark) and both are written to the root as --s<n>-l-fg/-bg and --s<n>-d-fg/-bg; they are the same in
// every theme, because no theme sets them. The pure colour functions also run in Node.
(function (g) {
  // ---------- colour maths ----------
  const hexOk = (s) => /^#[0-9a-f]{6}$/i.test(String(s).trim());
  const norm = (s) => String(s).trim().toUpperCase();
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = (h) => {
    const c = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  function toHsl(h) {
    const [r, gg, b] = rgb(h).map((v) => v / 255), mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, d = mx - mn;
    let hue = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      hue = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return [hue, s * 100, l * 100];
  }
  function fromHsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // Dark pair from the light pair: the background keeps its hue on a dark 17% lightness, the text keeps its hue as a
  // light tint (starts at 86% lightness and rises until the pair passes 4.5:1).
  function deriveDark(fg, bg) {
    const [hf, sf] = toHsl(fg), [hb, sb] = toHsl(bg);
    const bgD = fromHsl(hb, Math.min(sb, 50), 17), sD = Math.max(20, Math.min(sf, 85));
    let l = 86, fgD = fromHsl(hf, sD, l);
    while (ratio(fgD, bgD) < 4.5 && l < 98) { l += 1; fgD = fromHsl(hf, sD, l); }
    return { fg: fgD, bg: bgD, ratio: ratio(fgD, bgD) };
  }
  const AA = 4.5;
  const fmt = (r) => r.toFixed(2) + ':1';
  g.Sens = { hexOk, norm, ratio, deriveDark, toHsl, fromHsl, AA, fmt };
  if (!g.document) return;

  // ---------- state ----------
  const D = g.SensData, doc = document, root = doc.documentElement;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const defaults = D.LEVELS.map((l) => ({ ...l }));
  const levels = D.LEVELS.map((l) => ({ ...l }));
  const lv = (n) => levels[n - 1];
  const listeners = [];
  function writeVars() {
    levels.forEach((l) => {
      const d = deriveDark(l.fg, l.bg);
      root.style.setProperty(`--s${l.n}-l-fg`, l.fg); root.style.setProperty(`--s${l.n}-l-bg`, l.bg);
      root.style.setProperty(`--s${l.n}-d-fg`, d.fg); root.style.setProperty(`--s${l.n}-d-bg`, d.bg);
    });
  }
  writeVars();
  function save(n, patch) {
    Object.assign(lv(n), patch); writeVars();
    listeners.forEach((f) => f(n));
    if (g.Kit) Kit.toast(`Saved ${lv(n).label}. Every chip on this page now uses it.`);
  }
  const labelOf = (n) => (n ? lv(n).label : 'Not set');
  const inlineVars = (o) => (o.fg ? `--l-fg:${o.fg};--l-bg:${o.bg};--d-fg:${o.dfg};--d-bg:${o.dbg};` : '');

  // ---------- settings logic shared by the three layouts ----------
  // The layout supplies markup inside `el` carrying data-f (inputs: label, desc, fg, fgHex, bg, bgHex) and data-o
  // (outputs: chip, light, dark, ratio, darkRatio, msg, save, revert, reset, dirty). The rest is done here.
  function bindLevel(el, n, o) {
    const q = (s) => el.querySelector(s), f = (k) => q(`[data-f="${k}"]`), out = (k) => q(`[data-o="${k}"]`);
    const draft = () => ({ label: f('label').value.trim(), desc: f('desc').value.trim(), fg: norm(f('fgHex').value), bg: norm(f('bgHex').value) });
    function check() {
      const d = draft(), s = lv(n), issues = [];
      if (!d.label) issues.push('Give the level a label.');
      else if (d.label.length > 30) issues.push('Keep the label to 30 characters.');
      if (!hexOk(d.fg)) issues.push('Text colour must be a hex colour like #475569.');
      if (!hexOk(d.bg)) issues.push('Background colour must be a hex colour like #F1F5F9.');
      const valid = hexOk(d.fg) && hexOk(d.bg), r = valid ? ratio(d.fg, d.bg) : 0, pass = valid && r >= AA;
      if (valid && !pass) issues.push(`Contrast is ${fmt(r)}. WCAG AA needs ${AA}:1, so this pair can't be saved. Darken the text or lighten the background.`);
      const dirty = d.label !== s.label || d.desc !== s.desc || d.fg !== s.fg.toUpperCase() || d.bg !== s.bg.toUpperCase();
      return { d, valid, r, pass, issues, dirty, dark: valid ? deriveDark(d.fg, d.bg) : null };
    }
    function paint() {
      const c = check(), d = c.d, label = d.label || 'Label';
      if (hexOk(d.fg)) f('fg').value = d.fg.toLowerCase();
      if (hexOk(d.bg)) f('bg').value = d.bg.toLowerCase();
      el.querySelectorAll('[data-o="chip"]').forEach((slot) => {
        const style = c.valid ? inlineVars({ fg: d.fg, bg: d.bg, dfg: c.dark.fg, dbg: c.dark.bg }) : '';
        slot.innerHTML = o.chip(n, { style, label: (slot.dataset.pre || '') + label, size: slot.dataset.size || '' });
      });
      const lightEl = out('light'), darkEl = out('dark');
      if (lightEl) lightEl.innerHTML = c.valid ? o.chip(n, { style: `--fg:${d.fg};--bg:${d.bg};`, label }) : '<span class="muted">-</span>';
      if (darkEl) darkEl.innerHTML = c.valid ? o.chip(n, { style: `--fg:${c.dark.fg};--bg:${c.dark.bg};`, label }) : '<span class="muted">-</span>';
      const rEl = out('ratio');
      if (rEl) {
        rEl.className = 'ratio ' + (c.valid ? (c.pass ? 'ok' : 'bad') : '');
        rEl.innerHTML = c.valid ? `<b class="num">${fmt(c.r)}</b> <span>${c.pass ? '&#10003; Passes AA' : '&#10007; Fails AA (needs 4.5:1)'}</span>` : '<span>Enter two hex colours</span>';
      }
      const dEl = out('darkRatio');
      if (dEl) dEl.innerHTML = c.valid ? `<b class="num">${fmt(c.dark.ratio)}</b> <span>&#10003; Passes AA</span>` : '';
      const msg = out('msg');
      if (msg) { msg.hidden = !c.issues.length; msg.innerHTML = c.issues.map((t) => `<span>${esc(t)}</span>`).join(''); }
      const sv = out('save');
      sv.disabled = !(c.pass && c.dirty && !c.issues.length);
      sv.textContent = c.dirty ? 'Save' : 'Saved';
      if (msg && !msg.hidden) sv.setAttribute('aria-describedby', msg.id); else sv.removeAttribute('aria-describedby');
      const dirtyEl = out('dirty'); if (dirtyEl) dirtyEl.hidden = !c.dirty;
      const rv = out('revert'); if (rv) rv.disabled = !c.dirty;
      if (o.onDraft) o.onDraft(c);
    }
    const fill = (s) => { f('label').value = s.label; f('desc').value = s.desc; f('fgHex').value = s.fg; f('bgHex').value = s.bg; paint(); };
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.f; if (!k) return;
      if (k === 'fg') f('fgHex').value = e.target.value.toUpperCase();
      if (k === 'bg') f('bgHex').value = e.target.value.toUpperCase();
      paint();
    });
    out('save').addEventListener('click', () => { const c = check(); if (!c.pass || c.issues.length) return; save(n, c.d); paint(); });
    const rv = out('revert'); if (rv) rv.addEventListener('click', () => fill(lv(n)));
    const rs = out('reset'); if (rs) rs.addEventListener('click', () => fill(defaults[n - 1]));
    fill(lv(n));
    return { check, paint };
  }
  // The inputs every layout needs, so the three differ in arrangement, not in fields
  const fields = () => `
    <label class="fld"><span>Label</span><input data-f="label" maxlength="40" autocomplete="off"></label>
    <label class="fld wide"><span>Description</span><textarea data-f="desc" rows="2"></textarea></label>
    <div class="fld"><span>Text colour</span><span class="pick"><input type="color" data-f="fg" aria-label="Text colour picker"><input data-f="fgHex" maxlength="7" spellcheck="false" aria-label="Text colour hex"></span></div>
    <div class="fld"><span>Background colour</span><span class="pick"><input type="color" data-f="bg" aria-label="Background colour picker"><input data-f="bgHex" maxlength="7" spellcheck="false" aria-label="Background colour hex"></span></div>`;

  // ---------- state of the demo page ----------
  const S = { sel: new Set(), q: '', sys: 's6', ctrl: null, iv: null, changing: false, tab: 'chip', slate: false };
  const sysList = () => D.SYSTEMS;
  const sysById = (id) => D.SYSTEMS.find((s) => s.id === id);
  const count = (n) => sysList().filter((s) => (s.level || 0) === n).length;
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const statusChip = (st) => `<span class="chip ${D.STATUS[st][1]}">${D.STATUS[st][0]}</span>`;
  const meets = (c, s) => c.min == null || (s.level != null && s.level >= c.min);

  // ---------- surfaces ----------
  function chipSheet(el, V) {
    const rows = levels.map((l) => {
      const d = deriveDark(l.fg, l.bg), r = ratio(l.fg, l.bg);
      return `<tr><td>${V.chip(l.n)}</td><td><b>${esc(l.family)}</b><div class="muted">${esc(l.desc)}</div></td>
        <td class="num">${fmt(r)}<div class="ok-t">&#10003; AA</div></td>
        <td><span class="tile dark">${V.chip(l.n, { style: `--fg:${d.fg};--bg:${d.bg};` })}</span></td><td class="num">${fmt(d.ratio)}<div class="ok-t">&#10003; AA</div></td></tr>`;
    }).join('');
    const all = levels.map((l) => V.chip(l.n)).join('');
    el.innerHTML = `
      <div class="two">
        <div><h3>The five levels</h3><p class="muted sub">The label is always spelled out. Colour and the ${V.cue} only add to it.</p>
          <div class="chiprow">${all}<span class="vsep"></span>${V.chip(null)}</div>
          <p class="muted sub" style="margin-top:10px">The last one is a System whose owner has not declared a level yet. It never meets a Control's minimum and can't be submitted for review.</p></div>
        <div><h3>Sizes</h3><p class="muted sub">In a table row, in a header and inline in text.</p>
          <div class="sizes"><span>In a row: ${V.chip(4)}</span><span>In a header: ${V.chip(4, { size: 'lg' })}</span><span>Inline: this System is ${V.chip(4, { size: 'sm' })} and holds payroll.</span></div></div>
      </div>
      <h3 style="margin-top:18px">Light and dark, with contrast</h3>
      <p class="muted sub">Dark colours are derived from the Admin's light ones in the browser: same hue, a dark background and a light tint for the text. Change a colour under Admin settings and these rows update. Every pair is checked against WCAG AA (4.5:1).</p>
      <div class="tablewrap"><table class="plain"><thead><tr><th>Light</th><th>Colour family</th><th>Contrast</th><th>Dark (derived)</th><th>Contrast</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 style="margin-top:18px">The same in every theme</h3>
      <p class="muted sub">Themes (#286) change a page's colours and fonts, never a level's colours. Left: the current theme. Right: Slate.</p>
      <div class="proof"><div class="pane"><b>Current theme</b><div class="chiprow">${all}</div></div>
        <div class="pane" data-palette="slate"><b>Slate</b><div class="chiprow">${all}</div></div></div>
      <p style="margin-top:10px"><button class="btn" id="slateAll" aria-pressed="${S.slate}">Preview this whole page in Slate</button></p>`;
    if (g.Themes) Themes.loadFonts('slate');
    el.querySelector('#slateAll').onclick = (e) => { S.slate = !S.slate; e.currentTarget.setAttribute('aria-pressed', String(S.slate)); applySlate(); };
  }
  function applySlate() {
    const st = doc.getElementById('stage');
    if (S.slate) { if (g.Themes) Themes.loadFonts('slate'); st.setAttribute('data-palette', 'slate'); } else st.removeAttribute('data-palette');
  }

  function systemsList(el, V) {
    const counts = {}; for (let n = 0; n <= 5; n++) counts[n] = count(n);
    el.innerHTML = `
      <div class="toolbar"><label class="search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m14 14 4 4"/></svg><input id="q" type="search" placeholder="Search name, vendor or owner" aria-label="Search Systems" value="${esc(S.q)}" autocomplete="off"></label>
        <div class="fltwrap"><span class="lbl">Sensitivity</span><div id="flt" class="flt"></div></div><button class="btn ghost" id="clr" hidden>Clear filter</button></div>
      <div class="tablewrap"><table><thead><tr><th>System</th><th>Status</th><th>Owner</th><th>Sensitivity</th></tr></thead><tbody id="rows"></tbody></table></div>
      <div class="foot"><span id="cnt"></span><span class="muted">Click a System to open it</span></div>`;
    const draw = () => {
      const rows = sysList().filter((s) => (!S.sel.size || S.sel.has(s.level || 0)) && (!S.q || (s.name + s.vendor + s.owner).toLowerCase().includes(S.q.toLowerCase())));
      el.querySelector('#rows').innerHTML = rows.map((s) => `<tr data-id="${s.id}" tabindex="0"><td class="c-name"><div class="name"><b>${esc(s.name)}</b><small>${esc(s.vendor || 'Built in-house')}</small></div></td>
        <td class="c-status">${statusChip(s.status)}</td><td class="c-owner"><span class="owner"><span class="av">${initials(s.owner)}</span>${esc(s.owner)}</span></td>
        <td class="c-sens">${V.cell ? V.cell(s.level) : V.chip(s.level)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No Systems at this level.</td></tr>';
      el.querySelector('#cnt').textContent = `${rows.length} of ${sysList().length} Systems`;
      el.querySelector('#clr').hidden = !S.sel.size;
    };
    const open = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.type === 'click' || e.key === 'Enter')) { S.sys = tr.dataset.id; S.changing = false; setTab('system'); } };
    el.querySelector('#rows').addEventListener('click', open); el.querySelector('#rows').addEventListener('keydown', open);
    el.querySelector('#q').oninput = (e) => { S.q = e.target.value; draw(); };
    const drawFilter = () => (V.filter || defaultFilter)(el.querySelector('#flt'), { V, selected: S.sel, counts, onChange: (set) => { S.sel = set; drawFilter(); draw(); } });
    el.querySelector('#clr').onclick = () => { S.sel = new Set(); drawFilter(); draw(); };
    drawFilter(); draw();
  }
  function defaultFilter(el, { V, selected, counts, onChange }) {
    el.innerHTML = [1, 2, 3, 4, 5, 0].map((n) => `<button type="button" class="fchip" data-n="${n}" aria-pressed="${selected.has(n)}">${V.chip(n || null)}<em class="num">${counts[n]}</em></button>`).join('');
    el.onclick = (e) => { const b = e.target.closest('[data-n]'); if (!b) return; const s = new Set(selected), n = +b.dataset.n; if (s.has(n)) s.delete(n); else s.add(n); onChange(s); };
  }

  const perSystem = () => D.CONTROLS.filter((c) => c.scope !== 'Organizational');
  function systemPage(el, V) {
    const s = sysById(S.sys), lvl = s.level, withMin = perSystem().filter((c) => c.min != null);
    el.innerHTML = `
      <div class="syspick"><label>Sample System <select class="sel" id="sysSel">${sysList().map((x) => `<option value="${x.id}"${x.id === S.sys ? ' selected' : ''}>${esc(x.name)} (${labelOf(x.level)})</option>`).join('')}</select></label></div>
      <header class="syshead"><div><div class="crumb"><a href="#systems" data-go="systems">Systems</a> / ${esc(s.name)}</div>
        <h2 class="sysname"><span>${esc(s.name)}</span> ${V.chip(lvl, { size: 'lg' })}</h2>
        <p class="muted">${esc(s.vendor || 'Built in-house')} &middot; owned by ${esc(s.owner)} &middot; ${statusChip(s.status)}</p></div>
        <div class="acts"><button class="btn" ${lvl == null ? 'disabled aria-describedby="nosub"' : ''}>Submit for review</button></div></header>
      ${lvl == null ? '<div class="note" id="nosub" role="note"><b>No Sensitivity Level declared.</b> Pick one below. Until then this System meets no Control minimum and can\'t be submitted for review.</div>' : ''}
      <div class="two">
        <section class="subcard"><h3>Classification</h3>
          <dl class="kv"><dt>Deployment</dt><dd>SaaS</dd><dt>Sensitivity Level</dt><dd>${V.chip(lvl)} <button class="btn" id="chg">${S.changing ? 'Cancel' : (lvl == null ? 'Pick a level' : 'Change')}</button></dd>
          <dt>Integrity</dt><dd>Moderate</dd><dt>Availability</dt><dd>High</dd></dl>
          <div id="pk" class="pkwrap" ${S.changing ? '' : 'hidden'}></div></section>
        <section class="subcard"><h3>Controls this level brings in</h3><p class="muted sub">Of the ${withMin.length} Controls that set a minimum, ${withMin.filter((c) => meets(c, s)).length} apply${lvl == null ? ' (none: no level is declared)' : ''}.</p>
          <ul class="clist">${withMin.map((c) => `<li class="${meets(c, s) ? 'on' : 'off'}"><span><b>${c.id}</b> ${esc(c.name)}</span><span>${V.minCell(c.min)}<em>${meets(c, s) ? 'Applies' : 'Not yet'}</em></span></li>`).join('')}</ul></section>
      </div>`;
    el.querySelector('#sysSel').onchange = (e) => { S.sys = e.target.value; S.changing = false; systemPage(el, V); };
    el.querySelector('[data-go]').onclick = (e) => { e.preventDefault(); setTab('systems'); };
    el.querySelector('#chg').onclick = () => { S.changing = !S.changing; systemPage(el, V); };
    if (S.changing) {
      const pk = el.querySelector('#pk'); let picked = null;
      pk.innerHTML = '<div class="pkbody"></div><div class="pickacts"><button class="btn primary" data-save disabled>Save level</button><span class="muted">The System\'s applicable Controls are recalculated.</span></div>';
      const sv = pk.querySelector('[data-save]');
      V.picker(pk.querySelector('.pkbody'), { value: lvl, name: 'sysLevel', onPick: (n) => { picked = n; sv.disabled = n === lvl; } });
      sv.onclick = () => { s.level = picked; S.changing = false; if (g.Kit) Kit.toast(`${s.name} is now ${labelOf(picked)}.`); systemPage(el, V); };
    }
  }

  function interview(el, V) {
    const withMin = perSystem().filter((c) => c.min != null);
    el.innerHTML = `
      <div class="interview"><div class="iv-top"><span class="eyebrow">Onboarding interview</span><span class="muted">Question 6 of 11 &middot; Classification</span></div>
        <div class="prog"><span class="track"><span class="fill" style="width:55%"></span></span></div>
        <h3 class="iv-q">What is the most sensitive information Notion may handle?</h3>
        <p class="muted">Pick the highest level that fits. Controls that protect more sensitive information start at a higher level, so picking too low leaves Controls out. You can change it later.</p>
        <div id="ivpk" class="pkwrap"></div>
        <p class="iv-note" id="ivn" aria-live="polite"></p>
        <div class="iv-foot"><button class="btn">Back</button><span class="grow"></span><button class="btn ghost" id="skip">Not sure yet</button><button class="btn primary" id="next">Next</button></div></div>`;
    const note = () => {
      const n = S.iv; el.querySelector('#next').disabled = !n;
      el.querySelector('#ivn').innerHTML = n ? `You picked ${V.chip(n)}. ${withMin.filter((c) => c.min <= n).length} of the ${withMin.length} Controls with a minimum will apply.` : 'Nothing picked yet.';
    };
    const pk = () => V.picker(el.querySelector('#ivpk'), { value: S.iv, name: 'ivLevel', onPick: (n) => { S.iv = n; note(); } });
    el.querySelector('#skip').onclick = () => { S.iv = null; pk(); note(); el.querySelector('#ivn').innerHTML = `Saved as ${V.chip(null)}. You can declare a level later from the System page, but the System can't be submitted for review until you do.`; };
    el.querySelector('#next').onclick = () => { if (g.Kit) Kit.toast('Next question (not part of this design)'); };
    pk(); note();
  }

  function controlLibrary(el, V) {
    const rowsOf = D.CONTROLS;
    el.innerHTML = `
      <div class="tablewrap"><table><thead><tr><th>Control</th><th>Scope</th><th>Applies from</th><th class="r">Systems</th></tr></thead><tbody>
      ${rowsOf.map((c) => `<tr data-id="${c.id}" tabindex="0"><td class="c-name"><div class="name"><b>${esc(c.name)}</b><small>${c.id}</small></div></td><td>${c.scope}</td>
        <td>${c.scope === 'Organizational' ? '<span class="muted">Not scoped by level</span>' : V.minCell(c.min)}</td>
        <td class="r num">${c.scope === 'Organizational' ? '-' : sysList().filter((s) => meets(c, s)).length}</td></tr>`).join('')}
      </tbody></table></div><div class="foot"><span class="muted">Click a Control to open its drawer</span></div>
      <div class="scrim" hidden></div><aside class="drawer" hidden role="dialog" aria-modal="true" aria-label="Control details"></aside>`;
    const dr = el.querySelector('.drawer'), sc = el.querySelector('.scrim');
    const close = () => { dr.hidden = true; sc.hidden = true; S.ctrl = null; };
    const open = (id) => {
      const c = rowsOf.find((x) => x.id === id); S.ctrl = id;
      const hit = sysList().filter((s) => meets(c, s)), miss = sysList().filter((s) => !meets(c, s)), org = c.scope === 'Organizational';
      dr.innerHTML = `<div class="dr-h"><div><span class="eyebrow">${c.id}</span><h3>${esc(c.name)}</h3></div><button class="btn ghost" id="x" aria-label="Close">&#10005;</button></div>
        <p>${esc(c.text)}</p>
        <dl class="kv"><dt>Scope</dt><dd>${c.scope}</dd><dt>Applies from</dt><dd>${org ? 'Not scoped by level' : V.minCell(c.min)}</dd></dl>
        ${org ? '' : `<p class="muted sub">It applies to a System only once the System's level is at or above the minimum. A System with no level declared never meets a minimum.</p>
        <h4>Applies to ${hit.length} of ${sysList().length} Systems</h4><ul class="slist">${hit.map((s) => `<li>${esc(s.name)} ${V.chip(s.level, { size: 'sm' })}</li>`).join('') || '<li class="muted">None</li>'}</ul>
        ${miss.length ? `<h4>Does not apply to ${miss.length}</h4><ul class="slist off">${miss.map((s) => `<li>${esc(s.name)} ${V.chip(s.level, { size: 'sm' })}</li>`).join('')}</ul>` : ''}`}`;
      dr.hidden = false; sc.hidden = false; dr.querySelector('#x').onclick = close; dr.querySelector('#x').focus();
    };
    sc.onclick = close; el.onkeydown = (e) => { if (e.key === 'Escape' && !dr.hidden) close(); };
    const go = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.type === 'click' || e.key === 'Enter')) open(tr.dataset.id); };
    el.querySelector('tbody').addEventListener('click', go); el.querySelector('tbody').addEventListener('keydown', go);
    if (S.ctrl) open(S.ctrl);
  }

  function settingsFrame(el, V) {
    el.innerHTML = `<div class="settingsmock">
      <p class="muted crumb">Admin / Settings</p>
      <h2>Settings</h2><p class="muted">Changes take effect at once. Each change is recorded in Recent activity.</p>
      <div class="sm-sec"><h3>Sensitivity Levels</h3>
        <p class="muted sub">The five levels are fixed: you can change a level's label, description and colours, but not add, remove or reorder levels. Set the colours for light mode; dark mode colours are derived from them, and the colours are the same in every theme. A text and background pair needs a contrast of at least 4.5:1 (WCAG AA) to be saved.</p>
        <div id="lvls"></div></div></div>`;
    V.settings(el.querySelector('#lvls'));
  }

  // ---------- mount ----------
  const TABS = [['chip', 'The chip', chipSheet], ['systems', 'Systems list', systemsList], ['system', 'System details', systemPage],
    ['interview', 'Onboarding interview', interview], ['controls', 'Control Library', controlLibrary], ['settings', 'Admin settings', settingsFrame]];
  let Vc, host;
  // The hash carries the acting role (read by the shared header) and the tab: #role=ADMIN&tab=settings
  const roleHash = () => { const m = location.hash.match(/role=[A-Z_]+/); return m ? m[0] + '&' : ''; };
  function setTab(id) { S.tab = id; try { history.replaceState(null, '', '#' + roleHash() + 'tab=' + id); } catch (e) { /* sandboxed */ } renderTabs(); }
  function renderTabs() {
    host.innerHTML = `<div class="tabs" role="tablist" aria-label="Surfaces">${TABS.map(([k, l]) => `<button role="tab" id="t-${k}" aria-selected="${k === S.tab}" aria-controls="panel" data-t="${k}">${l}</button>`).join('')}</div><div class="panel" id="panel" role="tabpanel" aria-labelledby="t-${S.tab}"></div>`;
    host.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => setTab(b.dataset.t); });
    TABS.find((t) => t[0] === S.tab)[2](host.querySelector('#panel'), Vc);
  }
  function mount(el, V) {
    Vc = V; host = el;
    const m = location.hash.match(/(?:^#|tab=)([a-z]+)$/); const h = m && m[1]; if (TABS.some((t) => t[0] === h)) S.tab = h;
    listeners.push(() => { if (S.tab !== 'settings') renderTabs(); });
    renderTabs();
  }
  Object.assign(g.Sens, { levels: () => levels, lv, save, bindLevel, fields, mount, labelOf, esc, defaults });
})(typeof window !== 'undefined' ? window : globalThis);
