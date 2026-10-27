"use client";

import { useEffect, useState } from "react";

/**
 * Reads something from the server for a tab (the Risks, the Deployment Facets, the declared Business Units): `data` is null until the
 * first response, `failed` says the last read failed (the data from an earlier one stays), `reload` reads again, and `setData` replaces
 * the data with what a write answered. `read` must be stable (wrap it in `useCallback`): it is read again when it changes. State is
 * only set when a response arrives, never synchronously in the effect.
 */
export function useRemote<T>(read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    read().then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [read, version]);

  return { data, failed, reload: () => setVersion((current) => current + 1), setData };
}
