import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddCandidateDialog } from "../AddCandidateDialog";

// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const system = (id: string, name: string, reason: string | null = null) => ({ id, name, vendor: `${name} Vendor`, owner: { id: "u-1", name: "Olive Owner" }, stage: reason ? null : "FIRST_ROUND", reason });
const list = (over: Record<string, unknown> = {}) => ({
  systems: [system("s-1", "Alpha"), system("s-2", "Beta", "It is not in the staged evaluation."), system("s-3", "Gamma")],
  full: false,
  stagedEvaluation: true,
  canCreateSystem: true,
  ...over,
});

type Call = [string, RequestInit | undefined];
function stub(loaded: unknown, post: { status: number; body: unknown } = { status: 201, body: { candidate: {} } }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init]);
      const result = init?.method === "POST" ? post : { status: 200, body: loaded };
      return { ok: result.status < 300, status: result.status, json: async () => result.body } as Response;
    }),
  );
  return calls;
}
const renderDialog = () => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<AddCandidateDialog id="cmp-1" onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
};

describe("AddCandidateDialog (#374)", () => {
  it("lists the Systems, greys out the ones that can't be added with the reason, and adds the picked one", async () => {
    const calls = stub(list());
    const { onDone } = renderDialog();
    const alpha = await screen.findByRole("radio", { name: /Alpha/ });
    expect(screen.getByRole("radio", { name: /Beta/ })).toBeDisabled();
    expect(screen.getByText("It is not in the staged evaluation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Candidate" })).toBeDisabled();
    await userEvent.click(alpha);
    await userEvent.click(screen.getByRole("button", { name: "Add Candidate" }));
    expect(onDone).toHaveBeenCalled();
    expect(calls[0][0]).toBe("/api/comparisons/cmp-1/candidates");
    const post = calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/comparisons/cmp-1/candidates");
    expect(JSON.parse(post[1]!.body as string)).toEqual({ systemId: "s-1" });
  });

  it("lists the Systems that can be added first, then the ones that can't, each group by name", async () => {
    stub(list({ systems: [system("s-1", "Aardvark", "Closed."), system("s-2", "Zeta"), system("s-3", "Beta", "Closed."), system("s-4", "Mu")] }));
    renderDialog();
    await screen.findByRole("radio", { name: /Zeta/ });
    expect(screen.getAllByRole("radio").map((radio) => radio.closest("label")!.querySelector(".font-semibold")!.textContent)).toEqual(["Mu", "Zeta", "Aardvark", "Beta"]);
  });

  it("filters the list by what is typed", async () => {
    stub(list());
    renderDialog();
    await screen.findByRole("radio", { name: /Alpha/ });
    await userEvent.type(screen.getByLabelText("Find a System"), "gam");
    expect(screen.queryByRole("radio", { name: /Alpha/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Gamma/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Find a System"), "zzz");
    expect(screen.getByText("No System matches.")).toBeInTheDocument();
  });

  it("offers Create a new System, carrying the Comparison to the interview", async () => {
    stub(list());
    renderDialog();
    const link = await screen.findByRole("link", { name: "Create a new System" });
    expect(link).toHaveAttribute("href", "/systems/new?comparison=cmp-1");
  });

  it("explains instead of offering Create a new System when staged evaluation is off or the role may not create one", async () => {
    stub(list({ stagedEvaluation: false }));
    renderDialog();
    expect(await screen.findByRole("note")).toHaveTextContent("Staged evaluation for new Systems is off");
    expect(screen.queryByRole("link", { name: "Create a new System" })).not.toBeInTheDocument();
    cleanup();
    stub(list({ canCreateSystem: false }));
    renderDialog();
    expect(await screen.findByRole("note")).toHaveTextContent("Only a System Owner, Risk Owner or Admin");
    expect(screen.queryByRole("link", { name: "Create a new System" })).not.toBeInTheDocument();
  });

  it("says so, disables every System and offers no new one when the Comparison is full", async () => {
    stub(list({ full: true }));
    renderDialog();
    expect(await screen.findByText(/already holds five Candidates/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alpha/ })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Create a new System" })).not.toBeInTheDocument();
  });

  it("shows the server's refusal and stays open when the add is refused", async () => {
    stub(list(), { status: 409, body: { error: "That System is not in the staged evaluation." } });
    const { onDone } = renderDialog();
    await userEvent.click(await screen.findByRole("radio", { name: /Alpha/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add Candidate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That System is not in the staged evaluation.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows an error when the list can't be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "You can't add Candidates here." }) }) as Response));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't add Candidates here.");
  });
});
