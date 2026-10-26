import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeHash } from "../system-hash";
import { controlHash } from "../system-page-logic";
import { assessment, control, json, openQuery, organization, provider, renderControls, rowOf, stubApi } from "./controls-test-utils";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.setConfig({ testTimeout: 20_000 });

// Seven Controls in three categories, covering every status and source.
const A51 = control("A.5.1", { title: "Policies for information security", mandatory: true });
const A52 = control("A.5.2", { title: "Roles and responsibilities", mandatory: true });
const A53 = control("A.5.3", { title: "Segregation of duties" });
const A81 = control("A.8.1", { title: "User endpoint devices", category: "A.8 Technological" });
const A82 = control("A.8.2", { title: "Privileged access rights", category: "A.8 Technological", mandatory: true });
const A824 = control("A.8.24", { title: "Use of cryptography", category: "A.8 Technological", mandatory: true });
const P61 = control("6.1", { title: "Actions to address risks", category: "6 Planning", mandatory: true });

const ROWS = [
  rowOf(A51, assessment("IN_PROGRESS", { queries: [openQuery("q1"), openQuery("q2", "Resolved one", { resolved: true })] })),
  rowOf(A52, null),
  rowOf(A53, null),
  rowOf(A81, assessment("FULFILLED")),
  rowOf(A82, null, [organization("FULFILLED")]),
  rowOf(A824, null, [provider()]),
  rowOf(P61, assessment("WAIVED")),
];

const rowButton = (code: string) => {
  const element = [...document.querySelectorAll<HTMLElement>("[data-control-code]")].find((candidate) => candidate.dataset.controlCode === code);
  if (!element) throw new Error(`No row for ${code}`);
  return element;
};
const shownCodes = () => [...document.querySelectorAll<HTMLElement>(".sc-crow")].map((element) => element.dataset.controlCode);
const segment = (name: string) => screen.getByRole("button", { name });
const count = () => screen.getByText(/ Controls$/).textContent;

