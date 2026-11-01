import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitch } from "../ThemeSwitch";
import { THEME_INIT_SCRIPT, THEME_KEY } from "@/lib/theme";

const root = document.documentElement;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.localStorage.clear();
  root.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.removeAttribute("data-theme");
});

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("ThemeSwitch", () => {
  it("starts on System when nothing is stored", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(pressed("System")).toBe("true");
    expect(pressed("Light")).toBe("false");
    expect(pressed("Dark")).toBe("false");
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("applies and stores Dark, then Light, then clears on System", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(pressed("Dark")).toBe("true");
    expect(pressed("System")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(root).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    expect(pressed("Light")).toBe("true");

    await user.click(screen.getByRole("button", { name: "System" }));
    expect(root).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(pressed("System")).toBe("true");
  });

  it("shows a stored choice", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeSwitch />);
    expect(pressed("Dark")).toBe("true");
    expect(pressed("System")).toBe("false");
  });

  it("treats an unknown stored value as System", () => {
    window.localStorage.setItem(THEME_KEY, "purple");
    render(<ThemeSwitch />);
    expect(pressed("System")).toBe("true");
  });

  it("still applies the choice when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    expect(pressed("System")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("follows a change made in another tab", () => {
    render(<ThemeSwitch />);
    window.localStorage.setItem(THEME_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "light" }));
    });
    expect(pressed("Light")).toBe("true");
    expect(root).toHaveAttribute("data-theme", "light");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  const run = () => new Function(THEME_INIT_SCRIPT)();

  it("sets data-theme from a stored light or dark choice", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    run();
    expect(root).toHaveAttribute("data-theme", "dark");
    window.localStorage.setItem(THEME_KEY, "light");
    run();
    expect(root).toHaveAttribute("data-theme", "light");
  });

  it("leaves the attribute off for nothing or junk stored", () => {
    run();
    expect(root).not.toHaveAttribute("data-theme");
    window.localStorage.setItem(THEME_KEY, "junk");
    run();
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(root).not.toHaveAttribute("data-theme");
  });
});
