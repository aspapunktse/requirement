import { useEffect, useRef } from "react";

const EVENT = "appheader:popover-open";

/**
 * One popover open at a time in the app header (#256): while `open`, announces itself, and closes when another
 * popover (the Admin menu, the narrow-screen menu, the role switcher) announces itself.
 */
export function useExclusivePopover(id: string, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    function onOther(event: Event) {
      if ((event as CustomEvent<string>).detail !== id) closeRef.current();
    }
    window.addEventListener(EVENT, onOther);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
    return () => window.removeEventListener(EVENT, onOther);
  }, [id, open]);
}
