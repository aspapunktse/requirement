/**
 * The theme choice (#286): a named set of colour and font tokens (`design-tokens.css`). Mode (System / Light /
 * Dark, `mode.ts`) is a separate choice; every theme has a light and a dark variant.
 *
 * The choice lives in localStorage under `palette` (the key the design prototypes use as well); no entry means
 * Register, the default. It is applied as `data-palette` on <html>; Register has no attribute, so nothing changes
 * for anyone who never picks a theme. An unknown or removed id falls back to Register.
 */
export type PaletteId = "register" | "contrast" | "parchment" | "slate" | "forest";

export type Palette = {
  id: PaletteId;
  name: string;
  /** One line, shown on the picker's card. */
  character: string;
  /** The theme's font names, for the card's font sample. Register's are the system faces. */
  sans: string;
  mono: string;
  /** CSS font-family for the card's sample: the font variable from `fonts.ts` first, then the system faces. */
  sample: string;
  /** [paper, surface, accent, ink] in each mode, copied from `design-tokens.css`. */
  swatch: { light: [string, string, string, string]; dark: [string, string, string, string] };
};

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const DEFAULT_PALETTE: PaletteId = "register";

export const PALETTE_KEY = "palette";

export const PALETTES: readonly Palette[] = [
  {
    id: "register",
    name: "Register",
    character: "The current look: cool paper, ink blue, one teal accent.",
    sans: "System UI",
    mono: "System mono",
    sample: SYSTEM_SANS,
    swatch: { light: ["#f2f5f6", "#ffffff", "#075d68", "#142d3d"], dark: ["#0e1b22", "#14252e", "#5fc3ca", "#dbe7ec"] },
  },
  {
    id: "contrast",
    name: "High contrast",
    character: "Black on white, a strong blue accent and a typeface made to be told apart.",
    sans: "Atkinson Hyperlegible Next",
    mono: "Atkinson Hyperlegible Mono",
    sample: `var(--font-atkinson-sans, "Atkinson Hyperlegible Next"), ${SYSTEM_SANS}`,
    swatch: { light: ["#f2f2f2", "#ffffff", "#0033cc", "#000000"], dark: ["#000000", "#0b0b0b", "#8fb8ff", "#ffffff"] },
  },
  {
    id: "parchment",
    name: "Parchment",
    character: "Cream paper, brown ink and a terracotta accent; a calm, bookish feel.",
    sans: "Source Sans 3",
    mono: "Source Code Pro",
    sample: `var(--font-source-sans, "Source Sans 3"), ${SYSTEM_SANS}`,
    swatch: { light: ["#f6f0e4", "#fffcf5", "#a2432a", "#2b2118"], dark: ["#1c1612", "#251e18", "#f0906c", "#f1e8d8"] },
  },
  {
    id: "slate",
    name: "Slate",
    character: "Cool neutral greys with an indigo accent; neutral, tool-like and quiet.",
    sans: "Inter",
    mono: "JetBrains Mono",
    sample: `var(--font-inter, Inter), ${SYSTEM_SANS}`,
    swatch: { light: ["#f1f3f6", "#ffffff", "#4338ca", "#1a2030"], dark: ["#0f1219", "#171b25", "#a5b4fc", "#e4e8f0"] },
  },
  {
    id: "forest",
    name: "Forest",
    character: "Pale green paper and a deep pine accent; fresh without being loud.",
    sans: "Public Sans",
    mono: "IBM Plex Mono",
    sample: `var(--font-public-sans, "Public Sans"), ${SYSTEM_SANS}`,
    swatch: { light: ["#f0f4ee", "#fdfefc", "#14583a", "#17281c"], dark: ["#0d1a12", "#13241a", "#6fd08f", "#dcebe0"] },
  },
];

/** The theme with this id; an unknown id gives Register. */
export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

const isKnown = (id: string | null): id is PaletteId => PALETTES.some((palette) => palette.id === id);

/**
 * Runs in <head> before first paint, after the Mode script. Keep it tiny and free of imports: it is inlined as
 * text. Register (and any unknown id) leaves the attribute off.
 */
export const PALETTE_INIT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});if(${JSON.stringify(PALETTES.filter((palette) => palette.id !== DEFAULT_PALETTE).map((palette) => palette.id))}.indexOf(p)>-1)document.documentElement.setAttribute("data-palette",p)}catch(e){}`;

export function readStoredPalette(): PaletteId {
  try {
    const stored = window.localStorage.getItem(PALETTE_KEY);
    return isKnown(stored) ? stored : DEFAULT_PALETTE;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function applyPalette(id: PaletteId): void {
  if (id === DEFAULT_PALETTE) document.documentElement.removeAttribute("data-palette");
  else document.documentElement.setAttribute("data-palette", id);
}

const listeners = new Set<() => void>();

// The theme in effect on this page. Kept in memory so the picker shows what is applied even when storage is
// blocked or a write throws; read from storage lazily, on first use and when another tab changes it.
let current: PaletteId | null = null;

/** Tests only: forget the in-memory choice so the next read comes from storage again. */
export function resetPaletteStateForTests(): void {
  current = null;
}

/** Applies and stores the theme (Register clears the entry). A blocked storage still applies it for this page. */
export function savePalette(id: string): void {
  const palette = getPalette(id).id;
  applyPalette(palette);
  current = palette;
  try {
    if (palette === DEFAULT_PALETTE) window.localStorage.removeItem(PALETTE_KEY);
    else window.localStorage.setItem(PALETTE_KEY, palette);
  } catch {
    // Storage is unavailable: the choice holds until the page is reloaded.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Applies a theme to the page without saving it (the picker's hover and focus preview); `null` puts the saved
 * theme back. Does not notify subscribers: what the picker shows as chosen stays the saved theme.
 */
export function previewPalette(id: string | null): void {
  applyPalette(id === null ? getPaletteSnapshot() : getPalette(id).id);
}

/** For `useSyncExternalStore`. Also reacts to other tabs' changes. */
export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PALETTE_KEY) return;
    current = readStoredPalette();
    applyPalette(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getPaletteSnapshot(): PaletteId {
  if (current === null) current = readStoredPalette();
  return current;
}

export function getPaletteServerSnapshot(): PaletteId {
  return DEFAULT_PALETTE;
}
