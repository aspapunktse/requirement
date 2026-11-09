import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskAnalysisView } from "@/lib/risk-analysis";
import { SystemRiskAnalyses } from "../SystemRiskAnalyses";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const analysis = (over: Partial<RiskAnalysisView> & { id: string }): RiskAnalysisView => ({
  heldOn: "2026-11-09",
  notes: "",
  participants: [],
  outsiders: [],
  reviewedRisks: [],
  raisedRisks: [],
  recordedBy: { id: "u9", name: "Rita Risk" },
  createdAt: "2026-11-09T10:00:00.000Z",
  completedAt: null,
  completedBy: null,
  ...over,
});

const PEOPLE = [
  { id: "u1", name: "Anna Ek" },
  { id: "u2", name: "Bo Lind" },
];
const OPEN_RISKS = [
  { id: "r1", title: "Weak passwords" },
  { id: "r2", title: "Unpatched server" },
];

let fetchMock: ReturnType<typeof vi.fn>;
let analyses: RiskAnalysisView[];
const onRisksChanged = vi.fn();

beforeEach(() => {
  refresh.mockClear();
  onRisksChanged.mockClear();
  analyses = [];
  fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => (init?.method ? respond({ riskAnalysis: {} }, 201) : respond({ riskAnalyses: analyses })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderIt = (props: Partial<React.ComponentProps<typeof SystemRiskAnalyses>> = {}) =>
  render(<SystemRiskAnalyses systemId="s1" canRecord people={PEOPLE} openRisks={OPEN_RISKS} onRisksChanged={onRisksChanged} {...props} />);

describe("Risk Analyses on the Risks tab (#325)", { timeout: 30_000 }, () => {
  it("loads and lists the analyses, with their state, who took part and the Risks reviewed and raised", async () => {
    analyses = [
      analysis({ id: "a1", participants: [{ id: "u1", name: "Anna Ek" }], outsiders: ["Vendor CISO"], notes: "Agreed owners", reviewedRisks: [{ id: "r1", title: "Weak passwords", severity: "HIGH", status: "OPEN", ownerId: "u1" }], completedAt: "2026-11-09T12:00:00.000Z", completedBy: { id: "u9", name: "Rita Risk" } }),
      analysis({ id: "a2", heldOn: "2026-10-01" }),
    ];
    renderIt();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Risk Analyses");
    const list = within(await screen.findByRole("list", { name: "Risk Analyses" }));
    const [done, draft] = list.getAllByRole("listitem");
    expect(done).toHaveTextContent("Completed");
    expect(done).toHaveTextContent("With Anna Ek, Vendor CISO");
    expect(done).toHaveTextContent("Agreed owners");
    expect(done).toHaveTextContent("Reviewed: Weak passwords");
    expect(within(done).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(draft).toHaveTextContent("In progress");
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risk-analyses");
  });

  it("shows no action to someone who may not record one, only the list", async () => {
    analyses = [analysis({ id: "a2" })];
    renderIt({ canRecord: false });
    await screen.findByRole("list", { name: "Risk Analyses" });
    expect(screen.queryByRole("button", { name: /Record Risk Analysis/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  });

  it("says so when none is recorded, and when the list can't be loaded", async () => {
    renderIt();
    expect(await screen.findByText("No Risk Analysis has been recorded for this System.")).toBeInTheDocument();
    cleanup();
    fetchMock.mockImplementation(() => respond({}, 500));
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Risk Analyses");
  });

  it("records one: date, participants, outsiders, notes, reviewed Risks and a Risk raised in the meeting", async () => {
    const user = userEvent.setup();
    renderIt();
    await screen.findByText("No Risk Analysis has been recorded for this System.");
    await user.click(screen.getByRole("button", { name: "+ Record Risk Analysis" }));
    const form = within(screen.getByRole("form", { name: "Record a Risk Analysis" }));
    fireEvent.change(form.getByLabelText("Date of the meeting"), { target: { value: "2026-11-09" } });
    await user.click(form.getByRole("checkbox", { name: "Anna Ek" }));
    fireEvent.change(form.getByLabelText("Outside participants"), { target: { value: "Vendor architect\nVendor CISO" } });
    fireEvent.change(form.getByLabelText("Notes"), { target: { value: "Walked through the register" } });
    // Every open Risk starts as reviewed; this meeting skipped one.
    expect(form.getByRole("checkbox", { name: "Weak passwords" })).toBeChecked();
    await user.click(form.getByRole("checkbox", { name: "Unpatched server" }));
    await user.click(form.getByRole("button", { name: "+ Raise a Risk" }));
    fireEvent.change(form.getByLabelText("New Risk 1 title"), { target: { value: "Vendor lock-in" } });
    fireEvent.change(form.getByLabelText("New Risk 1 description"), { target: { value: "No export path" } });
    await user.selectOptions(form.getByLabelText("New Risk 1 severity"), "HIGH");
    await user.click(form.getByRole("button", { name: "Record Risk Analysis" }));

    await waitFor(() => expect(onRisksChanged).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/systems/s1/risk-analyses");
    expect(JSON.parse(post[1].body)).toEqual({
      heldOn: "2026-11-09",
      notes: "Walked through the register",
      participantIds: ["u1"],
      outsiders: ["Vendor architect", "Vendor CISO"],
      reviewedRiskIds: ["r1"],
      newRisks: [{ title: "Vendor lock-in", description: "No export path", severity: "HIGH", likelihood: "MEDIUM" }],
    });
    // The form closes and the list is read again.
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("shows the server's message when saving fails, and keeps the form", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) => (init?.method ? respond({ error: "A reviewed Risk does not belong to this System" }, 400) : respond({ riskAnalyses: [] })));
    renderIt();
    await user.click(await screen.findByRole("button", { name: "+ Record Risk Analysis" }));
    await user.click(screen.getByRole("button", { name: "Record Risk Analysis" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A reviewed Risk does not belong to this System");
    expect(screen.getByRole("form", { name: "Record a Risk Analysis" })).toBeInTheDocument();
    expect(onRisksChanged).not.toHaveBeenCalled();
  });

  it("edits one that isn't completed with a PATCH", async () => {
    const user = userEvent.setup();
    analyses = [analysis({ id: "a2", notes: "First draft", participants: [{ id: "u2", name: "Bo Lind" }] })];
    renderIt();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const form = within(screen.getByRole("form", { name: "Edit Risk Analysis" }));
    expect(form.getByLabelText("Notes")).toHaveValue("First draft");
    expect(form.getByRole("checkbox", { name: "Bo Lind" })).toBeChecked();
    fireEvent.change(form.getByLabelText("Notes"), { target: { value: "First draft and more" } });
    await user.click(form.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/api/systems/s1/risk-analyses/a2");
    expect(JSON.parse(patch[1].body)).toMatchObject({ notes: "First draft and more", participantIds: ["u2"] });
  });

  it("completes one, and shows the refusal that names the Risks without an owner", async () => {
    const user = userEvent.setup();
    analyses = [analysis({ id: "a2" })];
    const refusal = 'Every open or accepted Risk needs an owner before the Risk Analysis can be completed. Without an owner: "Weak passwords".';
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) => (init?.method ? respond({ error: refusal }, 409) : respond({ riskAnalyses: analyses })));
    renderIt();
    await user.click(await screen.findByRole("button", { name: "Complete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(refusal);
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risk-analyses/a2/complete", { method: "POST" });
    expect(refresh).not.toHaveBeenCalled();

    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) => (init?.method ? respond({ riskAnalysis: {} }) : respond({ riskAnalyses: analyses })));
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(onRisksChanged).toHaveBeenCalled();
  });
});
