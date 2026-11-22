import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlPackRow } from "@/lib/control-pack";
import { ControlPacksManager, type PackControl } from "../ControlPacksManager";

const controls: PackControl[] = [
  { id: "c1", code: "SEC-001", title: "Access control", category: "Security" },
  { id: "c2", code: "SEC-002", title: "Backups", category: "Security" },
  { id: "c3", code: "ORG-001", title: "Policy review", category: "Governance" },
];
const packs: ControlPackRow[] = [
  { id: "p1", name: "Test Access", note: "Who gets in", controlIds: ["c1"] },
  { id: "p2", name: "Test Empty", note: "", controlIds: [] },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Calls = [string, RequestInit | undefined][];
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as Calls;
const render_ = (canWrite: boolean) => render(<ControlPacksManager initialPacks={packs} controls={controls} canWrite={canWrite} />);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ControlPacksManager: read-only (#394)", () => {
  it("lists each pack with its note and Control count, and offers no editing", async () => {
    const user = userEvent.setup();
    render_(false);
    expect(screen.getByRole("button", { name: /Test Access/ })).toHaveTextContent("Who gets in");
    expect(screen.getByRole("button", { name: /Test Access/ })).toHaveTextContent("1 Control");
    expect(screen.getByRole("button", { name: /Test Empty/ })).toHaveTextContent("0 Controls");
    expect(screen.queryByRole("button", { name: "New Control Pack" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Test Access/ }));
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute("readonly");
    expect(screen.getByRole("checkbox", { name: /SEC-001/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /SEC-001/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Control Pack" })).not.toBeInTheDocument();
  });
});

describe("ControlPacksManager: Internal Auditor (#394)", () => {
  it("creates a pack with the Controls picked by search and shows it in the list", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ controlPack: { id: "p3", name: "Test New", note: "Fresh", controlIds: ["c3"] } }, 201))));
    const user = userEvent.setup();
    render_(true);
    await user.click(screen.getByRole("button", { name: "New Control Pack" }));
    expect(screen.getByRole("button", { name: "Add Control Pack" })).toBeDisabled();

    await user.type(screen.getByLabelText(/^Name/), "  Test New ");
    await user.type(screen.getByLabelText(/^Note/), "Fresh");
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "org-0");
    expect(screen.queryByRole("checkbox", { name: /SEC-001/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /ORG-001/ }));
    await user.click(screen.getByRole("button", { name: "Add Control Pack" }));

    expect(calls()[0][0]).toBe("/api/control-packs");
    expect(calls()[0][1]?.method).toBe("POST");
    expect(JSON.parse(calls()[0][1]!.body as string)).toEqual({ name: "Test New", note: "Fresh", controlIds: ["c3"] });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Added Test New."));
    expect(screen.getByRole("button", { name: /Test New/ })).toHaveTextContent("1 Control");
  });

  it("edits a pack with PATCH, and shows the server's refusal of a clashing name without changing the list", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ error: 'A Control Pack named "Test Empty" already exists.' }, 409))));
    const user = userEvent.setup();
    render_(true);
    await user.click(screen.getByRole("button", { name: /Test Access/ }));
    await user.click(screen.getByRole("checkbox", { name: /SEC-002/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(calls()[0][0]).toBe("/api/control-packs/p1");
    expect(calls()[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(calls()[0][1]!.body as string)).toEqual({ name: "Test Access", note: "Who gets in", controlIds: ["c1", "c2"] });
    expect(await screen.findByRole("alert")).toHaveTextContent('A Control Pack named "Test Empty" already exists.');
    expect(screen.getByRole("button", { name: /Test Access/ })).toHaveTextContent("1 Control");
  });

  it("hides the list of packs while a new pack is being written, and shows it again on Close", async () => {
    const user = userEvent.setup();
    render_(true);
    await user.click(screen.getByRole("button", { name: "New Control Pack" }));
    expect(screen.queryByRole("heading", { name: "Packs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Control Pack" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test Access/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("heading", { name: "Packs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Test Access/ })).toBeInTheDocument();
  });

  it("says a repeated name clashes without asking the server", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render_(true);
    await user.click(screen.getByRole("button", { name: "New Control Pack" }));
    await user.type(screen.getByLabelText(/^Name/), "test access");
    await user.click(screen.getByRole("button", { name: "Add Control Pack" }));
    expect(screen.getByRole("alert")).toHaveTextContent('A Control Pack named "Test Access" already exists.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes only after a confirmation, and says audits are unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    const user = userEvent.setup();
    render_(true);
    await user.click(screen.getByRole("button", { name: /Test Access/ }));
    await user.click(screen.getByRole("button", { name: "Delete Control Pack" }));
    expect(fetch).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Keep" }));
    expect(fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete Control Pack" }));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Delete" }));
    expect(calls()[0][0]).toBe("/api/control-packs/p1");
    expect(calls()[0][1]?.method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Test Access/ })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Internal Audits already planned are unchanged");
  });
});
