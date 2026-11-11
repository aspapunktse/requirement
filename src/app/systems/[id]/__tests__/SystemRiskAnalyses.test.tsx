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
    // The lead's own failure (#361) is a second alert; this one is the list's.
    expect(await screen.findByText(/Couldn't load the Risk Analyses/)).toBeInTheDocument();
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
      riskOwners: [],
      newRisks: [{ title: "Vendor lock-in", description: "No export path", severity: "HIGH", likelihood: "MEDIUM" }],
    });
    // The form closes and the list is read again.
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("assigns owners in the form: to a reviewed Risk, to a Risk raised in the meeting, and sends only what changed (#360)", async () => {
    const user = userEvent.setup();
    renderIt({ openRisks: [{ id: "r1", title: "Weak passwords", ownerId: "u1" }, { id: "r2", title: "Unpatched server", ownerId: null }] });
    await user.click(await screen.findByRole("button", { name: "+ Record Risk Analysis" }));
    const form = within(screen.getByRole("form", { name: "Record a Risk Analysis" }));
    // The current owner is preselected, so leaving it sends nothing for that Risk.
    expect(form.getByLabelText("Owner for Weak passwords")).toHaveValue("u1");
    expect(form.getByLabelText("Owner for Unpatched server")).toHaveValue("");
    await user.selectOptions(form.getByLabelText("Owner for Unpatched server"), "u2");
    await user.click(form.getByRole("button", { name: "+ Raise a Risk" }));
    fireEvent.change(form.getByLabelText("New Risk 1 title"), { target: { value: "Vendor lock-in" } });
    fireEvent.change(form.getByLabelText("New Risk 1 description"), { target: { value: "No export path" } });
    await user.selectOptions(form.getByLabelText("New Risk 1 owner"), "u1");
    await user.click(form.getByRole("button", { name: "Record Risk Analysis" }));

    await waitFor(() => expect(onRisksChanged).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body);
    expect(body.riskOwners).toEqual([{ riskId: "r2", ownerId: "u2" }]);
    expect(body.newRisks[0]).toMatchObject({ title: "Vendor lock-in", ownerId: "u1" });
  });

  it("clears an owner with Unassigned, and sets one on a Risk raised earlier when editing (#360)", async () => {
    const user = userEvent.setup();
    analyses = [
      analysis({
        id: "a2",
        reviewedRisks: [{ id: "r1", title: "Weak passwords", severity: "HIGH", status: "OPEN", ownerId: "u1" }],
        raisedRisks: [{ id: "r5", title: "Raised earlier", severity: "LOW", status: "OPEN", ownerId: null }],
      }),
    ];
    renderIt({ openRisks: [{ id: "r1", title: "Weak passwords", ownerId: "u1" }] });
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const form = within(screen.getByRole("form", { name: "Edit Risk Analysis" }));
    await user.selectOptions(form.getByLabelText("Owner for Weak passwords"), "");
    await user.selectOptions(form.getByLabelText("Owner for Raised earlier"), "u2");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")![1].body);
    expect(body.riskOwners).toEqual(expect.arrayContaining([{ riskId: "r1", ownerId: null }, { riskId: "r5", ownerId: "u2" }]));
    expect(body.riskOwners).toHaveLength(2);
  });

  it("doesn't send an owner it didn't change when the Risk's owner is saved elsewhere while the form is open (#360)", async () => {
    const user = userEvent.setup();
    const { rerender } = renderIt({ openRisks: [{ id: "r1", title: "Weak passwords", ownerId: "u1" }] });
    await user.click(await screen.findByRole("button", { name: "+ Record Risk Analysis" }));
    const form = within(screen.getByRole("form", { name: "Record a Risk Analysis" }));
    expect(form.getByLabelText("Owner for Weak passwords")).toHaveValue("u1");
    // Someone saves another owner on the opened Risk above: the page passes the new owner down without remounting the form.
    rerender(<SystemRiskAnalyses systemId="s1" canRecord people={PEOPLE} openRisks={[{ id: "r1", title: "Weak passwords", ownerId: "u2" }]} onRisksChanged={onRisksChanged} />);
    await user.click(screen.getByRole("form", { name: "Record a Risk Analysis" }).querySelector("button[type=submit]") ?? screen.getByRole("button", { name: "Record Risk Analysis" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body);
    expect(body.riskOwners).toEqual([]);
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

describe("Risk Analysis lead on the Risk Analyses card (#361)", { timeout: 30_000 }, () => {
  const LEAD_URL = "/api/systems/s1/risk-analysis-lead";
  const lead = (over: Record<string, unknown> = {}) => ({ staged: true, lead: null, canChange: true, candidates: [{ id: "u1", name: "Anna Ek" }, { id: "u2", name: "Bo Lind" }], ...over });
  const serve = (state: () => unknown) => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === LEAD_URL) return init?.method === "PUT" ? respond({ changed: true, lead: { id: "u2", name: "Bo Lind" } }) : respond(state());
      return respond({ riskAnalyses: [] });
    });
  };

  it("lets someone who may change it name a lead and clear it again", async () => {
    const user = userEvent.setup();
    let current = lead();
    serve(() => current);
    renderIt();
    const picker = await screen.findByLabelText("Risk Analysis lead");
    expect(picker).toHaveValue("");
    current = lead({ lead: { id: "u2", name: "Bo Lind", eligible: true } });
    await user.selectOptions(picker, "u2");
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1].body)).toEqual({ leadId: "u2" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText("Risk Analysis lead")).toHaveValue("u2"));
    await user.selectOptions(screen.getByLabelText("Risk Analysis lead"), "");
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2));
    expect(JSON.parse(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")[1][1].body)).toEqual({ leadId: null });
  });

  it("shows the lead read-only to someone who cannot change it, and nothing for a System without stages", async () => {
    serve(() => lead({ canChange: false, candidates: [], lead: { id: "u2", name: "Bo Lind", eligible: true } }));
    renderIt({ canRecord: false });
    expect(await screen.findByText("Bo Lind")).toBeInTheDocument();
    expect(screen.queryByLabelText("Risk Analysis lead")).not.toBeInTheDocument();
    cleanup();
    serve(() => lead({ staged: false }));
    renderIt();
    await screen.findByText("No Risk Analysis has been recorded for this System.");
    expect(screen.queryByLabelText("Risk Analysis lead")).not.toBeInTheDocument();
  });

  it("shows the server's message when saving is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === LEAD_URL) return init?.method === "PUT" ? respond({ error: "Nope" }, 400) : respond(lead());
      return respond({ riskAnalyses: [] });
    });
    renderIt();
    await user.selectOptions(await screen.findByLabelText("Risk Analysis lead"), "u1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
  });

  it("says it is loading until the lead has been read", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation((input: string | URL | Request) =>
      String(input) === LEAD_URL ? new Promise<Response>((resolve) => (release = resolve)) : respond({ riskAnalyses: [] }),
    );
    renderIt();
    expect(await screen.findByText(/Loading the Risk Analysis lead/)).toBeInTheDocument();
    release(new Response(JSON.stringify(lead()), { status: 200 }));
    expect(await screen.findByLabelText("Risk Analysis lead")).toBeInTheDocument();
    expect(screen.queryByText(/Loading the Risk Analysis lead/)).not.toBeInTheDocument();
  });

  it("reports a failed read of the lead and reads again on Retry", async () => {
    const user = userEvent.setup();
    let failing = true;
    fetchMock.mockImplementation((input: string | URL | Request) => {
      if (String(input) === LEAD_URL) return failing ? respond({ error: "boom" }, 500) : respond(lead());
      return respond({ riskAnalyses: [] });
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Risk Analysis lead");
    expect(screen.queryByLabelText("Risk Analysis lead")).not.toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Risk Analysis lead")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
