import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeMenu } from "../ThemeMenu";
import { resetModeStateForTests } from "@/lib/mode";
import { PALETTE_KEY, resetPaletteStateForTests } from "@/lib/palette";

const root = document.documentElement;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ThemeMenu open={open} onOpenChange={setOpen} />
      <button type="button">Elsewhere</button>
    </>
  );
}

beforeEach(() => {
  resetPaletteStateForTests();
  resetModeStateForTests();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.localStorage.clear();
  root.removeAttribute("data-palette");
  root.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.removeAttribute("data-palette");
  root.removeAttribute("data-theme");
});

const button = () => screen.getByRole("button", { name: /^Theme:/ });
const cards = () => within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole("radio");
const card = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });

async function open() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(button());
  return user;
}

describe("ThemeMenu", () => {
  it("is a closed button that names the saved theme", () => {
    render(<Harness />);
    expect(button()).toHaveAccessibleName("Theme: Register");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a dialog with one card per theme, the chosen one checked and focused, and Mode at the bottom", async () => {
    await open();
    expect(button()).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Theme" });
    expect(cards().map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(cards().map((c) => within(c).getByText(/^(Register|High contrast|Parchment|Slate|Forest)$/).textContent)).toEqual([
      "Register",
      "High contrast",
      "Parchment",
      "Slate",
      "Forest",
    ]);
    expect(card("Register")).toHaveFocus();
    expect(card("Register")).toHaveAttribute("tabindex", "0");
    expect(card("Slate")).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByRole("group", { name: "Mode" })).toBeInTheDocument();
    expect(within(dialog).getByText("Source Sans 3 · Source Code Pro")).toBeInTheDocument();
  });

  it("previews a theme on hover without saving it, and puts the saved one back when the pointer leaves", async () => {
    const user = await open();
    await user.hover(card("Slate"));
    expect(root).toHaveAttribute("data-palette", "slate");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBeNull();
    expect(card("Register")).toHaveAttribute("aria-checked", "true");

    await user.hover(card("Forest"));
    expect(root).toHaveAttribute("data-palette", "forest");

    await user.unhover(card("Forest"));
    // The focused card (the saved one) is shown again.
    expect(root).not.toHaveAttribute("data-palette");
  });

  it("previews a theme on focus", async () => {
    const user = await open();
    await user.keyboard("{ArrowDown}");
    expect(card("High contrast")).toHaveFocus();
    expect(root).toHaveAttribute("data-palette", "contrast");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBeNull();
  });

  it("keeps a theme on click: applies, stores and checks it, and the panel stays open", async () => {
    const user = await open();
    await user.click(card("Parchment"));
    expect(root).toHaveAttribute("data-palette", "parchment");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("parchment");
    expect(card("Parchment")).toHaveAttribute("aria-checked", "true");
    expect(card("Register")).toHaveAttribute("aria-checked", "false");
    expect(button()).toHaveAccessibleName("Theme: Parchment");
    expect(screen.getByRole("status")).toHaveTextContent("Parchment theme applied");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("restores the saved theme on Escape after previewing another", async () => {
    const user = await open();
    await user.click(card("Slate"));
    await user.hover(card("Forest"));
    expect(root).toHaveAttribute("data-palette", "forest");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(root).toHaveAttribute("data-palette", "slate");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("slate");
  });

  it("closes on Escape, reverts the preview and returns focus to the button", async () => {
    const user = await open();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(root).toHaveAttribute("data-palette", "parchment");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute("data-palette");
    expect(button()).toHaveFocus();
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("moves between cards with the arrow keys, wrapping, Home and End", async () => {
    const user = await open();
    await user.keyboard("{ArrowUp}");
    expect(card("Forest")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(card("Register")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(card("High contrast")).toHaveFocus();
    await user.keyboard("{End}");
    expect(card("Forest")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(card("Register")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(card("Forest")).toHaveFocus();
  });

  it("chooses the focused card with Enter or Space", async () => {
    const user = await open();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("slate");
    await user.keyboard("{ArrowDown} ");
    expect(window.localStorage.getItem(PALETTE_KEY)).toBe("forest");
  });

  it("closes on a click outside, reverting a preview", async () => {
    const user = await open();
    await user.hover(card("Forest"));
    expect(root).toHaveAttribute("data-palette", "forest");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(root).not.toHaveAttribute("data-palette");
  });

  it("toggles closed from its button", async () => {
    const user = await open();
    await user.click(button());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has the Mode switch inside: choosing Dark sets the mode and the cards stay", async () => {
    const user = await open();
    const mode = within(screen.getByRole("dialog")).getByRole("group", { name: "Mode" });
    await user.click(within(mode).getByRole("button", { name: "Dark" }));
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the swatch of the current mode", async () => {
    window.localStorage.setItem("theme", "dark");
    await open();
    const swatch = card("Slate").querySelector("i") as HTMLElement;
    expect(swatch.style.background).toBe("rgb(15, 18, 25)");
    await act(async () => {
      window.localStorage.setItem("theme", "light");
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "light" }));
    });
    expect((card("Slate").querySelector("i") as HTMLElement).style.background).toBe("rgb(241, 243, 246)");
  });

  it("follows a change made in another tab", async () => {
    await open();
    await act(async () => {
      window.localStorage.setItem(PALETTE_KEY, "forest");
      window.dispatchEvent(new StorageEvent("storage", { key: PALETTE_KEY, newValue: "forest" }));
    });
    expect(card("Forest")).toHaveAttribute("aria-checked", "true");
    expect(button()).toHaveAccessibleName("Theme: Forest");
  });

  it("shows a stored theme", () => {
    window.localStorage.setItem(PALETTE_KEY, "contrast");
    render(<Harness />);
    expect(button()).toHaveAccessibleName("Theme: High contrast");
  });
});
