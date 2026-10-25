import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * The shared header for the static design proposals (public/design/shared/appbar.js):
 * role switching and role-carrying links, popovers, and the Ctrl+K palette. The script is
 * plain browser JavaScript, so it is loaded into jsdom and driven through the DOM.
 */

type Item = { group: string; label: string; sub?: string; icon?: string; href?: string; run?: () => void };
type AppbarApi = {
  mount: (o: { current: string; proposal?: { label: string; siblings: [string, string][] }; items?: () => Item[] }) => void;
  roleKey: () => string;
};

const $ = (id: string) => document.getElementById(id)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const key = (k: string, extra: KeyboardEventInit = {}, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
const typeInPalette = (text: string) => {
  const q = $("abPalQ") as HTMLInputElement;
  q.value = text;
  q.dispatchEvent(new Event("input", { bubbles: true }));
};
const options = () => [...document.querySelectorAll('#abPalList [role="option"]')];

let Appbar: AppbarApi;
const ran = vi.fn();
const roleEvents: string[] = [];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  history.replaceState(null, "", "/design/systems/proposal-a.html");
  document.body.innerHTML = '<header id="appbar"></header>';
  const src = readFileSync(path.resolve(__dirname, "../../../public/design/shared/appbar.js"), "utf8");
  new Function(src)();
  Appbar = (window as unknown as { Appbar: AppbarApi }).Appbar;
  addEventListener("appbar:role", (e) => roleEvents.push((e as CustomEvent<{ key: string }>).detail.key));
  Appbar.mount({
    current: "systems",
    proposal: { label: "A", siblings: [["B", "proposal-b.html"]] },
    items: () => [{ group: "Systems", label: "Test Okta", sub: "Approved", run: ran }],
  });
});

describe("design proposal header", () => {
  it("marks the current page, links every proposal with the role and greys out parts without one", () => {
    const current = document.querySelector('.ab-nav [aria-current="page"]')!;
    expect(current.textContent).toBe("Systems");
    const home = document.querySelector<HTMLAnchorElement>('.ab-nav a[href*="/design/home/"]')!;
    expect(home.getAttribute("href")).toMatch(/#role=SYSTEM_OWNER$/);
    const risks = [...document.querySelectorAll(".ab-nav .ab-soon")].find((x) => x.textContent === "Risks");
    expect(risks).toHaveAttribute("aria-disabled", "true");
    expect(document.querySelector('.ab-proto a[href^="proposal-b.html"]')!.getAttribute("href")).toBe("proposal-b.html#role=SYSTEM_OWNER");
  });

  it("switches the acting role, carries it on every link and tells the page", () => {
    click($("abUserBtn"));
    expect($("abUser").hidden).toBe(false);
    click(document.querySelector('[data-role="REVIEWER"]')!);

    expect(location.hash).toBe("#role=REVIEWER");
    expect(Appbar.roleKey()).toBe("REVIEWER");
    expect($("abUserBtn")).toHaveAccessibleName("Acting as Sara Ek, Reviewer");
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".appbar a[data-keep-role], .ab-proto a[href^='proposal']")];
    expect(links.length).toBeGreaterThan(3);
    for (const a of links) expect(a.getAttribute("href")).toMatch(/#role=REVIEWER$/);
    expect(roleEvents).toEqual(["REVIEWER"]);
  });

  it("keeps one popover open at a time and closes it on outside click or Escape", () => {
    click($("abMenuBtn"));
    expect($("abMenu").hidden).toBe(false);
    expect($("abMenuBtn")).toHaveAttribute("aria-expanded", "true");

    click($("abUserBtn"));
    expect($("abMenu").hidden).toBe(true);
    expect($("abUser").hidden).toBe(false);

    click(document.body);
    expect($("abUser").hidden).toBe(true);
    expect($("abUserBtn")).toHaveAttribute("aria-expanded", "false");

    click($("abMenuBtn"));
    key("Escape");
    expect($("abMenu").hidden).toBe(true);
    expect(document.activeElement).toBe($("abMenuBtn"));
  });

  it("opens the palette with Ctrl+K, filters pages and page items, and runs the chosen one", () => {
    click($("abMenuBtn"));
    key("k", { ctrlKey: true });
    expect($("abPal").hidden).toBe(false);
    expect($("abMenu").hidden).toBe(true);
    expect(document.activeElement).toBe($("abPalQ"));
    // The current page is not offered as a place to go.
    expect(options().map((o) => o.textContent)).not.toContain("Systemspage");

    typeInPalette("o");
    const labels = options().map((o) => o.querySelector("span")!.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Test Okta", "Home", "Controls"]));
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    typeInPalette("test okta");
    expect(options()).toHaveLength(1);
    key("Enter", {}, $("abPalQ"));
    expect(ran).toHaveBeenCalledTimes(1);
    expect($("abPal").hidden).toBe(true);
  });

  it("moves the selection with the arrow keys and shows a message when nothing matches", () => {
    click($("abJump"));
    expect($("abPal").hidden).toBe(false);
    key("ArrowDown", {}, $("abPalQ"));
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect($("abPalQ")).toHaveAttribute("aria-activedescendant", "abOpt1");
    key("ArrowUp", {}, $("abPalQ"));
    key("ArrowUp", {}, $("abPalQ"));
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    typeInPalette("zzz no such thing");
    expect(options()).toHaveLength(0);
    expect($("abPalList").textContent).toContain("Nothing matches.");
  });

  it("closes the palette on Escape, on a scrim click and on a second Ctrl+K", () => {
    key("Escape");
    expect($("abPal").hidden).toBe(true);

    click($("abJump"));
    click($("abScrim"));
    expect($("abPal").hidden).toBe(true);

    key("k", { ctrlKey: true });
    key("k", { ctrlKey: true });
    expect($("abPal").hidden).toBe(true);
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
