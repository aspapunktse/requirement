import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonPage } from "../ComparisonPage";
import type { ComparisonDetail } from "../comparison-types";
import { candidate, control, detail } from "./fixtures";

vi.setConfig({ testTimeout: 30_000 });
// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
const registration = vi.hoisted(() => ({ current: null as null | { items: { label: string; href: string }[] } }));
vi.mock("@/components/PaletteProvider", () => ({
  usePagePalette: (value: NonNullable<typeof registration.current>) => {
    registration.current = value;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
function stubFetch(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const serve = (comparison: ComparisonDetail) => stubFetch((url) => (url === "/api/comparisons/cmp-1" ? { body: { comparison } } : { status: 404, body: {} }));
const open = (role = "SYSTEM_OWNER", userId = "u-owner") => render(<ComparisonPage id="cmp-1" userId={userId} role={role} />);

/**
 * Three Candidates over six first-round Controls in two Frameworks.
 *   Alpha (complete, 75%)       Beta (complete, 50%)        Gamma (incomplete: 2 of 3 answered, 100% of what counts)
 * Controls: A.1 mandatory, A.2, A.3 under "ISO 27001"; B.1 mandatory, B.2 under "NIS2"; Gamma does not get B.2.
 */
function trio() {
  const alpha = candidate("Alpha", {
    controls: [control("A.1", "FULFILLED", true), control("A.2", "FULFILLED"), control("A.3", "FULFILLED"), control("B.1", "IN_PROGRESS", true), control("B.2", "FULFILLED")],
  });
  const beta = candidate("Beta", {
    controls: [control("A.1", "FULFILLED", true), control("A.2", "WAIVED"), control("A.3", "FULFILLED"), control("B.1", "FULFILLED", true), control("B.2", "IN_PROGRESS")],
    owner: { id: "u-pat", name: "Pat Peer" },
  });
  const gamma = candidate("Gamma", {
    controls: [control("A.1", "FULFILLED", true), control("A.2", "NOT_STARTED"), control("A.3", "NOT_APPLICABLE"), control("B.1", "FULFILLED", true)],
    canOpen: false,
    owner: { id: "u-gus", name: "Gus Guest" },
  });
  return detail([gamma, beta, alpha], {
    controlGroups: [
      { framework: { id: "fw-1", name: "ISO 27001" }, controls: [control("A.1", "FULFILLED", true), control("A.2", "FULFILLED"), control("A.3", "FULFILLED")].map((c) => ({ controlId: c.controlId, code: c.code, title: c.title, mandatory: c.mandatory })) },
      { framework: { id: "fw-2", name: "NIS2" }, controls: [control("B.1", "FULFILLED", true), control("B.2", "FULFILLED")].map((c) => ({ controlId: c.controlId, code: c.code, title: c.title, mandatory: c.mandatory })) },
    ],
  });
}

const rowsOf = () => screen.getAllByRole("listitem").filter((item) => item.classList.contains("cmp-row"));
const table = () => screen.getByRole("table");

describe("ComparisonPage: loading and failing", () => {
  it("says it is loading, then shows the Comparison", async () => {
    serve(trio());
    open();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the Comparison");
    expect(await screen.findByRole("heading", { level: 1, name: "New HR system 2027" })).toBeInTheDocument();
    expect(screen.getByText("A system for HR")).toBeInTheDocument();
  });

  it("shows an error with a way to try again when the read fails, and recovers", async () => {
    let fail = true;
    stubFetch(() => (fail ? { status: 500, body: {} } : { body: { comparison: trio() } }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "New HR system 2027" })).toBeInTheDocument();
  });

  it("says the Comparison is not found for a 404", async () => {
    stubFetch(() => ({ status: 404, body: { error: "Comparison not found" } }));
    open();
    expect(await screen.findByRole("heading", { name: "Comparison not found" })).toBeInTheDocument();
  });
});

describe("ComparisonPage: the shortlist", () => {
  it("lists complete Candidates first by score, then incomplete ones, whatever order the response had", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    const names = rowsOf().map((row) => within(row).getAllByText(/^(Alpha|Beta|Gamma)$/)[0].textContent);
    expect(names).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(within(rowsOf()[0]).getByText("1")).toBeInTheDocument();
  });

  it("puts a complete Candidate with a lower score before an incomplete one with a higher score", async () => {
    const low = candidate("Low", { controls: [control("A.1", "FULFILLED"), control("A.2", "WAIVED")] });
    const high = candidate("High", { controls: [control("A.1", "FULFILLED"), control("A.2", "NOT_STARTED")] });
    serve(detail([high, low]));
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(rowsOf().map((row) => within(row).getAllByText(/^(Low|High)$/)[0].textContent)).toEqual(["Low", "High"]);
  });

  it("shows the score and counts, the incomplete marker, and mandatory Controls not fulfilled", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    const [alpha, beta, gamma] = rowsOf();
    expect(within(alpha).getAllByLabelText("Comparison Score 80%")[0]).toBeInTheDocument();
    expect(within(alpha).getByText("4 of 5 fulfilled")).toBeInTheDocument();
    expect(within(alpha).getByText("1 mandatory not fulfilled")).toBeInTheDocument();
    expect(within(alpha).queryByText(/incomplete/)).not.toBeInTheDocument();
    expect(within(beta).getAllByLabelText("Comparison Score 60%")[0]).toBeInTheDocument();
    expect(within(gamma).getByText("incomplete: 3 of 4 answered")).toBeInTheDocument();
    expect(within(gamma).getByText("0 mandatory not fulfilled")).toBeInTheDocument();
  });

  it("shows owner, stage, classification and Open Risks by severity", async () => {
    const withRisks = candidate("Risky", {
      controls: [control("A.1", "FULFILLED")],
      stage: "OG1",
      openRisks: { LOW: 0, MEDIUM: 2, HIGH: 1, CRITICAL: 3 },
      classification: { deploymentFacets: [{ id: "f1", name: "On-premises" }], sensitivityLevel: 3, integrityImpactLevel: "HIGH", availabilityImpactLevel: null, frameworkScope: [{ id: "fw-1", name: "ISO 27001" }, { id: "fw-2", name: "NIS2" }] },
    });
    serve(detail([withRisks, candidate("Calm", { controls: [control("A.1", "FULFILLED")] })]));
    open();
    await screen.findByRole("heading", { level: 1 });
    const row = rowsOf().find((item) => within(item).queryByText("Risky"))!;
    expect(within(row).getByText(/owner Olive Owner · OG1/)).toBeInTheDocument();
    expect(within(row).getByText("On-premises")).toBeInTheDocument();
    expect(within(row).getByLabelText("Sensitivity Level: Level 3")).toBeInTheDocument();
    expect(within(row).getByText("Integrity High")).toBeInTheDocument();
    expect(within(row).getByText("Availability not set")).toBeInTheDocument();
    expect(within(row).getByText("Frameworks: ISO 27001, NIS2")).toBeInTheDocument();
    const risks = within(row).getByLabelText("Open Risks");
    expect(risks).toHaveTextContent("3 Critical");
    expect(risks).toHaveTextContent("1 High");
    expect(risks).toHaveTextContent("2 Medium");
    expect(risks).not.toHaveTextContent("Low");
    expect(within(rowsOf().find((item) => within(item).queryByText("Calm"))!).getByText("No open Risks")).toBeInTheDocument();
  });

  it("links a Candidate the reader can open to its System page, and shows one they can't as plain text", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    const [alpha, , gamma] = rowsOf();
    expect(within(alpha).getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/systems/sys-Alpha");
    expect(within(gamma).queryByRole("link", { name: "Gamma" })).not.toBeInTheDocument();
    expect(within(gamma).getByText("Gamma")).toBeInTheDocument();
    expect(within(gamma).getByText("Limited summary")).toBeInTheDocument();
    // The palette lists only what can be opened.
    expect(registration.current!.items.map((item) => item.label)).toEqual(["All Comparisons", "Alpha", "Beta"]);
  });

  it("shows a dash and the reason for a Candidate with no first-round Controls", async () => {
    serve(detail([candidate("Bare", { controls: [] }), candidate("Other", { controls: [control("A.1", "FULFILLED")] })]));
    open();
    await screen.findByRole("heading", { level: 1 });
    const row = rowsOf().find((item) => within(item).queryByText("Bare"))!;
    expect(within(row).getAllByLabelText("Comparison Score —")[0]).toBeInTheDocument();
    expect(within(row).getByText(/nothing is marked first round for its Frameworks/)).toBeInTheDocument();
    expect(within(row).queryByText(/incomplete/)).not.toBeInTheDocument();
  });

  it("says so when no Candidate is in the Comparison yet", async () => {
    serve(detail([]));
    open();
    expect(await screen.findByRole("heading", { name: "No Candidates yet" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ComparisonPage: the classification notice", () => {
  it("names what differs, and is absent when nothing does", async () => {
    serve({ ...trio(), classificationDifferences: ["deploymentFacets", "integrityImpactLevel"] });
    open();
    const notice = await screen.findByRole("note");
    expect(notice).toHaveTextContent("differ in classification");
    expect(notice).toHaveTextContent("Deployment Facets, Integrity Impact Level");
    cleanup();
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("ComparisonPage: the Control-by-Control table", () => {
  const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

  it("starts with only the Controls where the Candidates differ, with counts on the three options", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(tab("Where they differ")).toHaveAttribute("aria-selected", "true");
    // A.1 is Fulfilled for all three, so it is the same everywhere. A.2, A.3 (Gamma: Not Applicable), B.1, B.2 differ.
    expect(tab("Where they differ")).toHaveTextContent("4");
    expect(tab("Mandatory")).toHaveTextContent("2");
    expect(tab("All")).toHaveTextContent("5");
    const shown = within(table()).getAllByRole("rowheader").map((header) => header.textContent);
    expect(shown.some((text) => text?.includes("A.1"))).toBe(false);
    for (const code of ["A.2", "A.3", "B.1", "B.2"]) expect(shown.some((text) => text?.includes(code))).toBe(true);
  });

  it("shows only the mandatory first-round Controls on the Mandatory option, and every Control on All", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(tab("Mandatory"));
    expect(tab("Mandatory")).toHaveAttribute("aria-selected", "true");
    const mandatory = within(table()).getAllByRole("rowheader").map((header) => header.textContent ?? "");
    expect(mandatory.filter((text) => !text.includes("Framework"))).toHaveLength(mandatory.length);
    expect(mandatory.some((text) => text.includes("A.1"))).toBe(true);
    expect(mandatory.some((text) => text.includes("B.1"))).toBe(true);
    expect(mandatory.some((text) => text.includes("A.2"))).toBe(false);
    expect(within(table()).getAllByText("Mandatory")).toHaveLength(2);
    await userEvent.click(tab("All"));
    expect(within(table()).getAllByRole("row")).toHaveLength(1 + 2 + 5);
  });

  it("groups the rows under a separator per Framework with its count of Controls", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(tab("All"));
    const separators = within(table()).getAllByRole("columnheader", { name: /Controls?$/ }).filter((cell) => cell.getAttribute("scope") === "colgroup");
    expect(separators.map((cell) => cell.textContent)).toEqual(["ISO 27001" + "3 Controls", "NIS2" + "2 Controls"]);
    // Narrowed to the differing Controls, a separator counts what it still holds.
    await userEvent.click(tab("Where they differ"));
    const narrowed = within(table()).getAllByRole("columnheader").filter((cell) => cell.getAttribute("scope") === "colgroup");
    expect(narrowed.map((cell) => cell.textContent)).toEqual(["ISO 27001" + "2 Controls", "NIS2" + "2 Controls"]);
    // The first row after the first separator is that Framework's first Control.
    const rows = within(table()).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("ISO 27001");
    expect(rows[2]).toHaveTextContent("A.2");
  });

  it("drops a Framework's separator when the filter leaves it nothing", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(tab("Mandatory"));
    expect(within(table()).getAllByRole("columnheader").filter((cell) => cell.getAttribute("scope") === "colgroup")).toHaveLength(2);
    // Make NIS2's Controls identical and optional, so only ISO 27001 holds a difference.
    cleanup();
    const same = trio();
    same.candidates = same.candidates.map((entry) => ({ ...entry, score: { ...entry.score, controls: [...entry.score.controls.filter((c) => !c.code.startsWith("B")), ...["B.1", "B.2"].map((code) => control(code, "FULFILLED"))] } }));
    same.controlGroups[1].controls = same.controlGroups[1].controls.map((c) => ({ ...c, mandatory: false }));
    serve(same);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(within(table()).getAllByRole("columnheader").filter((cell) => cell.getAttribute("scope") === "colgroup").map((cell) => cell.textContent)).toEqual(["ISO 27001" + "2 Controls"]);
  });

  it("shows each Candidate's effective status in its column, in the Candidates' order", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(tab("All"));
    const headers = within(table()).getAllByRole("columnheader").filter((cell) => cell.getAttribute("scope") === "col");
    expect(headers.map((cell) => cell.textContent)).toEqual(["Control", "Alpha", "Beta", "Gamma"]);
    const a2 = within(table()).getByRole("rowheader", { name: /A\.2/ }).closest("tr")!;
    expect(within(a2).getAllByRole("cell").map((cell) => cell.textContent?.replace(/^\S\s?/, "").trim())).toEqual(["Fulfilled", "Waived", "Not Started"]);
  });

  it("reads Does not apply where a Candidate has no row for a Control, apart from a Control that is Not Applicable", async () => {
    serve(trio());
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(tab("All"));
    const b2 = within(table()).getByRole("rowheader", { name: /B\.2/ }).closest("tr")!;
    const cells = within(b2).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("Does not apply");
    const a3 = within(table()).getByRole("rowheader", { name: /A\.3/ }).closest("tr")!;
    expect(within(a3).getAllByRole("cell")[2]).toHaveTextContent("Not Applicable");
    expect(within(a3).getAllByRole("cell")[2]).not.toHaveTextContent("Does not apply");
  });

  it("starts on All when there is only one Candidate, since nothing can differ", async () => {
    const only = detail([candidate("Solo", { controls: [control("A.1", "FULFILLED")] })], { controlGroups: [{ framework: { id: "fw-1", name: "ISO 27001" }, controls: [{ controlId: "id-A.1", code: "A.1", title: "Title of A.1", mandatory: false }] }] });
    serve(only);
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(tab("All")).toHaveAttribute("aria-selected", "true");
    expect(within(table()).getByRole("rowheader", { name: /A\.1/ })).toBeInTheDocument();
  });

  it("says when every Candidate has the same status everywhere, and when there are no first-round Controls at all", async () => {
    const same = detail([candidate("One", { controls: [control("A.1", "FULFILLED")] }), candidate("Two", { controls: [control("A.1", "FULFILLED")] })], {
      controlGroups: [{ framework: { id: "fw-1", name: "ISO 27001" }, controls: [{ controlId: "id-A.1", code: "A.1", title: "Title of A.1", mandatory: false }] }],
    });
    serve(same);
    open();
    expect(await screen.findByText(/same status on every first-round Control/)).toBeInTheDocument();
    cleanup();
    serve(detail([candidate("One"), candidate("Two")]));
    open();
    expect(await screen.findByText(/No first-round Controls to compare/)).toBeInTheDocument();
  });
});

describe("ComparisonPage: the layout guard", () => {
  it("is not inside the Systems register's .sy wrapper, whose phone rules would break the table, and separators span every column", async () => {
    serve(trio());
    const { container } = open();
    await screen.findByRole("heading", { level: 1 });
    // systems.css turns every tbody row into a block and hides thead at <=720px for anything under `.sy`; jsdom can't run the media query, so guard the structure.
    expect(container.querySelector(".sy")).toBeNull();
    expect(container.closest(".sy")).toBeNull();
    expect(table().closest(".cmp-mx-wrap")).not.toBeNull();
    expect(table().querySelector("thead")).not.toBeNull();
    const columns = table().querySelectorAll("thead th").length;
    for (const th of table().querySelectorAll("tr.grp th")) expect(th).toHaveAttribute("colspan", String(columns));
  });
});

describe("ComparisonPage: who can do what", () => {
  it("offers no write controls to a reader who may not manage and owns no Candidate", async () => {
    serve(trio());
    open("VIEWER", "u-viewer");
    await screen.findByRole("heading", { level: 1 });
    for (const name of [/Edit name and need/, /Participants/, /Change owner/, /^Delete$/, /Remove/]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("lets the System's owner remove their own Candidate and no other", async () => {
    serve(trio());
    open("SYSTEM_OWNER", "u-pat");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("button", { name: /Remove .* from the Comparison/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove Beta from the Comparison" })).toBeInTheDocument();
  });

  it("removes a Candidate after a confirmation, then reads the Comparison again", async () => {
    const calls: string[] = [];
    let removed = false;
    const full = { ...trio(), canManage: true };
    stubFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE") {
        removed = true;
        return { body: { removed: true } };
      }
      return { body: { comparison: removed ? { ...full, candidates: full.candidates.filter((c) => c.name !== "Gamma") } : full } };
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Remove Gamma from the Comparison" }));
    expect(calls.filter((call) => call.startsWith("DELETE"))).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Confirm removing Gamma" }));
    await waitFor(() => expect(rowsOf()).toHaveLength(2));
    expect(calls).toContain("DELETE /api/comparisons/cmp-1/candidates/sys-Gamma");
  });

  it("shows the refusal when a removal is refused", async () => {
    stubFetch((_url, init) => (init?.method === "DELETE" ? { status: 403, body: { error: "Only the owner can" } } : { body: { comparison: { ...trio(), canManage: true } } }));
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Remove Gamma from the Comparison" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm removing Gamma" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can");
    expect(rowsOf()).toHaveLength(3);
  });

  it("gives the owner the header edits, and an Admin Change owner too", async () => {
    serve({ ...trio(), canManage: true });
    open("SYSTEM_OWNER");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Edit name and need" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Participants" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change owner" })).not.toBeInTheDocument();
    cleanup();
    serve({ ...trio(), canManage: true });
    open("ADMIN");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Change owner" })).toBeInTheDocument();
  });

  it("renames through PATCH and reads again", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      return init?.method === "PATCH" ? { body: { comparison: { id: "cmp-1" } } } : { body: { comparison: { ...trio(), canManage: true } } };
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Edit name and need" }));
    const dialog = screen.getByRole("dialog", { name: "Edit name and need" });
    const name = within(dialog).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const patch = calls.find((call) => call.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/comparisons/cmp-1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ name: "Renamed", need: "A system for HR" });
    expect(calls.filter((call) => !call.init?.method).length).toBeGreaterThanOrEqual(2);
  });

  it("deletes after a confirmation and goes back to the list", async () => {
    stubFetch((_url, init) => (init?.method === "DELETE" ? { body: { deleted: true } } : { body: { comparison: { ...trio(), canManage: true } } }));
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Comparison" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/comparisons"));
  });

  it("names a participant from the people the server offers, without listing the owner or those already named", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const people = [
      { id: "u-owner", name: "Olive Owner", email: "o@x", role: "SYSTEM_OWNER" },
      { id: "u-pat", name: "Pat Peer", email: "p@x", role: "SYSTEM_OWNER" },
      { id: "u-ann", name: "Ann Added", email: "a@x", role: "RISK_OWNER" },
    ];
    stubFetch((url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/people")) return { body: { users: people } };
      if (init?.method === "POST") return { status: 201, body: {} };
      return { body: { comparison: { ...trio(), canManage: true, participants: [{ id: "u-pat", name: "Pat Peer" }] } } };
    });
    open();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Participants" }));
    const dialog = screen.getByRole("dialog", { name: "Participants" });
    const select = await within(dialog).findByLabelText("Add a participant");
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Pick a user", "Ann Added (a@x)"]);
    await userEvent.selectOptions(select, "u-ann");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
    const post = calls.find((call) => call.init?.method === "POST")!;
    expect(post.url).toBe("/api/comparisons/cmp-1/participants");
    expect(JSON.parse(String(post.init!.body))).toEqual({ userId: "u-ann" });
  });

  it("shows a closed Comparison read-only: the state, no write controls", async () => {
    serve({ ...trio(), canManage: true, closed: true });
    open("ADMIN");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Closed")).toBeInTheDocument();
    for (const name of [/Edit name and need/, /Participants/, /Change owner/, /^Delete$/, /Remove/]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});
