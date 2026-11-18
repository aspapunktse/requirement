import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerData, PlannerInitial } from "@/lib/audit-planner";
import type { PlanPreview } from "@/lib/check-ups";
import { AuditPlanner } from "../AuditPlanner";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, back: vi.fn() }) }));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const FUTURE = "2999-01-01";

const data: PlannerData = {
  controls: [
    { id: "c1", code: "SEC-001", title: "Access control", applicability: "PER_SYSTEM", category: "Security", question: "Is access reviewed?", lastAudited: daysAgo(30) },
    { id: "c2", code: "ORG-002", title: "Policy review", applicability: "ORGANIZATIONAL", category: "Governance", question: null, lastAudited: null },
    { id: "c3", code: "SEC-003", title: "Backups", applicability: "BOTH", category: "Security", question: "Are backups tested?", lastAudited: daysAgo(500) },
  ],
  systems: [
    { id: "s1", name: "Payroll", vendor: "Acme", status: "ONBOARDED", ownerName: "Olle", deploymentFacets: ["Cloud SaaS"] },
    { id: "s2", name: "Wiki", vendor: null, status: "DRAFT", ownerName: "Pia", deploymentFacets: [] },
  ],
  repeatable: [
    { id: "a1", title: "Q3 access review", status: "CLOSED", launchedAt: daysAgo(120), controlIds: ["c1", "c3"], systemIds: ["s1"], includeOrganization: true },
    { id: "a2", title: "Q2 review", status: "LAUNCHED", launchedAt: daysAgo(200), controlIds: ["c1"], systemIds: [], includeOrganization: false },
    { id: "a3", title: "Q1 review", status: "CLOSED", launchedAt: daysAgo(300), controlIds: ["c3"], systemIds: ["s2"], includeOrganization: false },
  ],
};
const filterOptions = {
  frameworks: [{ id: "f1", name: "NIS2", version: "2022" }],
  deploymentFacets: [{ id: "d1", name: "Cloud SaaS" }],
  businessUnits: [{ id: "b1", name: "Finance" }],
};

const answer: PlanPreview = {
  summary: "6 Check-ups: 4 System-level and 2 Organization-level",
  systemCheckUpCount: 4,
  organizationCheckUpCount: 2,
  skippedCount: 1,
  blockers: [],
  perControl: { c1: 2, c2: 1, c3: 3 },
  recipients: [{ id: "u1", name: "Olle Ek", roles: ["System Owner"], fromThisAudit: 4, alreadyOpen: 3 }],
} as unknown as PlanPreview;

