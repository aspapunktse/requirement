import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationParticipantView, EvaluationView } from "@/lib/evaluation";
import { SystemEvaluation } from "../SystemEvaluation";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.setConfig({ testTimeout: 20_000 });

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const READY = { hasBusinessSystemOwner: true, riskAnalysisCompleted: true, mandatoryTotal: 4, mandatoryMissing: [], ready: true };
const NOT_READY = {
  hasBusinessSystemOwner: false,
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
  og1: null,
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
    expect(within(list).getByText(/No completed Risk Analysis yet/)).toBeInTheDocument();
    expect(within(list).getByText("3 of 4 mandatory first-round Controls have an Assessment")).toBeInTheDocument();
    expect(screen.getByText(/A\.5\.1 \(Policies\)/)).toBeInTheDocument();
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
    current = evaluation({ stage: "QUALIFICATION", track: "FULL", firstRound: null, og1: { open: false, track: "FULL", participants: [] } });
    render(<SystemEvaluation systemId="s1" />);
    expect(await screen.findByText(/isn't available yet/)).toBeInTheDocument();
  });
});
