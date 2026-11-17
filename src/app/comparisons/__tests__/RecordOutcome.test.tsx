import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonPage } from "../ComparisonPage";
import { CloseNotSelectedDialog, RecordOutcomeDialog } from "../RecordOutcomeDialog";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/PaletteProvider", () => ({ usePagePalette: () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Call = [string, RequestInit | undefined];
function stub(post: { status: number; body: unknown } = { status: 200, body: { recorded: true } }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init]);
      return { ok: post.status < 300, status: post.status, json: async () => post.body } as Response;
    }),
  );
  return calls;
}

const alpha = () => candidate("Alpha", { controls: [control("A.1", "FULFILLED"), control("A.2", "FULFILLED")] });
const beta = () => candidate("Beta", { controls: [control("A.1", "FULFILLED"), control("A.2", "WAIVED")] });
const gamma = () => candidate("Gamma", { rejected: true, controls: [control("A.1", "FULFILLED"), control("A.2", "FULFILLED")] });

describe("RecordOutcomeDialog (#375)", () => {
  const renderDialog = (candidates = [alpha(), beta(), gamma()]) => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<RecordOutcomeDialog id="cmp-1" candidates={candidates} onClose={onClose} onDone={onDone} />);
    return { onClose, onDone };
  };

  it("lists the Candidates and None chosen, and says the Comparison closes and the figures freeze", () => {
    stub();
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Record outcome" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Alpha/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /None chosen/ })).toBeEnabled();
    expect(screen.getByText(/closes the Comparison/)).toBeInTheDocument();
    expect(screen.getByText(/frozen as of today/)).toBeInTheDocument();
  });

  it("lists a Candidate rejected at a gate, disabled, with the reason", () => {
    stub();
    renderDialog();
    expect(screen.getByRole("radio", { name: /Gamma/ })).toBeDisabled();
    expect(screen.getByText("Rejected at a gate: it can't be chosen.")).toBeInTheDocument();
  });

  it("requires a comment and a pick, and sends nothing until both are given", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick the chosen Candidate, or None chosen");
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A comment is required");
    expect(calls).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("records the chosen Candidate with the comment", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "Best fit");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0][0]).toBe("/api/comparisons/cmp-1/outcome");
    expect(calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ chosenSystemId: "sys-Alpha", comment: "Best fit", closeAsNotSelected: [] });
  });

  it("records None chosen as a null Candidate", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /None chosen/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "Nothing meets the need");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ chosenSystemId: null, comment: "Nothing meets the need", closeAsNotSelected: [] });
  });

  it("warns when the pick is not the top scorer, without blocking it", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Beta/ }));
    expect(screen.getByRole("note")).toHaveTextContent("does not have the highest Comparison Score");
    await userEvent.type(screen.getByLabelText(/Comment/), "Cheaper");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0][1]?.body)).chosenSystemId).toBe("sys-Beta");
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the server's refusal and stays open", async () => {
    stub({ status: 409, body: { error: "This Comparison is closed. Reopen it to change it." } });
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Comparison is closed");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("ComparisonPage: record outcome, closed and reopen (#375)", () => {
  const serve = (comparison: ComparisonDetail) => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push([String(input), init]);
        const url = String(input);
        if (url === "/api/comparisons/cmp-1" && !init?.method) return { ok: true, status: 200, json: async () => ({ comparison }) } as Response;
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }),
    );
    return calls;
  };
  const open = () => render(<ComparisonPage id="cmp-1" userId="u-owner" role="SYSTEM_OWNER" />);
  const closedDetail = (over: Partial<NonNullable<ComparisonDetail["outcome"]>> = {}, chosenName = "Beta") =>
    detail(
      [alpha(), { ...beta(), chosen: chosenName === "Beta" }, gamma()],
      {
        closed: true,
        canManage: true,
        outcome: { chosen: chosenName ? { id: `sys-${chosenName}`, name: chosenName } : null, comment: "Cheaper and fits our stack", recordedBy: { id: "u-owner", name: "Olive Owner" }, recordedAt: "2026-11-16T09:00:00.000Z", chosenNotTopScorer: true, ...over },
      },
    );

  it("offers Record outcome to someone who manages an open Comparison, and opens the dialog", async () => {
    serve(detail([alpha(), beta()], { canManage: true }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Record outcome" }));
    expect(screen.getByRole("dialog", { name: "Record outcome" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("disables Record outcome with fewer than two Candidates and says why", async () => {
    serve(detail([alpha()], { canManage: true }));
    open();
    expect(await screen.findByRole("button", { name: "Record outcome" })).toBeDisabled();
    expect(screen.getByText("Add at least two Candidates to record an outcome.")).toBeInTheDocument();
  });

  it("does not offer Record outcome to someone who may not manage the Comparison", async () => {
    serve(detail([alpha(), beta()], { canManage: false, canAddCandidate: true }));
    open();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Record outcome" })).not.toBeInTheDocument();
  });

  it("shows a closed Comparison read-only: the outcome, its comment, who and when, the chosen Candidate marked, no write controls", async () => {
    serve(closedDetail());
    open();
    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText(/Recorded 16 Nov 2026 by Olive Owner/)).toBeInTheDocument();
    expect(within(outcome).getByText("Cheaper and fits our stack")).toBeInTheDocument();
    expect(within(outcome).getByText("Chosen")).toBeInTheDocument();
    expect(within(outcome).getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("as of 16 Nov 2026")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").filter((item) => item.classList.contains("cmp-row"));
    expect(within(rows.find((row) => row.textContent?.includes("Beta"))!).getByText("Chosen")).toBeInTheDocument();
    for (const name of [/Add Candidate/, /Record outcome/, /Edit name and need/, /Participants/, /Delete/, /Remove/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("says when the chosen Candidate was not the top scorer, and not otherwise", async () => {
    serve(closedDetail());
    open();
    expect(await screen.findByText(/The chosen Candidate was not the top scorer/)).toBeInTheDocument();
    cleanup();
    serve(closedDetail({ chosenNotTopScorer: false }));
    open();
    await screen.findByRole("region", { name: "Outcome" });
    expect(screen.queryByText(/not the top scorer/)).not.toBeInTheDocument();
  });

  it("shows None chosen", async () => {
    serve(closedDetail({}, ""));
    open();
    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText("None chosen")).toBeInTheDocument();
  });

  it("does not offer Reopen to someone who may not manage the Comparison", async () => {
    serve({ ...closedDetail(), canManage: false });
    open();
    await screen.findByRole("region", { name: "Outcome" });
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("reopens after asking, then reloads the Comparison", async () => {
    const calls = serve(closedDetail());
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Reopen" }));
    expect(screen.getByRole("dialog", { name: "Reopen this Comparison?" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(calls.some(([url, init]) => url === "/api/comparisons/cmp-1/outcome" && init?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(calls.filter(([url, init]) => url === "/api/comparisons/cmp-1" && !init?.method)).toHaveLength(2));
  });
});

describe("Close as Not selected (#376)", () => {
  const closable = (name: string, over = {}) => candidate(name, { canCloseAsNotSelected: true, controls: [control("A.1", "FULFILLED")], ...over });
  const renderDialog = (candidates = [closable("Alpha"), closable("Beta"), candidate("Gamma", { controls: [control("A.1", "FULFILLED")] })]) => {
    const onDone = vi.fn();
    render(<RecordOutcomeDialog id="cmp-1" candidates={candidates} onClose={vi.fn()} onDone={onDone} />);
    return { onDone };
  };

  it("offers a checkbox, unchecked, for each Candidate not chosen that the user may close, and none for the others", () => {
    stub();
    renderDialog();
    const offer = screen.getByTestId("not-selected-offer");
    expect(within(offer).getByRole("checkbox", { name: /Close Alpha as Not selected/ })).not.toBeChecked();
    expect(within(offer).getByRole("checkbox", { name: /Close Beta as Not selected/ })).not.toBeChecked();
    expect(within(offer).queryByRole("checkbox", { name: /Gamma/ })).not.toBeInTheDocument();
  });

  it("offers nothing when no Candidate may be closed", () => {
    stub();
    renderDialog([candidate("Alpha"), candidate("Beta")]);
    expect(screen.queryByTestId("not-selected-offer")).not.toBeInTheDocument();
  });

  it("does not offer the picked Candidate", async () => {
    stub();
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    const offer = screen.getByTestId("not-selected-offer");
    expect(within(offer).queryByRole("checkbox", { name: /Alpha/ })).not.toBeInTheDocument();
    expect(within(offer).getByRole("checkbox", { name: /Beta/ })).toBeInTheDocument();
  });

  it("sends the ticked Candidates with the outcome, and none when nothing is ticked", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Close Beta as Not selected/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "Best fit");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ chosenSystemId: "sys-Alpha", comment: "Best fit", closeAsNotSelected: ["sys-Beta"] });
  });

  it("leaves out a ticked Candidate that is then picked as the chosen one", async () => {
    const calls = stub();
    const { onDone } = renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /None chosen/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Close Alpha as Not selected/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Alpha/ }));
    await userEvent.type(screen.getByLabelText(/Comment/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0][1]?.body)).closeAsNotSelected).toEqual([]);
  });

  it("lists a Not selected Candidate as not choosable", () => {
    stub();
    renderDialog([closable("Alpha"), candidate("Beta", { notSelected: true })]);
    expect(screen.getByRole("radio", { name: /Beta/ })).toBeDisabled();
    expect(screen.getByText("Closed as Not selected: it can't be chosen.")).toBeInTheDocument();
  });

  it("closes more Candidates from a closed Comparison through the not-selected route", async () => {
    const calls = stub({ status: 200, body: { closed: 1 } });
    const onDone = vi.fn();
    render(<CloseNotSelectedDialog id="cmp-1" candidates={[closable("Alpha", { chosen: true }), closable("Beta")]} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.queryByRole("checkbox", { name: /Alpha/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close as Not selected" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick at least one");
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: /Close Beta as Not selected/ }));
    await userEvent.click(screen.getByRole("button", { name: "Close as Not selected" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0][0]).toBe("/api/comparisons/cmp-1/not-selected");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ systemIds: ["sys-Beta"] });
  });
});
