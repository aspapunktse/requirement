import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlAssessmentList } from "../ControlAssessmentList";
import { resolveEffectiveStatus, type InheritanceSource } from "@/lib/effective-status";

const assessments = [
  {
    control: {
      id: "c1",
      code: "A.5.1",
      title: "Policies for information security",
      description: "Have policies.",
      category: "Organizational",
      mandatory: true,
      question: "Do you have policies?",
    },
    assessment: {
      id: "a1",
      status: "IN_PROGRESS",
      evidence: "Policy doc v2",
      notes: null,
      selfAssessmentAnswer: null,
      queries: [
        {
          id: "q1",
          resolved: false,
          lastMessageAuthorId: "owner",
          createdAt: "2026-09-01T00:00:00Z",
          messages: [
            {
              id: "m1",
              body: "Which version?",
              createdAt: "2026-09-01T00:00:00Z",
              author: { id: "owner", name: "Owner", role: "SYSTEM_OWNER" },
            },
          ],
        },
      ],
    },
  },
];

describe("ControlAssessmentList", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ assessments, staleAssessments: [] }), { status: 200 })),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers the edit form, Self-Assessment answers and query actions by default", async () => {
    render(<ControlAssessmentList systemId="s1" userRole="ADMIN" currentUserId="admin" systemOwnerId="owner" />);

    expect(await screen.findByLabelText("Status for A.5.1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("in readOnly mode shows Assessments and Queries with no way to change them (#71)", async () => {
    render(
      <ControlAssessmentList
        systemId="s1"
        userRole="COMPLIANCE_MANAGER"
        currentUserId="cm"
        systemOwnerId="owner"
        readOnly
      />,
    );

    expect(await screen.findByText("A.5.1 — Policies for information security")).toBeInTheDocument();
    expect(screen.getByText("Policy doc v2")).toBeInTheDocument();
    expect(screen.getByText("Which version?")).toBeInTheDocument();

    expect(screen.queryByLabelText("Status for A.5.1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("with no Assessment edit access hides the edit form and answers but keeps query actions (#78)", async () => {
    render(
      <ControlAssessmentList
        systemId="s1"
        userRole="REVIEWER"
        currentUserId="rev"
        systemOwnerId="owner"
        assessmentEditAccess="none"
      />,
    );

    expect(await screen.findByText("A.5.1 — Policies for information security")).toBeInTheDocument();
    expect(screen.getByText("Policy doc v2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status for A.5.1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "N/A" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("with waive-only access offers just Waived / Not Applicable / N/A, and Save only once one is picked (#78)", async () => {
    render(
      <ControlAssessmentList
        systemId="s1"
        userRole="RISK_OWNER"
        currentUserId="ro"
        systemOwnerId="owner"
        assessmentEditAccess="waive-only"
      />,
    );

    const select = await screen.findByLabelText("Status for A.5.1");
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.filter((o) => !o.disabled).map((o) => o.textContent)).toEqual(["Not Applicable", "Waived"]);
    expect(screen.queryByLabelText("Evidence for A.5.1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "N/A" })).toBeInTheDocument();

    // The current status (In Progress) is shown but can't be saved as-is.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "WAIVED" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("ControlAssessmentList waive options on a System the user owns (#97)", () => {
  const row = (code: string, mandatory: boolean) => ({
    control: {
      id: `c-${code}`,
      code,
      title: `Control ${code}`,
      description: "Desc",
      category: "Organizational",
      mandatory,
      question: `Do you do ${code}?`,
    },
    assessment: { id: `a-${code}`, status: "IN_PROGRESS", evidence: null, notes: null, selfAssessmentAnswer: null, queries: [] },
  });
  const rows = [row("MAND-1", true), row("OPT-1", false)];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ assessments: rows, staleAssessments: [] }), { status: 200 })),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function enabledOptions(code: string) {
    const select = screen.getByLabelText(`Status for ${code}`);
    return Array.from(select.querySelectorAll("option"))
      .filter((o) => !o.disabled)
      .map((o) => o.textContent);
  }

  function answerButtons(code: string) {
    const control = screen.getByText(`Do you do ${code}?`).parentElement!;
    return within(control)
      .getAllByRole("button")
      .map((b) => b.textContent);
  }

  it("hides Waived / Not Applicable and the N/A answer on mandatory Controls from an owning Risk Owner, but keeps them on non-mandatory ones", async () => {
    render(<ControlAssessmentList systemId="s1" userRole="RISK_OWNER" currentUserId="ro" systemOwnerId="ro" />);
    await screen.findByLabelText("Status for MAND-1");

    expect(enabledOptions("MAND-1")).toEqual(["Not Started", "In Progress", "Fulfilled"]);
    expect(answerButtons("MAND-1")).toEqual(["Yes", "No"]);

    expect(enabledOptions("OPT-1")).toEqual(["Not Started", "In Progress", "Fulfilled", "Not Applicable", "Waived"]);
    expect(answerButtons("OPT-1")).toEqual(["Yes", "No", "N/A"]);
  });

  it("still offers an Admin who owns the System every option on mandatory Controls", async () => {
    render(<ControlAssessmentList systemId="s1" userRole="ADMIN" currentUserId="admin" systemOwnerId="admin" />);
    await screen.findByLabelText("Status for MAND-1");

    expect(enabledOptions("MAND-1")).toEqual(["Not Started", "In Progress", "Fulfilled", "Not Applicable", "Waived"]);
    expect(answerButtons("MAND-1")).toEqual(["Yes", "No", "N/A"]);
  });

  it("still offers a Risk Owner who doesn't own the System Waived / Not Applicable / N/A on mandatory Controls", async () => {
    render(
      <ControlAssessmentList
        systemId="s1"
        userRole="RISK_OWNER"
        currentUserId="ro"
        systemOwnerId="someone-else"
        assessmentEditAccess="waive-only"
      />,
    );
    await screen.findByLabelText("Status for MAND-1");

    expect(enabledOptions("MAND-1")).toEqual(["Not Applicable", "Waived"]);
    expect(answerButtons("MAND-1")).toEqual(["N/A"]);
  });

  it("disables Save for an owning Risk Owner on a mandatory Control already waived by someone else", async () => {
    const waived = { ...rows[0], assessment: { ...rows[0].assessment, status: "WAIVED", notes: "Admin exception" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ assessments: [waived], staleAssessments: [] }), { status: 200 })),
      ),
    );
    render(<ControlAssessmentList systemId="s1" userRole="RISK_OWNER" currentUserId="ro" systemOwnerId="ro" />);

    const select = (await screen.findByLabelText("Status for MAND-1")) as HTMLSelectElement;
    expect(select.value).toBe("WAIVED");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "FULFILLED" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("ControlAssessmentList removing a stale Assessment (#109)", () => {
  const staleRow = (queries: unknown[] = []) => ({
    id: "stale-a1",
    status: "FULFILLED",
    evidence: "Old evidence",
    notes: null,
    selfAssessmentAnswer: null,
    control: {
      id: "stale-c1",
      code: "STALE-1",
      title: "Stale Control",
      description: "Desc",
      category: "Organizational",
      mandatory: false,
      question: null,
    },
    queries,
  });
  const openQuery = {
    id: "sq1",
    resolved: false,
    lastMessageAuthorId: "reviewer",
    createdAt: "2026-09-01T00:00:00Z",
    messages: [
      {
        id: "sm1",
        body: "Still true?",
        createdAt: "2026-09-01T00:00:00Z",
        author: { id: "reviewer", name: "Reviewer", role: "REVIEWER" },
      },
    ],
  };
  const resolvedQuery = { ...openQuery, id: "sq2", resolved: true };

  function stubFetch(stale: unknown[], onDelete?: () => Response) {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(onDelete ? onDelete() : new Response(JSON.stringify({ removed: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ assessments: [], staleAssessments: stale }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["the System's owner", "SYSTEM_OWNER", "owner", "owner"],
    ["an owning Risk Owner", "RISK_OWNER", "ro", "ro"],
    ["an Admin who doesn't own the System", "ADMIN", "admin", "owner"],
  ] as const)("offers Remove to %s", async (_label, role, userId, ownerId) => {
    stubFetch([staleRow()]);
    render(<ControlAssessmentList systemId="s1" userRole={role} currentUserId={userId} systemOwnerId={ownerId} />);

    expect(await screen.findByText("STALE-1 — Stale Control")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it.each([
    ["a SYSTEM_OWNER who doesn't own the System", "SYSTEM_OWNER", "other", "owner", false],
    ["a Reviewer", "REVIEWER", "reviewer", "owner", false],
    ["a Risk Owner who doesn't own the System", "RISK_OWNER", "ro", "owner", false],
    ["a Compliance Manager, even as the recorded owner", "COMPLIANCE_MANAGER", "cm", "cm", false],
    ["an owner on a read-only page", "SYSTEM_OWNER", "owner", "owner", true],
  ] as const)("hides Remove from %s", async (_label, role, userId, ownerId, readOnly) => {
    stubFetch([staleRow()]);
    render(
      <ControlAssessmentList
        systemId="s1"
        userRole={role}
        currentUserId={userId}
        systemOwnerId={ownerId}
        readOnly={readOnly}
      />,
    );

    expect(await screen.findByText("STALE-1 — Stale Control")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows a note instead of the button while an open question exists, and offers it once only resolved ones remain", async () => {
    stubFetch([staleRow([openQuery])]);
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" />);

    expect(await screen.findByText(/can't be removed while it has an open question/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();

    stubFetch([staleRow([resolvedQuery])]);
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" />);
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("never offers Remove on an applicable Assessment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ assessments, staleAssessments: [] }), { status: 200 }))),
    );
    render(<ControlAssessmentList systemId="s1" userRole="ADMIN" currentUserId="admin" systemOwnerId="owner" />);

    await screen.findByLabelText("Status for A.5.1");
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("asks to confirm, then removes the row from the list", async () => {
    const fetchMock = stubFetch([staleRow()]);
    const confirm = vi.spyOn(window, "confirm");
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" />);

    // Declined: nothing is sent.
    confirm.mockReturnValueOnce(false);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(screen.getByText("STALE-1 — Stale Control")).toBeInTheDocument();

    // Confirmed: DELETE, then the row is gone (and so is the now-empty section).
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("STALE-1 — Stale Control")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/assessments/stale-c1", { method: "DELETE" });
    expect(screen.queryByText("No Longer Applicable")).not.toBeInTheDocument();
  });

  it("keeps the row and shows the server's message when removal is refused", async () => {
    stubFetch([staleRow()], () => new Response(JSON.stringify({ error: "This Control still applies; set its status instead" }), { status: 409 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("This Control still applies; set its status instead")).toBeInTheDocument();
    expect(screen.getByText("STALE-1 — Stale Control")).toBeInTheDocument();
  });
});

describe("ControlAssessmentList: effective status and its source (#121)", () => {
  const organization = (status: InheritanceSource["status"]): InheritanceSource => ({ kind: "ORGANIZATION", type: "FULL", status });
  const control = { id: "b1", code: "A.5.15", title: "Access control", description: "d", category: "Organizational", mandatory: true, question: null };
  const assessmentOf = (status: string, assessedById: string | null) => ({
    id: "ba1",
    status,
    evidence: null,
    notes: null,
    selfAssessmentAnswer: null,
    assessedById,
    queries: [],
  });
  const row = (own: ReturnType<typeof assessmentOf> | null, sources: InheritanceSource[]) => ({
    control,
    assessment: own,
    effective: resolveEffectiveStatus(own ? { status: own.status as never, personSet: own.assessedById !== null } : null, sources),
  });

  function stubFetch(rows: unknown[], onPatch?: (body: { status: string }) => Response) {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Promise.resolve(onPatch!(JSON.parse(init.body as string)));
      return Promise.resolve(new Response(JSON.stringify({ assessments: rows, staleAssessments: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const renderList = () =>
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" />);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an untouched Both Control as Fulfilled, Inherited from Organization, while the form still edits the System's own status", async () => {
    stubFetch([row(assessmentOf("NOT_STARTED", null), [organization("FULFILLED")])]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(item.getByText(/Source: Inherited from Organization · Organization: Fulfilled/)).toBeInTheDocument();
    expect(item.getByText(/Saving a status below sets this System's own Assessment/)).toBeInTheDocument();
    expect(item.getByLabelText("Status for A.5.15")).toHaveValue("NOT_STARTED");
  });

  it("shows a Control with no Assessment row as inherited too", async () => {
    stubFetch([row(null, [organization("FULFILLED")])]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(item.getByText(/Source: Inherited from Organization/)).toBeInTheDocument();
  });

  it("shows the Organization's status even when it gives no credit, and the Control as System-specific", async () => {
    stubFetch([row(assessmentOf("NOT_STARTED", null), [organization("WAIVED")])]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText("Not Started", { selector: "span" })).toBeInTheDocument();
    expect(item.getByText(/Source: System-specific · Organization: Waived \(gives no credit\)/)).toBeInTheDocument();
    expect(item.queryByText(/Saving a status below/)).not.toBeInTheDocument();
  });

  it("says in one line when the System's own person-set Assessment overrides a Fulfilled Organization", async () => {
    stubFetch([row(assessmentOf("IN_PROGRESS", "owner"), [organization("FULFILLED")])]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText(/Source: System-specific · Organization: Fulfilled/)).toBeInTheDocument();
    expect(item.getByText(/This System's own Assessment \(In Progress\) overrides the Organization's Fulfilled status\./)).toBeInTheDocument();
  });

  it("names a Per-System Control System-specific, with no other source", async () => {
    stubFetch([row(assessmentOf("FULFILLED", "owner"), [])]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText("Source: System-specific")).toBeInTheDocument();
  });

  it("after the owner saves a status, that own Assessment decides and the inherited one is overridden", async () => {
    const fetchMock = stubFetch([row(assessmentOf("NOT_STARTED", null), [organization("FULFILLED")])], (body) =>
      new Response(JSON.stringify({ assessment: assessmentOf(body.status, "owner") }), { status: 200 }),
    );
    renderList();

    const select = await screen.findByLabelText("Status for A.5.15");
    fireEvent.change(select, { target: { value: "IN_PROGRESS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/overrides the Organization's Fulfilled status/)).toBeInTheDocument();
    const item = within(screen.getByText("A.5.15 — Access control").closest("li")!);
    expect(item.getByText(/Source: System-specific · Organization: Fulfilled/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true);
  });

  it("falls back to the own status when the response carries no effective status", async () => {
    stubFetch([{ control, assessment: assessmentOf("WAIVED", "owner") }]);
    renderList();

    const item = within((await screen.findByText("A.5.15 — Access control")).closest("li")!);
    expect(item.getByText("Waived", { selector: "span" })).toBeInTheDocument();
    expect(item.queryByText(/Source:/)).not.toBeInTheDocument();
  });
});

describe("ControlAssessmentList: reset to inherited (#129)", () => {
  const organization = (status: InheritanceSource["status"]): InheritanceSource => ({ kind: "ORGANIZATION", type: "FULL", status });
  const control = { id: "b1", code: "A.5.15", title: "Access control", description: "d", category: "Organizational", mandatory: true, question: null };
  const openQuery = {
    id: "rq1",
    resolved: false,
    lastMessageAuthorId: "reviewer",
    createdAt: "2026-09-01T00:00:00Z",
    messages: [
      { id: "rm1", body: "Which policy?", createdAt: "2026-09-01T00:00:00Z", author: { id: "reviewer", name: "Reviewer", role: "REVIEWER" } },
    ],
  };
  type TestAssessment = {
    id: string;
    status: string;
    evidence: string | null;
    notes: string | null;
    selfAssessmentAnswer: null;
    assessedById: string | null;
    queries: unknown[];
  };
  const personSet: TestAssessment = {
    id: "ba1",
    status: "IN_PROGRESS",
    evidence: "Policy doc v2",
    notes: "Working on it",
    selfAssessmentAnswer: null,
    assessedById: "owner",
    queries: [openQuery],
  };
  const untouched: TestAssessment = { ...personSet, status: "NOT_STARTED", evidence: null, notes: null, assessedById: null, queries: [] };
  const rowOf = (own: TestAssessment | null, sources: InheritanceSource[]) => ({
    control,
    assessment: own,
    effective: resolveEffectiveStatus(own ? { status: own.status as never, personSet: own.assessedById !== null } : null, sources),
  });
  // What the server returns after a reset: the same row, untouched, Queries still on it.
  const resetResponse = (sources: InheritanceSource[]) => rowOf({ ...untouched, queries: [openQuery] }, sources);

  function stubFetch(rows: unknown[], onReset?: () => Response) {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(onReset!());
      return Promise.resolve(new Response(JSON.stringify({ assessments: rows, staleAssessments: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const renderList = (props: Partial<React.ComponentProps<typeof ControlAssessmentList>> = {}) =>
    render(<ControlAssessmentList systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" {...props} />);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["the System's owner", "SYSTEM_OWNER", "owner"],
    ["an owning Risk Owner", "RISK_OWNER", "owner"],
    ["an Admin who doesn't own the System", "ADMIN", "admin"],
  ] as const)("offers the action to %s on a person-set Assessment of a Control with a source", async (_label, role, userId) => {
    stubFetch([rowOf(personSet, [organization("FULFILLED")])]);
    renderList({ userRole: role, currentUserId: userId });

    expect(await screen.findByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });

  it("offers it whatever the source's status, since the Control just goes back to what the source gives", async () => {
    stubFetch([rowOf(personSet, [organization("WAIVED")])]);
    renderList();

    expect(await screen.findByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });

  it.each([
    ["an untouched Assessment", () => rowOf(untouched, [organization("FULFILLED")])],
    ["a Control with no Assessment row", () => rowOf(null, [organization("FULFILLED")])],
    ["a Control with no inheritance source", () => rowOf(personSet, [])],
    ["a row the API sent without an effective status", () => ({ control, assessment: personSet })],
  ])("doesn't offer it on %s", async (_label, makeRow) => {
    stubFetch([makeRow()]);
    renderList();

    await screen.findByText("A.5.15 — Access control");
    expect(screen.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it.each([
    ["a SYSTEM_OWNER who doesn't own the System", { userRole: "SYSTEM_OWNER", currentUserId: "other" }],
    ["a Reviewer", { userRole: "REVIEWER", currentUserId: "reviewer", assessmentEditAccess: "none" }],
    ["a Risk Owner who doesn't own the System (waive-only)", { userRole: "RISK_OWNER", currentUserId: "ro", assessmentEditAccess: "waive-only" }],
    ["a Risk Owner who doesn't own the System, even given full access", { userRole: "RISK_OWNER", currentUserId: "ro" }],
    ["a Compliance Manager, even as the recorded owner", { userRole: "COMPLIANCE_MANAGER", currentUserId: "owner" }],
    ["an owner on a read-only page", { readOnly: true }],
  ] as const)("hides it from %s", async (_label, props) => {
    stubFetch([rowOf(personSet, [organization("FULFILLED")])]);
    renderList(props);

    await screen.findByText("A.5.15 — Access control");
    expect(screen.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it("asks first, saying what is cleared and what stays, and sends nothing when declined", async () => {
    const fetchMock = stubFetch([rowOf(personSet, [organization("FULFILLED")])]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Reset to inherited" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain("A.5.15");
    expect(message).toMatch(/clears this System's own status, evidence, notes and Self-Assessment answer/);
    expect(message).toMatch(/Organization: Fulfilled/);
    expect(message).toMatch(/Assessment Queries and any Risks linked to it stay/);
    expect(message).toMatch(/Change Event log/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByLabelText("Status for A.5.15")).toHaveValue("IN_PROGRESS");
  });

  it("after a confirmed reset shows the effective status and source again, with the form back to Not Started and empty", async () => {
    const sources = [organization("FULFILLED")];
    const fetchMock = stubFetch([rowOf(personSet, sources)], () => new Response(JSON.stringify(resetResponse(sources)), { status: 200 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList();

    const select = await screen.findByLabelText("Status for A.5.15");
    expect(select).toHaveValue("IN_PROGRESS");
    expect(screen.getByLabelText("Evidence for A.5.15")).toHaveValue("Policy doc v2");
    fireEvent.click(screen.getByRole("button", { name: "Reset to inherited" }));

    expect(await screen.findByText(/Source: Inherited from Organization/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/assessments/b1/reset", { method: "POST" });
    const item = within(screen.getByText("A.5.15 — Access control").closest("li")!);
    expect(item.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(item.getByLabelText("Status for A.5.15")).toHaveValue("NOT_STARTED");
    expect(item.getByLabelText("Evidence for A.5.15")).toHaveValue("");
    expect(item.getByLabelText("Notes for A.5.15")).toHaveValue("");
    // Nothing left to reset, and the Query stays.
    expect(item.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
    expect(item.getByText("Which policy?")).toBeInTheDocument();
  });

  it("shows the Control as Not Started, System-specific, when the source gives no credit", async () => {
    const sources = [organization("WAIVED")];
    stubFetch([rowOf(personSet, sources)], () => new Response(JSON.stringify(resetResponse(sources)), { status: 200 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Reset to inherited" }));

    expect(await screen.findByText(/Source: System-specific · Organization: Waived \(gives no credit\)/)).toBeInTheDocument();
    const item = within(screen.getByText("A.5.15 — Access control").closest("li")!);
    expect(item.getByText("Not Started", { selector: "span" })).toBeInTheDocument();
    expect(item.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it("keeps the row and shows the server's message when the reset is refused", async () => {
    stubFetch(
      [rowOf(personSet, [organization("FULFILLED")])],
      () => new Response(JSON.stringify({ error: "This Assessment was not set by a person, so it already follows the Control's inheritance sources" }), { status: 409 }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Reset to inherited" }));

    expect(await screen.findByText(/was not set by a person/)).toBeInTheDocument();
    expect(screen.getByLabelText("Status for A.5.15")).toHaveValue("IN_PROGRESS");
    expect(screen.getByRole("button", { name: "Reset to inherited" })).toBeEnabled();
  });

  it("offers the action after the owner saves a status over an inherited Control", async () => {
    const sources = [organization("FULFILLED")];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          return Promise.resolve(new Response(JSON.stringify({ assessment: { ...personSet, status: body.status, queries: undefined } }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ assessments: [rowOf(untouched, sources)], staleAssessments: [] }), { status: 200 }));
      }),
    );
    renderList();

    const select = await screen.findByLabelText("Status for A.5.15");
    expect(screen.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "IN_PROGRESS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });
});
