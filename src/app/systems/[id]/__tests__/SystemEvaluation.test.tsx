import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendationKind } from "@prisma/client";
import type { EvaluationOagParticipantView, EvaluationParticipantView, EvaluationView } from "@/lib/evaluation";
import { SystemEvaluation } from "../SystemEvaluation";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.setConfig({ testTimeout: 20_000 });

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const READY = { hasBusinessSystemOwner: true, hasSensitivityLevel: true, belowInformationTypes: null, riskAnalysisCompleted: true, mandatoryTotal: 4, mandatoryMissing: [], ready: true };
const NOT_READY = {
  hasBusinessSystemOwner: false,
  hasSensitivityLevel: false,
  belowInformationTypes: null,
  riskAnalysisCompleted: false,
  mandatoryTotal: 4,
  mandatoryMissing: [{ code: "A.5.1", title: "Policies" }],
  ready: false,
};

const evaluation = (over: Partial<EvaluationView> = {}): EvaluationView => ({
  stage: "FIRST_ROUND",
  track: null,
  stageEnteredAt: "2026-11-09T10:00:00.000Z",
  canSubmit: true,
  firstRound: NOT_READY,
  secondRound: null,
  canRecordRiskAnalysis: false,
  og1: null,
  firstDocumentation: null,
  oag: null,
  og2Justification: null,
  decisions: [],
  closed: false,
  closedAt: null,
  authorized: false,
  og3: null,
  qualification: null,
  og2: null,
  ...over,
});

const participant = (over: Partial<EvaluationParticipantView> = {}): EvaluationParticipantView => ({
  reviewGroupId: "g1",
  name: "Security group",
  verdict: null,
  reopened: null,
  canGive: false,
  ...over,
});

const og1Stage = (participants: EvaluationParticipantView[], over: Partial<EvaluationView> = {}) =>
  evaluation({ stage: "OG1", firstRound: null, og1: { open: true, track: null, participants }, ...over });

let current: EvaluationView;
let fetchMock: ReturnType<typeof vi.fn>;
let writeStatus = 200;
let writeBody: unknown = {};

