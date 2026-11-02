import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_INIT_SCRIPT,
  PALETTE_KEY,
  getPalette,
  getPaletteSnapshot,
  previewPalette,
  readStoredPalette,
  resetPaletteStateForTests,
  savePalette,
  subscribePalette,
} from "../palette";

const root = document.documentElement;

beforeEach(() => {
  resetPaletteStateForTests();
  window.localStorage.clear();
  root.removeAttribute("data-palette");
});
afterEach(() => {
  vi.restoreAllMocks();
  root.removeAttribute("data-palette");
});

describe("palette list", () => {
  it("lists Register first, then the four other themes, each with both modes' swatches", () => {
    expect(PALETTES.map((palette) => palette.id)).toEqual(["register", "contrast", "parchment", "slate", "forest"]);
    for (const palette of PALETTES) {
      expect(palette.swatch.light).toHaveLength(4);
      expect(palette.swatch.dark).toHaveLength(4);
    }
  });

  it("falls back to Register for an unknown or missing id", () => {
    expect(getPalette("slate").id).toBe("slate");
    expect(getPalette("purple").id).toBe("register");
    expect(getPalette(null).id).toBe("register");
  });
});

describe("storing and applying", () => {
  it("is Register with no attribute when nothing is stored", () => {
    expect(getPaletteSnapshot()).toBe(DEFAULT_PALETTE);
    expect(readStoredPalette()).toBe("register");
    expect(root).not.toHaveAttribute("data-palette");
  });

  it("applies and stores a theme, and clears the entry for Register", () => {
    savePalette("forest");
    expect(root).toHaveAttribute("data-palette", "forest");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("forest");
    expect(getPaletteSnapshot()).toBe("forest");

    savePalette("register");
    expect(root).not.toHaveAttribute("data-palette");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBeNull();
    expect(getPaletteSnapshot()).toBe("register");
  });

  it("treats an unknown stored id as Register, and saving one applies Register", () => {
    window.localStorage.setItem(PALETTE_KEY, "purple");
    expect(readStoredPalette()).toBe("register");
    expect(getPaletteSnapshot()).toBe("register");
    savePalette("purple");
    expect(root).not.toHaveAttribute("data-palette");
    expect(getPaletteSnapshot()).toBe("register");
  });

  it("still applies the theme when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getPaletteSnapshot()).toBe("register");
    expect(() => savePalette("slate")).not.toThrow();
    expect(root).toHaveAttribute("data-palette", "slate");
    expect(getPaletteSnapshot()).toBe("slate");
  });

  it("notifies subscribers when a theme is saved", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePalette(listener);
    savePalette("parchment");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    savePalette("slate");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("follows a change made in another tab, and ignores other keys", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePalette(listener);
    window.localStorage.setItem(PALETTE_KEY, "contrast");
    window.dispatchEvent(new StorageEvent("storage", { key: PALETTE_KEY, newValue: "contrast" }));
    expect(getPaletteSnapshot()).toBe("contrast");
    expect(root).toHaveAttribute("data-palette", "contrast");
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x" }));
    expect(listener).toHaveBeenCalledTimes(1);

    window.localStorage.removeItem(PALETTE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: PALETTE_KEY, newValue: null }));
    expect(getPaletteSnapshot()).toBe("register");
    expect(root).not.toHaveAttribute("data-palette");
    unsubscribe();
  });
});

describe("preview", () => {
  it("applies a theme without saving it, and null puts the saved one back", () => {
    savePalette("slate");
    previewPalette("forest");
    expect(root).toHaveAttribute("data-palette", "forest");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("slate");
    expect(getPaletteSnapshot()).toBe("slate");

    previewPalette(null);
    expect(root).toHaveAttribute("data-palette", "slate");
  });

  it("previews Register by removing the attribute, and reverts to Register when none is saved", () => {
    savePalette("slate");
    previewPalette("register");
    expect(root).not.toHaveAttribute("data-palette");
    previewPalette("forest");
    savePalette("register");
    previewPalette("forest");
    previewPalette(null);
    expect(root).not.toHaveAttribute("data-palette");
  });

  it("does not notify subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePalette(listener);
    previewPalette("forest");
    previewPalette(null);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("PALETTE_INIT_SCRIPT", () => {
  const run = () => new Function(PALETTE_INIT_SCRIPT)();

  it("sets data-palette from a stored theme", () => {
    window.localStorage.setItem(PALETTE_KEY, "parchment");
    run();
    expect(root).toHaveAttribute("data-palette", "parchment");
  });

  it("leaves the attribute off for nothing, Register or junk", () => {
    run();
    expect(root).not.toHaveAttribute("data-palette");
    window.localStorage.setItem(PALETTE_KEY, "register");
    run();
    expect(root).not.toHaveAttribute("data-palette");
    window.localStorage.setItem(PALETTE_KEY, "junk");
    run();
    expect(root).not.toHaveAttribute("data-palette");
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(root).not.toHaveAttribute("data-palette");
  });
});
