import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlAssessmentList } from "../ControlAssessmentList";

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