beforeEach(() => {
  refresh.mockClear();
  writeStatus = 200;
  writeBody = {};
  fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST" ? respond(writeBody, writeStatus) : respond({ evaluation: current }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("Evaluation tab (#328)", () => {
  it("shows a loading note, then the evaluation, and an error when the read fails", async () => {
    current = evaluation();
    render(<SystemEvaluation systemId="s1" />);
    expect(screen.getByText(/Loading the evaluation/)).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "First-round checklist" })).toBeInTheDocument();
    cleanup();

    fetchMock.mockImplementation(() => respond({ error: "no" }, 500));
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the evaluation");
  });

  it("lists the first-round checklist with what is missing, and keeps Submit disabled until it is complete", async () => {
    current = evaluation();
    render(<SystemEvaluation systemId="s1" />);
    const list = await screen.findByRole("list", { name: "First-round checklist" });
    expect(within(list).getByText(/No Business System Owner yet/)).toBeInTheDocument();
    expect(within(list).getByText(/No Sensitivity Level yet/)).toBeInTheDocument();
    expect(within(list).getByText(/No completed Risk Analysis yet/)).toBeInTheDocument();
    expect(within(list).getByText("3 of 4 mandatory first-round Controls have an Assessment")).toBeInTheDocument();
    expect(screen.getByText(/A\.5\.1 \(Policies\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit the first round" })).toBeDisabled();
  });

  it("names a Sensitivity Level below the Information Types in the checklist", async () => {
    current = evaluation({ firstRound: { ...READY, ready: false, belowInformationTypes: "Cannot submit: the System's Sensitivity Level is below its Information Types (Payroll is High). Raise the level to High or higher first." } });
    render(<SystemEvaluation systemId="s1" />);
    const list = await screen.findByRole("list", { name: "First-round checklist" });
    expect(within(list).getByText(/is below its Information Types \(Payroll is High\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit the first round" })).toBeDisabled();
  });

  it("enables Submit for a ready System, posts it and refreshes the page", async () => {
    current = evaluation({ firstRound: READY });
    render(<SystemEvaluation systemId="s1" />);
    const button = await screen.findByRole("button", { name: "Submit the first round" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/submit-first-round");
  });

  it("shows the server's reason when the submit is refused, and does not refresh", async () => {
    current = evaluation({ firstRound: READY });
    writeStatus = 409;
    writeBody = { error: "Cannot submit the first round: it needs a completed Risk Analysis" };
    render(<SystemEvaluation systemId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit the first round" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("needs a completed Risk Analysis");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("has no Submit for someone who may not submit", async () => {
    current = evaluation({ canSubmit: false, firstRound: READY });
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "First-round checklist" });
    expect(screen.queryByRole("button", { name: "Submit the first round" })).toBeNull();
    expect(screen.getByText(/owner or an Admin submits the first round/)).toBeInTheDocument();
  });

  it("shows OG1 verdicts as the group's, the person only when the server named them, and the any-Full line", async () => {
    current = og1Stage([
      participant({ reviewGroupId: null, name: "Base review", verdict: { verdict: "SELF", comment: "Looks fine", givenAt: "2026-11-09T11:00:00.000Z", by: null } }),
      participant({ verdict: { verdict: "FULL", comment: "Needs a closer look", givenAt: "2026-11-09T12:00:00.000Z", by: "Ada Admin" } }),
      participant({ reviewGroupId: "g2", name: "Privacy group" }),
    ]);
    render(<SystemEvaluation systemId="s1" />);
    const list = await screen.findByRole("list", { name: "OG1 verdicts" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Base review");
    expect(items[0]).toHaveTextContent("Looks fine");
    expect(items[0]).not.toHaveTextContent("Ada Admin");
    expect(items[1]).toHaveTextContent("Needs a closer look");
    expect(items[1]).toHaveTextContent("Ada Admin");
    expect(items[2]).toHaveTextContent("Open");
    expect(screen.getByText(/At least one Full verdict/)).toBeInTheDocument();
    expect(screen.getByText(/1 still to answer/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("gives a participant the viewer may answer for a form that posts the verdict", async () => {
    current = og1Stage([participant({ canGive: true })]);
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "Verdict for Security group" });
    const give = within(form).getByRole("button", { name: "Give verdict" });
    expect(give).toBeDisabled(); // a comment is required
    await userEvent.click(within(form).getByLabelText("Full"));
    await userEvent.type(within(form).getByLabelText("Comment"), "Check the vendor");
    await userEvent.click(give);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/verdicts");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ reviewGroupId: "g1", verdict: "FULL", comment: "Check the vendor" });
  });

  it("shows a refused verdict's reason", async () => {
    current = og1Stage([participant({ canGive: true })]);
    writeStatus = 409;
    writeBody = { error: "Security group has already given its verdict at OG1" };
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "Verdict for Security group" });
    await userEvent.type(within(form).getByLabelText("Comment"), "Again");
    await userEvent.click(within(form).getByRole("button", { name: "Give verdict" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("already given its verdict");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a reopened verdict with its reason", async () => {
    current = og1Stage([participant({ reopened: { at: "2026-11-09T13:00:00.000Z", reason: "A.5.1 changed after the verdict" } })]);
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/A\.5\.1 changed after the verdict/)).toBeInTheDocument();
  });

  it("shows the closed outcome and the chosen Track once OG1 is over", async () => {
    current = evaluation({
      stage: "QUALIFICATION",
      track: "FULL",
      firstRound: null,
      og1: {
        open: false,
        track: "FULL",
        participants: [participant({ verdict: { verdict: "FULL", comment: "Needs more", givenAt: "2026-11-09T12:00:00.000Z", by: null } })],
      },
    });
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "Tracks" });
    await userEvent.click(screen.getByRole("button", { name: /^OG1/ }));
    expect(await screen.findByText(/OG1 closed: the Full track/)).toBeInTheDocument();
    expect(screen.getByText("Chosen at OG1")).toBeInTheDocument();
  });

  it("says a later stage isn't available yet", async () => {
    current = evaluation({ stage: "OAG_REVIEW_2", track: "FULL", firstRound: null, og1: { open: false, track: "FULL", participants: [] } });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/isn't available yet/)).toBeInTheDocument();
  });
});

describe("Evaluation tab stage cards: documentation and Risk Analysis (#348)", () => {
  const fullTrack = () => evaluation({ stage: "QUALIFICATION", track: "FULL", firstRound: null, og1: { open: false, track: "FULL", participants: [] } });
  const docRow = (id: string, name: string, stage: string, tracks: string[], provided = false) => ({ id, name, description: null, stage, tracks, link: provided ? "https://example.com/x" : null, provided, file: null, updatedAt: null, updatedBy: null });

  beforeEach(() => {
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/documents"))
        return respond({
          documents: [docRow("d1", "Architecture description", "FIRST_DOCUMENTATION", ["FULL"], true), docRow("d2", "DPIA", "SECOND_ROUND", ["SELF", "FULL"])],
          canEdit: false,
        });
      if (url.endsWith("/risk-analyses")) return respond({ riskAnalyses: [] });
      if (url.endsWith("/risks")) return respond({ risks: [] });
      return respond({ evaluation: current });
    });
  });

  it("shows the Risk Analysis record, empty to begin with, when the Risk Analysis step is picked", async () => {
    current = evaluation();
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "First-round checklist" });
    await userEvent.click(screen.getByRole("button", { name: /^Risk Analysis/ }));
    expect(await screen.findByText("No Risk Analysis recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "First-round checklist" })).toBeNull();
    expect(await screen.findByText("No open Risks.")).toBeInTheDocument();
  });

  it("shows first documentation in its stage card, and the Risk summary with it", async () => {
    current = fullTrack();
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "Tracks" });
    await userEvent.click(screen.getByRole("button", { name: /^First documentation/ }));
    const list = await screen.findByRole("list", { name: "First documentation Document Requirements" });
    expect(within(list).getByText("Architecture description")).toBeInTheDocument();
    expect(screen.queryByText("DPIA")).toBeNull();
    expect(screen.getByRole("heading", { name: "Risk summary" })).toBeInTheDocument();
  });

  it("shows second-round documentation in the second round's card", async () => {
    current = fullTrack();
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "Tracks" });
    await userEvent.click(screen.getByRole("button", { name: /^Second round/ }));
    const list = await screen.findByRole("list", { name: "Second round Document Requirements" });
    expect(within(list).getByText("DPIA")).toBeInTheDocument();
    expect(screen.getAllByText(/isn't available yet/).length).toBeGreaterThan(0);
  });
});

describe("Evaluation tab: second round and Risk Analysis (#329)", () => {
  const SECOND_READY = { mandatoryTotal: 5, mandatoryMissing: [], documentsMissing: [], ready: true };
  const SECOND_NOT_READY = { mandatoryTotal: 5, mandatoryMissing: [{ code: "A.8.1", title: "Devices" }], documentsMissing: [{ id: "d2", name: "DPIA" }], ready: false };
  const second = (secondRound: EvaluationView["secondRound"], over: Partial<EvaluationView> = {}) =>
    evaluation({ stage: "SECOND_ROUND", track: "SELF", firstRound: null, secondRound, og1: { open: false, track: "SELF", participants: [] }, ...over });

  beforeEach(() => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return respond(writeBody, writeStatus);
      if (url.endsWith("/documents")) return respond({ documents: [], canEdit: false });
      if (url.endsWith("/risk-analyses")) return respond({ riskAnalyses: [] });
      if (url.endsWith("/risks")) return respond({ risks: [] });
      return respond({ evaluation: current });
    });
  });

  it("lists what is left in the second round and keeps Submit disabled", async () => {
    current = second(SECOND_NOT_READY);
    render(<SystemEvaluation systemId="s1" />);
    const list = await screen.findByRole("list", { name: "Second-round checklist" });
    expect(within(list).getByText("4 of 5 mandatory Controls have an Assessment")).toBeInTheDocument();
    expect(screen.getByText(/A\.8\.1 \(Devices\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet provided: DPIA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit the second round" })).toBeDisabled();
  });

  it("posts the second-round submit and refreshes", async () => {
    current = second(SECOND_READY);
    render(<SystemEvaluation systemId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit the second round" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/evaluation/submit-second-round", { method: "POST" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the server's reason when the second-round submit is refused", async () => {
    current = second(SECOND_READY);
    writeStatus = 409;
    writeBody = { error: "Cannot submit the second round: it needs something" };
    render(<SystemEvaluation systemId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit the second round" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot submit the second round: it needs something");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("has no second-round Submit for someone who may not submit", async () => {
    current = second(SECOND_READY, { canSubmit: false });
    render(<SystemEvaluation systemId="s1" />);
    await screen.findByRole("list", { name: "Second-round checklist" });
    expect(screen.queryByRole("button", { name: "Submit the second round" })).toBeNull();
  });

  it("makes the Risk Analysis the current step once the second round is submitted, waiting for the analysis", async () => {
    current = second(null, { stage: "RISK_ANALYSIS_2", canRecordRiskAnalysis: true });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/The second round is submitted\. Record a Risk Analysis/)).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Evaluation stages" });
    expect(within(steps).getByRole("button", { name: /^Second round/ })).toHaveTextContent("done");
    expect(within(steps).getAllByRole("button", { name: /^Risk Analysis/ }).at(-1)).toHaveAttribute("aria-current", "step");
  });

  it("shows OG3 as the current step, with the Risk Analysis done", async () => {
    current = second(null, { stage: "OG3" });
    render(<SystemEvaluation systemId="s1" />);
    const steps = await screen.findByRole("list", { name: "Evaluation stages" });
    expect(within(steps).getByRole("button", { name: /^OG3/ })).toHaveAttribute("aria-current", "step");
    expect(within(steps).getAllByRole("button", { name: /^Risk Analysis/ }).at(-1)).toHaveTextContent("done");
  });
});

describe("Evaluation tab: OG3 (#330)", () => {
  const at = (over: Partial<EvaluationView> = {}) =>
    evaluation({
      stage: "OG3",
      track: "SELF",
      firstRound: null,
      og1: { open: false, track: "SELF", participants: [] },
      og3: { canDecide: true, sendBackTargets: ["FIRST_ROUND", "OG1", "SECOND_ROUND", "RISK_ANALYSIS_2"] },
      ...over,
    });

  beforeEach(() => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return respond(writeBody, writeStatus);
      if (url.endsWith("/documents")) return respond({ documents: [], canEdit: false });
      if (url.endsWith("/risk-analyses")) return respond({ riskAnalyses: [] });
      if (url.endsWith("/risks")) return respond({ risks: [] });
      return respond({ evaluation: current });
    });
  });

  it("posts an authorization with its comment, and keeps the button off without one", async () => {
    current = at();
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "OG3 decision" });
    const button = within(form).getByRole("button", { name: "Authorize to operate" });
    expect(button).toBeDisabled();
    await user.type(within(form).getByLabelText("Comment"), "Risks are accepted");
    await user.click(button);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ decision: "AUTHORIZE", comment: "Risks are accepted" });
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/og3-decision");
  });

  it("warns that Reject is final and sends the chosen stage when sending back", async () => {
    current = at();
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "OG3 decision" });
    await user.click(within(form).getByRole("radio", { name: "Reject" }));
    expect(within(form).getByText(/Reject is final/)).toBeInTheDocument();
    await user.click(within(form).getByRole("radio", { name: "Send back" }));
    await user.selectOptions(within(form).getByLabelText("Send back to"), "FIRST_ROUND");
    await user.type(within(form).getByLabelText("Comment"), "Start over");
    await user.click(within(form).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ decision: "SEND_BACK", sendBackTo: "FIRST_ROUND", comment: "Start over" });
  });

  it("offers no form to someone who doesn't decide", async () => {
    current = at({ og3: { canDecide: false, sendBackTargets: [] } });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/Business System Owner \(or an Admin/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "OG3 decision" })).not.toBeInTheDocument();
  });

  it("shows a rejected System as closed, with the decision and no form", async () => {
    current = at({
      og3: null,
      closed: true,
      closedAt: "OG3",
      decisions: [{ gate: "OG3", outcome: "REJECT", sentBackTo: null, comment: "Too risky", justification: null, decidedAt: "2026-11-10T10:00:00.000Z", by: "Bea" }],
    });
    render(<SystemEvaluation systemId="s1" />);
    expect((await screen.findAllByText(/read-only/)).length).toBeGreaterThan(0);
    expect(screen.getByText("Rejected at OG3")).toBeInTheDocument();
    expect(screen.getByText(/Too risky/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "OG3 decision" })).not.toBeInTheDocument();
  });

  it("shows an authorized System as ATO", async () => {
    current = at({ og3: null, authorized: true });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText("Authorized to operate (ATO)")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "OG3 decision" })).not.toBeInTheDocument();
  });
});

