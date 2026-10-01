import { fireEvent, render, screen, within } from "@testing-library/react";
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
