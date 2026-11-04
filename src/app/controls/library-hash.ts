import { codeFromHash } from "./library-logic";

/**
 * The Control Library keeps its open drawer in the URL hash (`#A.5.1`), so a Control can be linked. A push of a
 * history entry fires no event of its own, so `writeHash` announces itself; Back and Forward fire `popstate`, a
 * typed hash fires `hashchange`. Client-only, like the System page's `system-hash.ts`.
 */
const HASH_EVENT = "control-library-hash-change";

export function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}

/** The Control code in the URL hash now. */
export const currentCode = () => codeFromHash(window.location.hash);

/** Nothing is open on the server, where there is no hash. */
export const serverCode = () => "";

/**
 * Goes to a hash (`#A.5.1`, or "" for none) as a new history entry, so Back returns to where the user was;
 * `replace` swaps the current entry instead (stepping from one Control to the next).
 */
export function writeHash(hash: string, options: { replace?: boolean } = {}) {
  if (window.location.hash === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(HASH_EVENT));
}
