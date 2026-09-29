import { render, screen } from "@testing-library/react";
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
    render(<ControlAssessmentList systemId="s1" userRole="REVIEWER" currentUserId="rev" systemOwnerId="owner" />);

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
});