beforeEach(() => {
  window.history.replaceState(null, "", "/systems/s1#controls");
  stubApi(ROWS);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("Controls tab: loading and empty states (#244)", () => {
  it("says it is loading, then lists the Controls", async () => {
    renderControls();
    expect(screen.getByText("Loading Controls…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /A\.5\.1/ })).toBeInTheDocument();
    expect(screen.queryByText("Loading Controls…")).not.toBeInTheDocument();
  });

  it("says so when the Controls can't be loaded, and loads them again on request", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => (fail ? json({ error: "boom" }, 500) : json({ assessments: ROWS, staleAssessments: [] }))),
    );
    renderControls();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load the Controls");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /A\.5\.1/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when no Control applies", async () => {
    stubApi([]);
    renderControls();
    expect(await screen.findByText("No Controls apply to this System.")).toBeInTheDocument();
    expect(count()).toBe("0 of 0 Controls");
  });
});

describe("Controls tab: groups and rows (#244)", () => {
  it("groups the Controls by category with done/total and a status bar, in the order they come", async () => {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    const headers = screen.getAllByRole("button", { expanded: true });
    expect(headers.map((header) => header.textContent)).toEqual(["▸A.5 Organizational0/3", "▸A.8 Technological3/3", "▸6 Planning1/1"]);
    const stack = within(screen.getByRole("region", { name: "A.5 Organizational" })).getByRole("img");
    expect(stack).toHaveAccessibleName("A.5 Organizational: 0 Fulfilled, 0 Waived, 1 In progress, 2 Not started, 0 Not applicable");
    expect(count()).toBe("7 of 7 Controls");
  });

  it("shows code, title, the source, the status and, where they apply, the MANDATORY flag and the open-query badge", async () => {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });

    // A.5.1: mandatory, but In progress, so no flag; one open question (the resolved one doesn't count).
    const first = within(rowButton("A.5.1"));
    expect(first.getByText("Policies for information security")).toBeInTheDocument();
    expect(first.getByText("This System")).toBeInTheDocument();
    expect(first.getByText("In progress")).toBeInTheDocument();
    expect(first.getByText("1 open question")).toBeInTheDocument();
    expect(first.queryByText("Mandatory")).not.toBeInTheDocument();

    // A.5.2: mandatory, assessed by this System itself and Not started: flagged.
    const second = within(rowButton("A.5.2"));
    expect(second.getByText("Mandatory")).toBeInTheDocument();
    expect(second.getByText("Not started")).toBeInTheDocument();
    expect(second.queryByText(/open question/)).not.toBeInTheDocument();

    // A.5.3 is not mandatory.
    expect(within(rowButton("A.5.3")).queryByText("Mandatory")).not.toBeInTheDocument();

    // Inherited: the source is the Organization, or the Provider by name; a mandatory one inherited as Fulfilled has no flag.
    const org = within(rowButton("A.8.2"));
    expect(org.getByText("Organization")).toBeInTheDocument();
    expect(org.getByText("Fulfilled")).toBeInTheDocument();
    expect(org.queryByText("Mandatory")).not.toBeInTheDocument();
    expect(within(rowButton("A.8.24")).getByText("Landing Zone")).toBeInTheDocument();
    expect(within(rowButton("6.1")).getByText("Waived")).toBeInTheDocument();
  });

  it("flags a mandatory Control whose inherited source gives no credit, since this System assesses it itself", async () => {
    // An Organization that has not Fulfilled it, and a Provider that is not Onboarded, give no credit.
    stubApi([rowOf(A82, null, [organization("NOT_STARTED")]), rowOf(A824, null, [provider({ providerOnboarded: false })])]);
    renderControls();
    await screen.findByText("Privileged access rights");
    expect(within(rowButton("A.8.2")).getByText("Mandatory")).toBeInTheDocument();
    expect(within(rowButton("A.8.24")).getByText("Mandatory")).toBeInTheDocument();
  });

  it("collapses and expands a group, which keeps its done/total", async () => {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    const header = screen.getByRole("button", { name: /A\.8 Technological/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(shownCodes()).toEqual(["A.5.1", "A.5.2", "A.5.3", "6.1"]);
    expect(header).toHaveTextContent("3/3");
    // A collapsed group still counts in "n of m Controls".
    expect(count()).toBe("7 of 7 Controls");
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(shownCodes()).toHaveLength(7);
  });
});

describe("Controls tab: search and filter (#244)", () => {
  async function ready() {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
  }

  it.each([
    ["To do", ["A.5.2", "A.5.3"]],
    ["In progress", ["A.5.1"]],
    ["Done", ["A.8.1", "A.8.2", "A.8.24", "6.1"]],
    ["Inherited", ["A.8.2", "A.8.24"]],
    ["All", ["A.5.1", "A.5.2", "A.5.3", "A.8.1", "A.8.2", "A.8.24", "6.1"]],
  ])("the %s segment shows %j", async (name, codes) => {
    await ready();
    await userEvent.click(segment(name));
    expect(segment(name)).toHaveAttribute("aria-pressed", "true");
    expect(shownCodes()).toEqual(codes);
    expect(count()).toBe(`${codes.length} of 7 Controls`);
  });

  it("hides a group with no matches", async () => {
    await ready();
    await userEvent.click(segment("Inherited"));
    expect(screen.queryByRole("region", { name: "A.5 Organizational" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "6 Planning" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "A.8 Technological" })).toBeInTheDocument();
    // The group header still counts the whole group, not only the matches.
    expect(screen.getByRole("button", { name: /A\.8 Technological/ })).toHaveTextContent("3/3");
  });

  it("searches the code and the title, ignoring case", async () => {
    await ready();
    const search = screen.getByRole("searchbox", { name: "Search Controls" });
    await userEvent.type(search, "CRYPTO");
    expect(shownCodes()).toEqual(["A.8.24"]);
    await userEvent.clear(search);
    await userEvent.type(search, "a.5.");
    expect(shownCodes()).toEqual(["A.5.1", "A.5.2", "A.5.3"]);
    expect(count()).toBe("3 of 7 Controls");
  });

  it("combines the search with the segment", async () => {
    await ready();
    await userEvent.click(segment("Done"));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Controls" }), "access");
    expect(shownCodes()).toEqual(["A.8.2"]);
  });

  it("says 'No Controls match' with a Clear filters that restores the list", async () => {
    await ready();
    await userEvent.click(segment("To do"));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Controls" }), "cryptography");
    expect(screen.getByText("No Controls match.")).toBeInTheDocument();
    expect(count()).toBe("0 of 7 Controls");
    expect(shownCodes()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search Controls" })).toHaveValue("");
    expect(segment("All")).toHaveAttribute("aria-pressed", "true");
    expect(shownCodes()).toHaveLength(7);
  });

  it("'/' switches to the Controls tab and focuses the search, unless the user is typing", async () => {
    window.history.replaceState(null, "", "/systems/s1");
    await ready();
    const search = screen.getByRole("searchbox", { name: "Search Controls" });
    await userEvent.keyboard("/");
    await waitFor(() => expect(search).toHaveFocus());
    expect(window.location.hash).toBe("#controls");
    // Typing a slash into the search is just a character.
    await userEvent.keyboard("/");
    expect(search).toHaveValue("/");
  });
});

describe("Controls tab: the stale Assessments (#109)", () => {
  it("lists them apart, not subject to the filters, and opens their drawer", async () => {
    const stale = { ...assessment("FULFILLED", { evidence: "Old evidence" }), control: control("STALE-1", { title: "Stale Control" }), queries: [] };
    stubApi(ROWS, { stale: [stale] });
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    const group = screen.getByRole("region", { name: "No longer applicable" });
    expect(within(group).getByRole("button", { name: /STALE-1/ })).toBeInTheDocument();
    // Not part of "n of m Controls".
    expect(count()).toBe("7 of 7 Controls");
    await userEvent.click(segment("To do"));
    expect(screen.getByRole("region", { name: "No longer applicable" })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /STALE-1/ }));
    expect(window.location.hash).toBe("#controls/STALE-1");
    expect(await screen.findByRole("dialog", { name: "Stale Control" })).toBeInTheDocument();
  });
});

describe("Control drawer: opening and closing (#244)", () => {
  async function open(code = "A.5.1") {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    await userEvent.click(rowButton(code));
    return screen.findByRole("dialog");
  }

  it("opens on a click, names the Control, and puts the Control in the URL hash", async () => {
    const dialog = await open();
    expect(dialog).toHaveAccessibleName("Policies for information security");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(window.location.hash).toBe("#controls/A.5.1");
    expect(within(dialog).getByText("A.5.1 · A.5 Organizational")).toBeInTheDocument();
    expect(within(dialog).getByText("Description of A.5.1.")).toBeInTheDocument();
    expect(within(dialog).getByText("Mandatory")).toBeInTheDocument();
  });

  it("opens on Enter from the keyboard", async () => {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    rowButton("A.5.2").focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Roles and responsibilities" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#controls/A.5.2");
  });

  it("opens straight from a hash that names a Control, once the Controls are loaded", async () => {
    window.history.replaceState(null, "", "/systems/s1#controls/A.8.24");
    renderControls();
    expect(await screen.findByRole("dialog", { name: "Use of cryptography" })).toBeInTheDocument();
  });

  it("says so for a hash that names a Control that doesn't apply, and opens no drawer", async () => {
    window.history.replaceState(null, "", "/systems/s1#controls/NOPE-9");
    renderControls();
    expect(await screen.findByText("No Control NOPE-9 applies to this System.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("finds a Control whose code needs encoding", async () => {
    const odd = control("6.1/x y", { title: "Odd code" });
    stubApi([rowOf(odd, null)]);
    window.history.replaceState(null, "", `/systems/s1${controlHash(odd.code)}`);
    renderControls();
    expect(await screen.findByRole("dialog", { name: "Odd code" })).toBeInTheDocument();
  });

  it("moves focus into the drawer, and a close returns it to the row, back at #controls", async () => {
    const dialog = await open("A.5.2");
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#controls");
    expect(rowButton("A.5.2")).toHaveFocus();
  });

  it("closes on Escape and returns focus to the row", async () => {
    await open("A.5.3");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#controls");
    expect(rowButton("A.5.3")).toHaveFocus();
  });

  it("closes on a click on the scrim and returns focus to the row", async () => {
    await open("A.8.1");
    await userEvent.click(screen.getByTestId("control-drawer-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rowButton("A.8.1")).toHaveFocus();
  });

  it("closes on Cancel", async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#controls");
  });

  it("doesn't close on Escape pressed somewhere else, like another dialog's field", async () => {
    await open();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    other.remove();
  });

  it("keeps Tab inside the drawer, wrapping at both ends", async () => {
    const dialog = await open();
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBe(within(dialog).getByRole("button", { name: "Close" }));
    expect(first).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
    await userEvent.tab();
    expect(first).toHaveFocus();
    // Tabbing through everything never leaves the drawer.
    for (let i = 0; i < focusable.length + 2; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("locks the page's scroll while open", async () => {
    await open();
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("follows Back and Forward: Back closes the drawer, Forward opens it again", async () => {
    await open();
    expect(window.location.hash).toBe("#controls/A.5.1");
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => window.history.forward());
    expect(await screen.findByRole("dialog", { name: "Policies for information security" })).toBeInTheDocument();
  });

  it("switches to another Control when the hash changes (a link from the Overview or the palette)", async () => {
    await open("A.5.1");
    act(() => writeHash(controlHash("A.8.24")));
    expect(await screen.findByRole("dialog", { name: "Use of cryptography" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("opens a Control that the filters hide", async () => {
    renderControls();
    await screen.findByRole("button", { name: /A\.5\.1/ });
    await userEvent.click(segment("Inherited"));
    act(() => writeHash(controlHash("A.5.1")));
    expect(await screen.findByRole("dialog", { name: "Policies for information security" })).toBeInTheDocument();
  });
});
