// Themes for the design prototypes (#286): a theme is a named set of colour and font tokens (themes.css). This
// helper lists them, applies the stored one as data-palette on <html> and keeps it in localStorage under 'palette'
// (no entry = Register, the current look, which needs no attribute). Mode (System / Light / Dark) is separate:
// that lives in appbar.js under 'theme'.
//
//   <script src="../shared/themes.js"></script>        in <head>: applies the stored theme before first paint
//
//   Themes.list                  [{ id, name, character, sans, mono, swatch: { light: [...], dark: [...] }, fonts }]
//   Themes.get(id)               one entry; an unknown id gives Register
//   Themes.current()             the id applied now (the previewed one, while previewing)
//   Themes.saved()               the id in storage ('register' when none or unknown)
//   Themes.set(id)               apply, save, fire 'themes:change' (detail: { id })
//   Themes.preview(id | null)    apply without saving; null puts the saved theme back. Fires 'themes:preview'
//   Themes.loadFonts(id)         load a theme's web fonts now (used by thumbnails that show a face before it is chosen)
//
// Web fonts come from Google Fonts here; the app itself will self-host them with next/font. Only the applied
// (or previewed) theme's stylesheet is added to the page, so a page loads one theme's fonts unless it asks for more.
// Changes in another tab arrive through the 'storage' event and fire 'themes:change' too.
(function () {
  const KEY = 'palette';
  const SELF = document.currentScript && document.currentScript.src;
  const gf = (families) => 'https://fonts.googleapis.com/css2?' + families.map((f) => 'family=' + f).join('&') + '&display=swap';

  // swatch: [paper, surface, accent, ink] in each mode, copied from themes.css
  const list = [
    { id: 'register', name: 'Register', character: 'The current look: cool paper, ink blue, one teal accent.', sans: 'System UI', mono: 'System mono', fonts: null,
      swatch: { light: ['#f2f5f6', '#ffffff', '#075d68', '#142d3d'], dark: ['#0e1b22', '#14252e', '#5fc3ca', '#dbe7ec'] } },
    { id: 'contrast', name: 'High contrast', character: 'Black on white, a strong blue accent and a typeface made to be told apart.', sans: 'Atkinson Hyperlegible Next', mono: 'Atkinson Hyperlegible Mono',
      fonts: gf(['Atkinson+Hyperlegible+Next:wght@400..800', 'Atkinson+Hyperlegible+Mono:wght@400..700']),
      swatch: { light: ['#f2f2f2', '#ffffff', '#0033cc', '#000000'], dark: ['#000000', '#0b0b0b', '#8fb8ff', '#ffffff'] } },
    { id: 'parchment', name: 'Parchment', character: 'Cream paper, brown ink and a terracotta accent; a calm, bookish feel.', sans: 'Source Sans 3', mono: 'Source Code Pro',
      fonts: gf(['Source+Sans+3:wght@400..800', 'Source+Code+Pro:wght@400..700']),
      swatch: { light: ['#f6f0e4', '#fffcf5', '#a2432a', '#2b2118'], dark: ['#1c1612', '#251e18', '#f0906c', '#f1e8d8'] } },
    { id: 'slate', name: 'Slate', character: 'Cool neutral greys with an indigo accent; neutral, tool-like and quiet.', sans: 'Inter', mono: 'JetBrains Mono',
      fonts: gf(['Inter:wght@400..800', 'JetBrains+Mono:wght@400..700']),
      swatch: { light: ['#f1f3f6', '#ffffff', '#4338ca', '#1a2030'], dark: ['#0f1219', '#171b25', '#a5b4fc', '#e4e8f0'] } },
    { id: 'forest', name: 'Forest', character: 'Pale green paper and a deep pine accent; fresh without being loud.', sans: 'Public Sans', mono: 'IBM Plex Mono',
      fonts: gf(['Public+Sans:wght@400..800', 'IBM+Plex+Mono:wght@400;500;600;700']),
      swatch: { light: ['#f0f4ee', '#fdfefc', '#14583a', '#17281c'], dark: ['#0d1a12', '#13241a', '#6fd08f', '#dcebe0'] } },
  ];
  const DEFAULT = 'register';
  const get = (id) => list.find((t) => t.id === id) || list[0];
  const known = (id) => list.some((t) => t.id === id);

  const readSaved = () => { try { const v = localStorage.getItem(KEY); return known(v) ? v : DEFAULT; } catch (e) { return DEFAULT; } };
  let saved = readSaved();   // what a reload would give (kept in memory when storage is blocked)
  let applied = saved;       // what the page shows now

  const head = () => document.head || document.documentElement;
  function ensureCss() {
    if (document.querySelector('link[rel="stylesheet"][href*="themes.css"]') || !SELF) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('themes.css', SELF).href; head().appendChild(l);
  }
  function loadFonts(id) {
    const t = get(id);
    if (!t.fonts || document.querySelector('link[data-theme-fonts="' + t.id + '"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = t.fonts; l.setAttribute('data-theme-fonts', t.id); head().appendChild(l);
  }
  function apply(id) {
    const t = get(id);
    applied = t.id;
    if (t.id === DEFAULT) document.documentElement.removeAttribute('data-palette'); else document.documentElement.setAttribute('data-palette', t.id);
    loadFonts(t.id);
  }
  function set(id) {
    const t = get(id);
    apply(t.id); saved = t.id;
    try { if (t.id === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, t.id); } catch (e) { /* storage blocked: holds for this page only */ }
    dispatchEvent(new CustomEvent('themes:change', { detail: { id: t.id } }));
  }
  function preview(id) {
    apply(id == null ? saved : id);
    dispatchEvent(new CustomEvent('themes:preview', { detail: { id: applied, previewing: id != null } }));
  }

  ensureCss();
  apply(saved);
  addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== KEY) return;
    saved = readSaved(); apply(saved);
    dispatchEvent(new CustomEvent('themes:change', { detail: { id: saved } }));
  });

  window.Themes = { list, get, current: () => applied, saved: () => saved, set, preview, loadFonts, DEFAULT };
})();
