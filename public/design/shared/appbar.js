// The app header for every design proposal: logo and wordmark, the main navigation, "Jump to"
// (Ctrl+K palette) and the acting-user chip. Each page calls
//
//   Appbar.mount({
//     current: 'systems',                                   // key from NAV below
//     proposal: { label: 'A', siblings: [['B', 'proposal-b.html'], ['C', 'proposal-c.html']] },
//     items: () => [{ group: 'Systems', label, sub, icon, href | run }],   // optional palette entries
//   });
//
// into an empty <header id="appbar"></header>. The acting role lives in the URL hash
// (#role=SYSTEM_OWNER), the same way the Home proposals keep it, and nav links carry it along.
// Pages listen for the 'appbar:role' event (detail = role) and read Appbar.role().
//
// Theme: the header carries the System / Light / Dark switch (also in the narrow-screen menu), the same as the app
// (#282). The choice is kept in localStorage under 'theme' ('light' | 'dark'; no entry = System, which follows the OS)
// and applied as data-theme on <html> as soon as this script runs, so load it in <head> or early in <body>.
// A page does not need its own theme button.
(function () {
  const THEME_KEY = 'theme';
  const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const theme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; } };
  const applyTheme = (t) => { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); };
  function setTheme(t) {
    applyTheme(t);
    try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked: holds for this page only */ }
    syncTheme();
  }
  function syncTheme() {
    const cur = theme();
    document.querySelectorAll('.ab-theme [data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === cur)));
  }
  const themeGroup = (cls) => `<div class="ab-theme ${cls}" role="group" aria-label="Theme">${THEMES.map(([k, l]) =>
    `<button type="button" data-theme-set="${k}" aria-pressed="${k === theme()}">${l}</button>`).join('')}</div>`;
  applyTheme(theme());
  addEventListener('storage', (e) => { if (e.key === null || e.key === THEME_KEY) { applyTheme(theme()); syncTheme(); } });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);

  const P = {
    home: 'M3 9l7-6 7 6v8H3zM8 17v-5h4v5',
    system: 'M3 4h14v9H3zM7 17h6M10 13v4',
    control: 'M4 10l4 4 8-8M3 3h14v14H3z',
    risk: 'M10 3l6 3v4c0 4-3 6-6 7-3-1-6-3-6-7V6z',
    checkup: 'M6 3h8v14H6zM8 7h4M8 10l1.5 1.5L12 9',
    audit: 'M4 4h9l3 3v10H4zM8 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M11.5 12.5L14 15',
    soa: 'M6 3h6l3 3v11H6zM12 3v3h3M8 10h5M8 13h5',
    framework: 'M10 3l7 4-7 4-7-4zM3 11l7 4 7-4',
    search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4',
    menu: 'M3 6h14M3 10h14M3 14h14',
    plus: 'M10 4v12M4 10h12',
    arrow: 'M5 10h10M11 6l4 4-4 4',
    grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
    admin: 'M3 6l7-3 7 3-7 3zM3 10l7 3 7-3M3 14l7 3 7-3',
  };
  const icon = (k, size = 16) => `<svg class="ab-ico" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k] || P.grid}"/></svg>`;

  // One entry per part of the app. href points at the proposal that shipped or is preferred;
  // null means no proposal exists yet, so the item shows but does not link.
  const NAV = [
    { key: 'home', label: 'Home', icon: 'home', href: '/design/home/proposal-a.html' },
    { key: 'systems', label: 'Systems', icon: 'system', href: '/design/systems/proposal-a.html' },
    { key: 'controls', label: 'Controls', icon: 'control', href: '/design/controls/proposal-a.html' },
    { key: 'risks', label: 'Risks', icon: 'risk', href: null },
    { key: 'check-ups', label: 'Check-ups', icon: 'checkup', href: null },
    { key: 'audits', label: 'Internal Audits', icon: 'audit', href: '/design/audit/proposal-a.html' },
    { key: 'soa', label: 'SoA', long: 'Statement of Applicability', icon: 'soa', href: '/design/soa/proposal-a.html' },
    { key: 'frameworks', label: 'Frameworks', icon: 'framework', href: '/design/frameworks/proposal-a.html' },
    // As in production, only an Admin sees the Admin item; it links to the first Admin page with a proposal.
    { key: 'admin', label: 'Admin', icon: 'admin', href: '/design/deployment-facets/proposal-a.html', only: 'ADMIN' },
  ];
  // The same people as the Home proposals (public/design/home/data.js).
  const ROLES = [
    { key: 'SYSTEM_OWNER', label: 'System Owner', person: 'Marcus Lindqvist' },
    { key: 'REVIEWER', label: 'Reviewer', person: 'Sara Ek' },
    { key: 'RISK_OWNER', label: 'Risk Owner', person: 'Johan Berg' },
    { key: 'BUSINESS_RISK_OWNER', label: 'Business Risk Owner', person: 'Lena Holm' },
    { key: 'COMPLIANCE_MANAGER', label: 'Compliance Manager', person: 'Anna Sjöberg' },
    { key: 'ADMIN', label: 'Admin', person: 'Default Admin' },
  ];

  const roleKey = () => { const m = location.hash.match(/role=([A-Z_]+)/); return m && ROLES.some((r) => r.key === m[1]) ? m[1] : ROLES[0].key; };
  const role = () => ROLES.find((r) => r.key === roleKey());
  const withRole = (href) => href.split('#')[0] + '#role=' + roleKey();
  function setRole(key) {
    history.replaceState(null, '', '#role=' + key);
    dispatchEvent(new HashChangeEvent('hashchange'));
  }

  // Nav items the acting role sees: an item with `only` shows to that role alone
  const visibleNav = () => NAV.filter((n) => !n.only || n.only === roleKey());

  let opts = {};
  const $ = (id) => document.getElementById(id);

  function navLink(n, inPop) {
    const cur = n.key === opts.current ? ' aria-current="page"' : '';
    const label = inPop ? (n.long || n.label) : n.label;
    const title = n.long && !inPop ? ` title="${esc(n.long)}"` : '';
    const inner = inPop
      ? `<span class="ab-ib">${icon(n.icon, 17)}</span><span>${esc(label)}</span>${n.href ? '' : '<small>no proposal yet</small>'}`
      : `${icon(n.icon)}${esc(label)}`;
    if (!n.href) return `<span class="ab-soon" aria-disabled="true" title="No design proposal yet">${inner}</span>`;
    return `<a href="${esc(n.href)}" data-keep-role${cur}${title}>${inner}</a>`;
  }

  function render() {
    const r = role();
    const cur = NAV.find((n) => n.key === opts.current) || NAV[0];
    $('appbar').className = 'appbar' + (visibleNav().length > NAV.length - 1 ? ' ab-many' : '');
    $('appbar').innerHTML = `
      <a class="ab-brand" href="${withRole(NAV[0].href)}" data-keep-role aria-label="ISMS - system onboarding, Home">
        <span class="ab-mark" aria-hidden="true"><span></span></span>
        <span class="ab-word"><b>ISMS</b><small>System onboarding</small></span>
      </a>
      <div class="ab-menu">
        <button type="button" id="abMenuBtn" aria-expanded="false" aria-controls="abMenu">${icon('menu')}<span class="ab-menu-l">${esc(cur.label)}</span><span class="ab-caret">▾</span></button>
        <div class="ab-pop" id="abMenu" hidden><span class="ab-label">Go to</span>${visibleNav().map((n) => navLink(n, true)).join('')}<span class="ab-label ab-theme-label">Theme</span>${themeGroup('ab-theme-menu')}</div>
      </div>
      <nav class="ab-nav" aria-label="Main">${visibleNav().map((n) => navLink(n, false)).join('')}</nav>
      <span class="ab-spacer"></span>
      <button type="button" class="ab-search" id="abJump" aria-label="Jump to (Ctrl+K)">${icon('search')}<span>Jump to…</span><kbd>Ctrl K</kbd></button>
      ${themeGroup('ab-theme-bar')}
      <div class="ab-user">
        <button type="button" id="abUserBtn" aria-expanded="false" aria-controls="abUser" aria-label="Acting as ${esc(r.person)}, ${esc(r.label)}">
          <span class="ab-av">${esc(initials(r.person))}</span><span class="ab-who"><b>${esc(r.person)}</b><small>${esc(r.label)}</small></span><span class="ab-caret">▾</span>
        </button>
        <div class="ab-pop" id="abUser" role="menu" hidden><span class="ab-label">Act as</span>${ROLES.map((x) =>
          `<button type="button" role="menuitemradio" aria-label="${esc(x.person)}, ${esc(x.label)}" aria-checked="${x.key === r.key}" data-role="${x.key}"><span class="ab-av">${esc(initials(x.person))}</span><span>${esc(x.person)}<br><small>${esc(x.label)}</small></span></button>`).join('')}</div>
      </div>`;
    document.querySelectorAll('[data-keep-role]').forEach((a) => { a.href = withRole(a.getAttribute('href')); });
  }

  function renderProto() {
    const p = opts.proposal;
    if (!p) return;
    let el = $('abProto');
    if (!el) { el = document.createElement('nav'); el.id = 'abProto'; el.className = 'ab-proto'; el.setAttribute('aria-label', 'Design proposals'); document.body.appendChild(el); }
    el.innerHTML = `<a class="ab-all" href="/design">All proposals</a><span aria-current="page">Proposal ${esc(p.label)}</span>${(p.siblings || []).map(([l, h]) =>
      `<a href="${esc(withRole(h))}">${esc(l)}</a>`).join('')}`;
  }

  // Popovers: one open at a time, closed by outside click or Escape
  function toggle(btnId, popId, force) {
    const btn = $(btnId), pop = $(popId);
    const open = force ?? pop.hidden;
    document.querySelectorAll('.appbar .ab-pop').forEach((x) => { if (x !== pop) x.hidden = true; });
    document.querySelectorAll('.appbar [aria-expanded]').forEach((b) => { if (b !== btn) b.setAttribute('aria-expanded', 'false'); });
    pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  }

  // Palette
  let palItems = [], palSel = 0;
  function allItems() {
    const pages = visibleNav().filter((n) => n.href && n.key !== opts.current).map((n) => ({ group: 'Go to', label: n.long || n.label, icon: n.icon, href: withRole(n.href), sub: 'page' }));
    const own = (opts.items ? opts.items() : []);
    return own.concat(pages);
  }
  function renderPal() {
    const q = $('abPalQ').value.trim().toLowerCase();
    palItems = allItems().filter((x) => !q || (x.label + ' ' + (x.sub || '') + ' ' + x.group).toLowerCase().includes(q)).slice(0, 40);
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let html = '', grp = null;
    palItems.forEach((x, i) => {
      if (x.group !== grp) { grp = x.group; html += `<li class="ab-grp" role="presentation">${esc(grp)}</li>`; }
      html += `<li role="option" id="abOpt${i}" data-i="${i}" aria-selected="${i === palSel}">${icon(x.icon || 'arrow')}<span>${esc(x.label)}</span><small>${esc(x.sub || '')}</small></li>`;
    });
    $('abPalList').innerHTML = html || '<li class="ab-none" role="presentation">Nothing matches.</li>';
    $('abPalQ').setAttribute('aria-activedescendant', palItems.length ? 'abOpt' + palSel : '');
    const on = $('abPalList').querySelector('[aria-selected="true"]'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function closePops() {
    document.querySelectorAll('.appbar .ab-pop').forEach((p) => { p.hidden = true; });
    document.querySelectorAll('.appbar [aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function openPal() {
    closePops();
    $('abScrim').hidden = false; $('abPal').hidden = false;
    $('abPalQ').value = ''; palSel = 0; renderPal(); $('abPalQ').focus();
  }
  function closePal() { $('abScrim').hidden = true; $('abPal').hidden = true; }
  function choose(i) {
    const x = palItems[i]; if (!x) return;
    closePal();
    if (x.run) x.run(); else if (x.href) location.href = x.href;
  }

  function mountPal() {
    const scrim = document.createElement('div'); scrim.className = 'ab-scrim'; scrim.id = 'abScrim'; scrim.hidden = true;
    const pal = document.createElement('div'); pal.className = 'ab-pal'; pal.id = 'abPal'; pal.hidden = true;
    pal.setAttribute('role', 'dialog'); pal.setAttribute('aria-label', 'Jump to'); pal.setAttribute('aria-modal', 'true');
    pal.innerHTML = `<input id="abPalQ" placeholder="Jump to a page or a record…" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="abPalList">
      <ul id="abPalList" role="listbox"></ul>
      <footer><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>`;
    document.body.append(scrim, pal);
    scrim.addEventListener('click', closePal);
    $('abPalQ').addEventListener('input', () => { palSel = 0; renderPal(); });
    $('abPalList').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) choose(+li.dataset.i); });
    $('abPalQ').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPal(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPal(); }
      if (e.key === 'Enter') { e.preventDefault(); choose(palSel); }
    });
  }

  function mount(o) {
    opts = o || {};
    render(); renderProto(); mountPal();
    document.addEventListener('click', (e) => {
      if (e.target.closest('#abMenuBtn')) return toggle('abMenuBtn', 'abMenu');
      if (e.target.closest('#abUserBtn')) return toggle('abUserBtn', 'abUser');
      if (e.target.closest('#abJump')) return openPal();
      const tb = e.target.closest('[data-theme-set]');
      if (tb) { setTheme(tb.dataset.themeSet); return; }
      const rb = e.target.closest('[data-role]');
      if (rb) { setRole(rb.dataset.role); return; }
      if (!e.target.closest('.ab-pop')) closePops();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('abPal').hidden ? openPal() : closePal(); }
      if (e.key === 'Escape') {
        if (!$('abPal').hidden) closePal();
        const open = document.querySelector('.appbar [aria-expanded="true"]');
        if (open) { closePops(); open.focus(); }
      }
    });
    addEventListener('hashchange', () => { render(); renderProto(); dispatchEvent(new CustomEvent('appbar:role', { detail: role() })); });
  }

  window.Appbar = { mount, theme, setTheme, role, roleKey, setRole, withRole, icon, NAV, ROLES, open: openPal };
})();
