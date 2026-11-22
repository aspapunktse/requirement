import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftAudit } from "../DraftAudit";
import type { InternalAuditPage } from "@/lib/internal-audit-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

function draft(blockers: { kind: string; message: string; controlIds: string[] }[]): InternalAuditPage {
  return {
    audit: {
      id: "a1",
      title: "Test #399 draft",
      scopeDescription: "Payroll",
      dueDate: "2026-12-20",
      status: "DRAFT",
      includeOrganization: true,
      createdBy: { id: "u9", name: "Ida Auditor" },
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      launchedAt: null,
      launchedBy: null,
      closedAt: null,
      closedBy: null,
      controls: [{ id: "c1", code: "SEC-001", title: "Access", applicability: "PER_SYSTEM", questions: ["Is access reviewed?"] }],
      systems: [{ id: "s1", name: "Payroll", status: "ONBOARDED" }],
    },
    daysUntilDue: 30,
    checkUps: [],
    counts: { evaluated: 0, withdrawn: 0, awaiting: 0, overdue: 0, notAnswered: 0, total: 0, open: 0 },
    findings: null,
    auditQuestions: { c1: ["Is access reviewed?", "Is MFA enforced?"] },
    plan: {
      summary: "2 Check-ups (1 System-level, 1 Organization-level)",
      systemCheckUpCount: 1,
      organizationCheckUpCount: 1,
      skippedCount: 0,
      skipped: [],
      blockers,
      perControl: { c1: 1 },
      recipients: [{ id: "u1", name: "Ana Owner", roles: ["System Owner"], fromThisAudit: 2, alreadyOpen: 0 }],
    },
  };
}

describe("DraftAudit (#399)", () => {
  beforeEach(() => vi.stubGlobal("confirm", vi.fn(() => true)));
  afterEach(() => vi.unstubAllGlobals());

  it("lets a writer edit, delete and launch a ready draft, and shows who would receive the Check-ups", () => {
    render(<DraftAudit page={draft([])} canWrite />);
    const aside = screen.getByRole("complementary", { name: "If launched now" });
    expect(aside.textContent).toContain("Nothing blocks the launch");
    expect(within(aside).getByRole("list", { name: "Recipients" }).textContent).toContain("Ana Owner");
    expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("link", { name: /Edit/ }).getAttribute("href")).toBe("/internal-audits/a1/edit");
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy();
    expect(screen.getByLabelText("Question 1 for SEC-001")).toBeTruthy();
  });

  it("lists what blocks the launch and disables Launch", () => {
    render(<DraftAudit page={draft([{ kind: "NO_CONTROL_OWNER", message: "No Control Owner for: SEC-001", controlIds: ["c1"] }])} canWrite />);
    expect(screen.getByRole("list", { name: "Launch blockers" }).textContent).toContain("No Control Owner for: SEC-001");
    expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a reader the questions and the launch preview but no edit, delete, launch or editor", () => {
    render(<DraftAudit page={draft([])} canWrite={false} />);
    expect(screen.getByText("Is access reviewed?")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "If launched now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Edit/ })).toBeNull();
    expect(screen.queryByLabelText("Question 1 for SEC-001")).toBeNull();
  });
});
