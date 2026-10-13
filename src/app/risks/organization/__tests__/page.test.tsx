import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { createCheckUpScenario } from "@/test/check-up-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import OrganizationRisksPage from "../page";

/** The Organization Risks page (#157) as each role sees it, as static markup. Fixtures only. */
describe("Organization Risks page (#157)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let checkUpId: string;

  const html = async (userId: string | null) => {
    acting.userId = userId;
    return renderToStaticMarkup(await OrganizationRisksPage());
  };

  beforeAll(async () => {
    s = await createCheckUpScenario("157p", { systemControls: 1, organizationControls: 1 });
    const checkUp = s.find(s.organizationControls[0].code, true);
    checkUpId = checkUp.id;
    await s.answer(checkUp.id, s.controlOwner);
    await evaluateCheckUp(checkUp.id, { id: s.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" }, { outcome: "NONCONFORMITY", comment: "Gap found" });
  });

  afterAll(async () => {
    await s.cleanup();
  });

  it("gives a Risk Owner and an Admin the Risk with its controls, linked to the finding", async () => {
    for (const role of ["RISK_OWNER", "ADMIN"] as const) {
      const page = await html(s.roleUser[role]);
      expect(page, role).toContain(s.organizationControls[0].code);
      expect(page, role).toContain(`Status for ${s.organizationControls[0].code}`);
      expect(page, role).toContain(`href="/check-ups/${checkUpId}"`);
      expect(page, role).toContain("Unassigned");
    }
  });

  it("lets the Internal Auditor read the Risk and change nothing", async () => {
    const page = await html(s.roleUser.INTERNAL_AUDITOR);
    expect(page).toContain(s.organizationControls[0].code);
    expect(page).toContain(`href="/check-ups/${checkUpId}"`);
    expect(page).not.toContain("Status for");
    expect(page).not.toContain("Save");
  });

  it("shows nothing to everyone else", async () => {
    for (const role of ["COMPLIANCE_MANAGER", "SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"] as const) {
      const page = await html(s.roleUser[role]);
      expect(page, role).toContain("not available to your role");
      expect(page, role).not.toContain(s.organizationControls[0].code);
    }
    expect(await html(null)).toContain("Pick a user to act as first");
  });
});
