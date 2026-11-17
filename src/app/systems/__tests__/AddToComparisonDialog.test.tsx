import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToComparisonDialog } from "../AddToComparisonDialog";

const systems = [
  { id: "s-jira", name: "Jira" },
  { id: "s-okta", name: "Okta" },
];
const open = [
  { id: "c1", name: "New HR system", candidateCount: 1, closed: false, canAddCandidate: true },
  { id: "c2", name: "Closed one", candidateCount: 2, closed: true, canAddCandidate: false },
  { id: "c3", name: "Not yours", candidateCount: 0, closed: false, canAddCandidate: false },
];

type Call = [string, RequestInit | undefined];
function stub(post: { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push([url, init]);
      if (url === "/api/comparisons" && !init) return Promise.resolve(new Response(JSON.stringify({ comparisons: open }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(post.body), { status: post.status }));
    }),
  );
  return calls;
}
const renderDialog = (over: { canCreateComparison?: boolean } = {}) => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<AddToComparisonDialog systems={systems} canCreateComparison={over.canCreateComparison ?? true} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AddToComparisonDialog (#374)", () => {
  it("offers only open Comparisons the user may add to, and adds the Systems to the picked one", async () => {
    const calls = stub({ status: 201, body: { candidates: [] } });
    const { onDone } = renderDialog();
    expect(await screen.findByRole("radio", { name: /New HR system/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Closed one/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Not yours/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Comparison" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /New HR system/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to Comparison" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 2 Systems to New HR system as Candidates.");
    const post = calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/comparisons/c1/candidates");
    expect(JSON.parse(post[1]!.body as string)).toEqual({ systemIds: ["s-jira", "s-okta"] });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("creates a new Comparison with the Systems as its Candidates", async () => {
    const calls = stub({ status: 201, body: { comparison: { id: "c9", name: "Fresh" } } });
    renderDialog();
    await userEvent.click(await screen.findByRole("radio", { name: "A new Comparison" }));
    const add = screen.getByRole("button", { name: "Add to Comparison" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Fresh");
    await userEvent.type(screen.getByLabelText("Need"), "Replace Jira");
    await userEvent.click(add);
    expect(await screen.findByRole("status")).toHaveTextContent("Added 2 Systems to Fresh as Candidates.");
    expect(screen.getByRole("link", { name: "Open the Comparison" })).toHaveAttribute("href", "/comparisons/c9");
    const post = calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/comparisons");
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: "Fresh", need: "Replace Jira", systemIds: ["s-jira", "s-okta"] });
  });

  it("hides the new-Comparison choice from a role that may not create one", async () => {
    stub({ status: 201, body: {} });
    renderDialog({ canCreateComparison: false });
    await screen.findByRole("radio", { name: /New HR system/ });
    expect(screen.queryByRole("radio", { name: "A new Comparison" })).not.toBeInTheDocument();
  });

  it("says which Systems failed and why, and does not report success, when the server refuses", async () => {
    stub({ status: 409, body: { error: "Not every System can be added.", failures: [{ systemId: "s-okta", error: "It is not in the staged evaluation." }] } });
    const { onDone } = renderDialog();
    await userEvent.click(await screen.findByRole("radio", { name: /New HR system/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to Comparison" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not every System can be added.");
    const list = screen.getByRole("list", { name: "Systems that can't be added" });
    expect(within(list).getByText("Okta")).toBeInTheDocument();
    expect(list).toHaveTextContent("It is not in the staged evaluation.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
