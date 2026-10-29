"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import type { PaletteItem } from "@/app/home/JumpPalette";

/**
 * What a page puts in the Ctrl+K palette (#256). The app header owns the one palette and the one hotkey;
 * a page that has items of its own (Home, the Systems list, the System page) registers them here and the
 * header lists them first, then the "Go to" pages. The registration sits in a ref: the header reads it
 * when the palette opens, so a page re-rendering never re-renders the header.
 */
export type PageRegistration = {
  items: PaletteItem[];
  /** Opens a page item in place of navigating to its `href` (the System page switches tab with it). */
  onSelect?: (item: PaletteItem) => void;
  placeholder?: string;
};

const PaletteContext = createContext<RefObject<PageRegistration | null> | null>(null);

/** Wraps the header and the page content in the layout. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const ref = useRef<PageRegistration | null>(null);
  const value = useMemo(() => ref, []);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** The page's registration, for the header to read when it opens the palette. Null outside the provider. */
export function usePageRegistration() {
  return useContext(PaletteContext);
}

/** Registers the page's palette items for as long as the page is mounted. A no-op outside the provider. */
export function usePagePalette(registration: PageRegistration) {
  const ref = useContext(PaletteContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = registration;
    return () => {
      if (ref.current === registration) ref.current = null;
    };
  });
}
