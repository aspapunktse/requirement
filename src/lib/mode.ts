/**
 * The colour mode choice (#282, renamed from "theme" in #286): "system" (the default; follow the OS), "light" or "dark". The choice lives in
 * localStorage under `theme` as "light" or "dark"; no entry means System. It is applied as `data-theme` on <html>
 * (see `design-tokens.css`); System removes the attribute, so the `prefers-color-scheme` rules take over.
 * The design prototypes (`public/design/shared/appbar.js`) use the same key.
 */
export type ModeChoice = "system" | "light" | "dark";

export const MODE_KEY = "theme";

export const MODE_CHOICES: { value: ModeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Runs in <head> before first paint. Keep it tiny and free of imports: it is inlined as text. */
export const MODE_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(MODE_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readStoredMode(): ModeChoice {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyMode(choice: ModeChoice): void {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}

const listeners = new Set<() => void>();

// The choice in effect on this page. Kept in memory so the switch shows what is applied even when storage is
// blocked or a write throws; read from storage lazily, on first use and when another tab changes it.
let current: ModeChoice | null = null;

/** Tests only: forget the in-memory choice so the next read comes from storage again. */
export function resetModeStateForTests(): void {
  current = null;
}

/** Applies and stores the choice (System clears the entry). A blocked storage still applies it for this page. */
export function saveMode(choice: ModeChoice): void {
  applyMode(choice);
  current = choice;
  try {
    if (choice === "system") window.localStorage.removeItem(MODE_KEY);
    else window.localStorage.setItem(MODE_KEY, choice);
  } catch {
    // Storage is unavailable: the choice holds until the page is reloaded.
  }
  listeners.forEach((listener) => listener());
}

/** For `useSyncExternalStore`. Also reacts to other tabs' changes. */
export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MODE_KEY) return;
    current = readStoredMode();
    applyMode(current);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getModeSnapshot(): ModeChoice {
  if (current === null) current = readStoredMode();
  return current;
}

export function getModeServerSnapshot(): ModeChoice {
  return "system";
}
