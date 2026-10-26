import { parseHash } from "./system-page-logic";

/**
 * The System page keeps its place in the URL hash: the tab (`#controls`) and, on the Controls tab, the
 * open Control (`#controls/A.5.13`). A push of a history entry fires no event of its own, so `writeHash`
 * announces itself; Back and Forward fire `popstate`, a typed hash fires `hashchange`. Client-only.
 */
const HASH_EVENT = "system-tab-change";

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

export const currentTab = () => parseHash(window.location.hash).tab;
export const currentControlCode = () => parseHash(window.location.hash).controlCode;
export const serverTab = () => "overview" as const;
export const serverControlCode = () => null;

/** Go to a hash (`#controls`, `#controls/A.5.13`) as a new history entry, so Back returns to where the user was. */
export function writeHash(hash: string) {
  if (window.location.hash === hash) return;
  window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  window.dispatchEvent(new Event(HASH_EVENT));
}