type Calls = [string, RequestInit | undefined][];
let previewAnswer: Partial<PlanPreview> | "fail" = {};
let saveResponse: { status: number; body: unknown } = { status: 201, body: { internalAudit: { id: "new1" } } };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/internal-audits/preview") {
        if (previewAnswer === "fail") return Promise.resolve(new Response("{}", { status: 500 }));
        return Promise.resolve(new Response(JSON.stringify({ preview: { ...answer, ...previewAnswer } }), { status: 200 }));
      }
      if (url.startsWith("/api/internal-audits/system-filter")) {
        return Promise.resolve(
          new Response(JSON.stringify({ systems: [{ id: "s1", name: "Payroll", vendor: "Acme", status: "ONBOARDED", deploymentFacets: [], businessUnits: [] }, { id: "s9", name: "Late System", vendor: null, status: "DRAFT", deploymentFacets: [], businessUnits: [] }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(saveResponse.body), { status: saveResponse.status }));
    }),
  );
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as Calls;
const saveCall = () => calls().find(([url]) => !url.includes("/preview") && !url.includes("system-filter"))!;
const previewBodies = () => calls().filter(([url]) => url === "/api/internal-audits/preview").map(([, init]) => JSON.parse(init!.body as string));
const renderPlanner = (initial?: PlannerInitial) => render(<AuditPlanner data={data} filterOptions={filterOptions} initial={initial} />);

describe("AuditPlanner (#393)", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    previewAnswer = {};
    saveResponse = { status: 201, body: { internalAudit: { id: "new1" } } };
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names everything missing and sends nothing when saved empty", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("A title is required")).toBeInTheDocument();
    expect(within(alert).getByText("Pick at least one Control")).toBeInTheDocument();
    expect(within(alert).getByText("A due date is required")).toBeInTheDocument();
    expect(within(alert).getByText("Pick at least one System or include the Organization")).toBeInTheDocument();
    expect(saveCall()).toBeUndefined();
  });

  it("refuses a past due date and says so beside the date", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Title"), "Review");
    await user.click(screen.getByLabelText("Pick SEC-001"));
    await user.click(screen.getByRole("switch", { name: "Include the Organization" }));
    await user.type(screen.getByLabelText("Due date"), "2001-01-01");
    expect(screen.getAllByText("The due date can't be in the past").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The due date can't be in the past");
    expect(saveCall()).toBeUndefined();
  });

  it("shows the working days left and warns when the due date is tight", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    expect(screen.getByText(/working days left/)).toBeInTheDocument();
    expect(screen.queryByText(/Tight/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2 weeks" }));
    expect(screen.getByLabelText("Due date")).not.toHaveValue(FUTURE);
    expect(screen.getByText(/working days? left/)).toBeInTheDocument();
  });

  it("adds every Control due for audit from the built-in card and suggests a title", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole("button", { name: /Not audited in 12 months/ }));

    expect(screen.getByLabelText("Pick ORG-002")).toBeChecked();
    expect(screen.getByLabelText("Pick SEC-003")).toBeChecked();
    expect(screen.getByLabelText("Pick SEC-001")).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /Use .*Not audited in 12 months/ }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toContain("Not audited in 12 months");
  });

  it("repeats one of the two latest audits, or an earlier one from More, copying Controls, Systems and the Organization", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole("button", { name: /Repeat Q3 access review/ }));
    expect(screen.getByLabelText("Pick SEC-001")).toBeChecked();
    expect(screen.getByLabelText("Pick SEC-003")).toBeChecked();
    expect(screen.getByLabelText("Pick ORG-002")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^Payroll/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Include the Organization" })).toBeChecked();
    expect(screen.getByText(/Questions are not copied/)).toBeInTheDocument();

    // Only the two latest have a card; the rest are behind More.
    expect(screen.queryByRole("button", { name: /Repeat Q1 review/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /More/ }));
    await user.click(within(screen.getByRole("group", { name: "Earlier audits" })).getByRole("button", { name: /Q1 review/ }));
    expect(screen.getByRole("button", { name: /^Wiki/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("asks the server what the picks would generate and shows the Check-ups, recipients and already-open counts", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByLabelText("Pick SEC-001"));
    await user.click(screen.getByRole("button", { name: /^Payroll/ }));

    await waitFor(() => expect(screen.getByTestId("plan-summary")).toHaveTextContent("6 Check-ups: 4 System-level and 2 Organization-level."));
    expect(previewBodies().at(-1)).toMatchObject({ controlIds: ["c1"], systemIds: ["s1"], includeOrganization: false, firstQuestions: {} });
    expect(screen.getByText("Olle Ek")).toBeInTheDocument();
    expect(screen.getByText(/3 already open/)).toBeInTheDocument();
    expect(screen.getByLabelText("2 Check-ups")).toBeInTheDocument(); // SEC-001's row
  });

  it("shows what blocks the launch, and a link that opens the question of the Control", async () => {
    previewAnswer = { blockers: [{ kind: "no-questions", message: "1 Control has no question", controlIds: ["c2"] }] };
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByLabelText("Pick ORG-002"));
    await user.click(screen.getByRole("switch", { name: "Include the Organization" }));

    const blockers = screen.getByRole("list", { name: "Before it can launch" });
    expect(await within(blockers).findByText("1 Control has no question")).toBeInTheDocument();
    await user.click(within(blockers).getByRole("button", { name: "Write the first" }));
    expect(screen.getByLabelText("First question for ORG-002")).toBeInTheDocument();
  });

  it("opens the question of a Control the search hides when \"Write the first\" is clicked", async () => {
    previewAnswer = { blockers: [{ kind: "no-questions", message: "1 Control has no question", controlIds: ["c2"] }] };
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByLabelText("Pick ORG-002"));
    await user.click(screen.getByRole("switch", { name: "Include the Organization" }));
    await user.type(screen.getByLabelText("Search Controls by code, title or question"), "backups");
    expect(screen.queryByLabelText("Pick ORG-002")).not.toBeInTheDocument();

    const blockers = screen.getByRole("list", { name: "Before it can launch" });
    await within(blockers).findByText("1 Control has no question");
    await user.click(within(blockers).getByRole("button", { name: "Write the first" }));
    expect(screen.getByLabelText("First question for ORG-002")).toBeInTheDocument();
  });

  it("keeps working when the preview can't be loaded", async () => {
    previewAnswer = "fail";
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Title"), "Review");
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    await user.click(screen.getByLabelText("Pick SEC-001"));
    await user.click(screen.getByRole("switch", { name: "Include the Organization" }));

    expect(await screen.findByText(/preview could not be updated/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/internal-audits/new1"));
  });

  it("filters the Controls by search, view and domain", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Search Controls by code, title or question"), "backups");
    expect(screen.queryByLabelText("Pick SEC-001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pick SEC-003")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search Controls by code, title or question"));
    await user.type(screen.getByLabelText("Search Controls by code, title or question"), "reviewed"); // matches a question
    expect(screen.getByLabelText("Pick SEC-001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pick SEC-003")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search Controls by code, title or question"));
    await user.click(screen.getByRole("button", { name: /Due for audit/ }));
    expect(screen.queryByLabelText("Pick SEC-001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pick ORG-002")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByRole("button", { name: /^Governance/ }));
    expect(screen.getByLabelText("Pick ORG-002")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pick SEC-003")).not.toBeInTheDocument();
  });

  it("adds the Systems the filter finds, including one the page did not load, and says how many were new", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole("button", { name: /^Payroll/ }));
    await user.selectOptions(screen.getByLabelText("Framework"), "f1");
    await user.click(screen.getByRole("button", { name: "Add matches" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Late System/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText(/2 Systems match: 1 added, 1 already picked/)).toBeInTheDocument();
    expect(calls().find(([url]) => url.startsWith("/api/internal-audits/system-filter"))![0]).toContain("frameworkId=f1");
  });

  it("posts the picks with only the first questions that were edited, and goes to the new audit", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Title"), "Access review");
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    await user.click(screen.getByLabelText("Pick SEC-001"));
    await user.click(screen.getByLabelText("Pick SEC-003"));
    await user.click(screen.getByRole("button", { name: /^Payroll/ }));
    await user.click(screen.getByRole("button", { name: "Question of SEC-001" }));
    const box = screen.getByLabelText("First question for SEC-001");
    await user.clear(box);
    await user.type(box, "Who reviews access?");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/internal-audits/new1"));
    const [url, init] = saveCall();
    expect(url).toBe("/api/internal-audits");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      title: "Access review",
      dueDate: FUTURE,
      includeOrganization: false,
      controlIds: ["c1", "c3"],
      systemIds: ["s1"],
      firstQuestions: { c1: "Who reviews access?" },
    });
  });

  it("shows the API's refusal and stays on the page", async () => {
    saveResponse = { status: 400, body: { problems: ["Pick at least one Control"] } };
    const user = userEvent.setup();
    renderPlanner();
    await user.type(screen.getByLabelText("Title"), "Access review");
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    await user.click(screen.getByLabelText("Pick SEC-001"));
    await user.click(screen.getByRole("switch", { name: "Include the Organization" }));
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Pick at least one Control")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  describe("editing a draft", () => {
    const initial: PlannerInitial = {
      id: "d1",
      title: "Draft audit",
      scopeDescription: "Scope",
      dueDate: FUTURE,
      includeOrganization: false,
      controlIds: ["c1"],
      systemIds: ["s1"],
      firstQuestions: { c1: "The draft's own question?" },
    };

    it("starts from the draft, patches it and doesn't resend a question that wasn't changed", async () => {
      const user = userEvent.setup();
      renderPlanner(initial);
      expect(screen.getByLabelText("Title")).toHaveValue("Draft audit");
      expect(screen.getByLabelText("Pick SEC-001")).toBeChecked();
      expect(screen.getByText("The draft's own question?")).toBeInTheDocument();

      await user.click(screen.getByLabelText("Pick SEC-003")); // a Control new to the draft starts from its own question
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/internal-audits/new1"));
      const [url, init] = saveCall();
      expect(url).toBe("/api/internal-audits/d1");
      expect(init!.method).toBe("PATCH");
      expect(JSON.parse(init!.body as string)).toMatchObject({ title: "Draft audit", controlIds: ["c1", "c3"], systemIds: ["s1"], firstQuestions: {} });
      await waitFor(() => expect(previewBodies().at(-1)).toMatchObject({ internalAuditId: "d1" }));
    });

    it("still shows the server's past-due blocker for a saved due date that has passed", async () => {
      previewAnswer = { blockers: [{ kind: "past-due-date", message: "The due date can't be in the past", controlIds: [] }] };
      renderPlanner({ ...initial, dueDate: "2001-01-01" });
      const blockers = screen.getByRole("list", { name: "Before it can launch" });
      expect(await within(blockers).findByText("The due date can't be in the past")).toBeInTheDocument();
    });

    it("doesn't refuse an unchanged due date that has since passed", async () => {
      const user = userEvent.setup();
      renderPlanner({ ...initial, dueDate: "2001-01-01" });
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(push).toHaveBeenCalled());
    });
  });
});
