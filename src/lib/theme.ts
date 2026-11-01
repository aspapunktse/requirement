/**
 * The colour theme choice (#282): "system" (the default; follow the OS), "light" or "dark". The choice lives in
 * localStorage under `theme` as "light" or "dark"; no entry means System. It is applied as `data-theme` on <html>
 * (see `design-tokens.css`); System removes the attribute, so the `prefers-color-scheme` rules take over.
 * The design prototypes (`public/design/shared/appbar.js`) use the same key.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "theme";

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Runs in <head> before first paint. Keep it tiny and free of imports: it is inlined as text. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readStoredTheme(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}

const listeners = new Set<() => void>();

// The choice in effect on this page. Kept in memory so the switch shows what is applied even when storage is
// blocked or a write throws; read from storage lazily, on first use and when another tab changes it.
let current: ThemeChoice | null = null;

/** Tests only: forget the in-memory choice so the next read comes from storage again. */
export function resetThemeStateForTests(): void {
  current = null;
}

/** Applies and stores the choice (System clears the entry). A blocked storage still applies it for this page. */
export function saveTheme(choice: ThemeChoice): void {
  applyTheme(choice);
  current = choice;
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage is unavailable: the choice holds until the page is reloaded.
  }
  listeners.forEach((listener) => listener());
}

/** For `useSyncExternalStore`. Also reacts to other tabs' changes. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_KEY) return;
    current = readStoredTheme();
    applyTheme(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getThemeSnapshot(): ThemeChoice {
  if (current === null) current = readStoredTheme();
  return current;
}

export function getThemeServerSnapshot(): ThemeChoice {
  return "system";
}