describe("Evaluation tab: the Full track's first half (#331)", () => {
  const full = (over: Partial<EvaluationView>) => evaluation({ track: "FULL", firstRound: null, og1: { open: false, track: "FULL", participants: [] }, ...over });
  const oagParticipant = (over: Partial<EvaluationOagParticipantView> = {}): EvaluationOagParticipantView => ({
    reviewGroupId: "g1",
    name: "Security group",
    recommendation: null,
    reopened: null,
    canGive: false,
    ...over,
  });
  const given = (kind: RecommendationKind, comment: string) => ({ kind, comment, givenAt: "2026-11-10T10:00:00.000Z", by: null });

  beforeEach(() => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return respond(writeBody, writeStatus);
      if (url.endsWith("/documents")) return respond({ documents: [], canEdit: false });
      if (url.endsWith("/risk-analyses")) return respond({ riskAnalyses: [] });
      if (url.endsWith("/risks")) return respond({ risks: [] });
      return respond({ evaluation: current });
    });
  });

  it("posts a Qualification decision (Yes) to its own route", async () => {
    current = full({ stage: "QUALIFICATION", qualification: { canDecide: true, sendBackTargets: ["FIRST_ROUND", "OG1"] } });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "Qualification decision" });
    await user.type(within(form).getByLabelText("Comment"), "Worth it");
    await user.click(within(form).getByRole("button", { name: "Qualify the System" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/qualification-decision");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ decision: "AUTHORIZE", comment: "Worth it" });
  });

  it("offers no Qualification form to someone who doesn't decide", async () => {
    current = full({ stage: "QUALIFICATION", qualification: { canDecide: false, sendBackTargets: [] } });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/Business System Owner \(or an Admin/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Qualification decision" })).not.toBeInTheDocument();
  });

  it("keeps the first-documentation Submit off until every Document Requirement is provided", async () => {
    current = full({ stage: "FIRST_DOCUMENTATION", firstDocumentation: { documentsMissing: [{ id: "d1", name: "Architecture description" }], ready: false } });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/Not yet provided: Architecture description/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit the first documentation" })).toBeDisabled();
  });

  it("submits the first documentation when everything is provided", async () => {
    current = full({ stage: "FIRST_DOCUMENTATION", firstDocumentation: { documentsMissing: [], ready: true } });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    await user.click(await screen.findByRole("button", { name: "Submit the first documentation" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/submit-first-documentation");
  });

  it("shows each group's Recommendation and posts one for a group the viewer answers for", async () => {
    current = full({
      stage: "OAG_REVIEW_1",
      oag: {
        open: true,
        participants: [oagParticipant({ reviewGroupId: null, name: "Base review", recommendation: given("RECOMMEND", "All good") }), oagParticipant({ canGive: true })],
      },
    });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText("All good")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 Recommendations given")).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Recommendation for Security group" });
    await user.click(within(form).getByRole("radio", { name: "Recommend with conditions" }));
    await user.type(within(form).getByLabelText(/Comment/), "Patch first");
    await user.click(within(form).getByRole("button", { name: "Give Recommendation" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/recommendations");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ reviewGroupId: "g1", kind: "RECOMMEND_WITH_CONDITIONS", comment: "Patch first" });
  });

  it("asks for a justification to proceed at OG2 when a group advised against", async () => {
    current = full({
      stage: "OG2",
      oag: { open: false, participants: [oagParticipant({ recommendation: given("ADVISE_AGAINST", "Too exposed") })] },
      og2: { canDecide: true, sendBackTargets: ["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1"], adviseAgainst: true },
    });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "OG2 decision" });
    expect(screen.getByText("Too exposed")).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Comment"), "Proceed");
    const button = within(form).getByRole("button", { name: "Proceed" });
    expect(button).toBeDisabled();
    await user.type(within(form).getByLabelText(/Justification/), "Mitigated by the gateway");
    await user.click(button);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe("/api/systems/s1/evaluation/og2-decision");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ decision: "AUTHORIZE", comment: "Proceed", justification: "Mitigated by the gateway" });
  });

  it("needs no justification at OG2 when nobody advised against", async () => {
    current = full({
      stage: "OG2",
      oag: { open: false, participants: [oagParticipant({ recommendation: given("RECOMMEND", "Fine") })] },
      og2: { canDecide: true, sendBackTargets: ["FIRST_ROUND"], adviseAgainst: false },
    });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    const form = await screen.findByRole("form", { name: "OG2 decision" });
    expect(within(form).queryByLabelText(/Justification/)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText("Comment"), "Go");
    expect(within(form).getByRole("button", { name: "Proceed" })).toBeEnabled();
  });

  it("shows the justification next to the Advise-against once the System has proceeded", async () => {
    current = full({
      stage: "SECOND_ROUND",
      oag: { open: false, participants: [oagParticipant({ recommendation: given("ADVISE_AGAINST", "Too exposed") })] },
      og2Justification: "Mitigated by the gateway",
    });
    const user = userEvent.setup();
    render(<SystemEvaluation systemId="s1" />);
    await user.click(await screen.findByRole("button", { name: /^OG2/ }));
    expect(await screen.findByText(/Mitigated by the gateway/)).toBeInTheDocument();
  });
});
