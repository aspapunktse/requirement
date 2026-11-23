import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import type { BoundaryStatement } from "@/lib/boundary-statement-rules";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import { StatementPanel } from "../[id]/StatementPanel";
import StatementPage from "../[id]/statement/page";
import PrintPage from "../[id]/statement/print/page";

/** The export buttons and the print page (#421). The panel is a component test; the pages run against real Postgres with `Test #421 ...` fixtures. */
const statement = (over: Partial<BoundaryStatement["boundary"]> = {}): BoundaryStatement => ({
  boundary: { id: "b1", name: "ISMS scope", retired: false, ownerName: "Olle", ...over },
  canEdit: false,
  countedSystems: [],
  notYetOperating: [],
  closed: [],
  systems: [],
  sections: [
    { framework: { id: "f1", name: "ISO 27001", version: "2022", isBase: true }, met: 0, applicable: 0, percentage: null, rows: [] },
    { framework: { id: "f2", name: "NIS2", version: "1", isBase: false }, met: 0, applicable: 0, percentage: null, rows: [] },
  ],
});

describe("the export buttons on the statement panel", () => {
  it("offers a CSV export and a print page per Framework section, each for that Framework", () => {
    render(<StatementPanel statement={statement()} />);
    for (const id of ["f1", "f2"]) {
      const section = screen.getByTestId(`cb-st-fw-${id}`);
      const csv = within(section).getByRole("link", { name: "Export section (CSV)" });
      expect(csv).toHaveAttribute("href", `/api/compliance-boundaries/b1/statement/export?framework=${id}`);
      expect(csv).toHaveAttribute("download");
      const print = within(section).getByRole("link", { name: "Print section" });
      expect(print).toHaveAttribute("href", `/compliance-boundaries/b1/statement/print?framework=${id}`);
      expect(print).toHaveAttribute("target", "_blank");
    }
  });

  it("offers nothing for a retired Boundary", () => {
    render(<StatementPanel statement={statement({ retired: true })} />);
    expect(screen.queryByRole("link", { name: /Export|Print/ })).toBeNull();
  });
});

describe("the statement and print pages", { timeout: 60_000 }, () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const N = (label: string) => `Test #421 ui ${label} ${suffix}`;
  let adminId: string;
  const controlIds: string[] = [];
  const boundaryIds: string[] = [];
  let facet: string;
  let fw: string;
  let other: string;
  let active: string;
  let retired: string;

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `test-421-ui-${suffix}@example.com`, name: N("admin"), role: "ADMIN" } })).id;
    facet = (await prisma.deploymentFacet.create({ data: { name: N("facet") } })).id;
    fw = (await createFixtureFramework("421 ui")).id;
    other = (await createFixtureFramework("421 ui other")).id;
    for (const [index, frameworkId] of [fw, other].entries()) {
      const control = await prisma.control.create({ data: { code: `T421U-${index}-${suffix}`, title: N("control"), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facet }] } } });
      controlIds.push(control.id);
      await mapControlsToFramework(frameworkId, [control.id]);
    }
    active = (await prisma.complianceBoundary.create({ data: { name: N("active"), boundaryOwnerId: adminId, frameworks: { create: [{ frameworkId: fw }] } } })).id;
    retired = (await prisma.complianceBoundary.create({ data: { name: N("retired"), boundaryOwnerId: adminId, retiredAt: new Date(), frameworks: { create: [{ frameworkId: fw }] } } })).id;
    boundaryIds.push(active, retired);
    acting.userId = adminId;
  }, 60_000);

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facet] } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  }, 60_000);

  const html = async (element: Promise<React.ReactElement> | React.ReactElement) => renderToStaticMarkup(await element);
  const statementPage = (id: string) => html(StatementPage({ params: Promise.resolve({ id }) } as never));
  const printPage = (id: string, framework?: string) => html(PrintPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(framework ? { framework } : {}) } as never));

  it("the statement page offers the whole-statement buttons and a section's, and a retired Boundary none", async () => {
    const page = await statementPage(active);
    expect(page).toContain("Export whole statement (CSV)");
    expect(page).toContain("Print whole statement");
    expect(page).toContain(`href="/api/compliance-boundaries/${active}/statement/export"`);
    expect(page).toContain(`href="/compliance-boundaries/${active}/statement/print"`);
    expect(page).toContain(`/statement/export?framework=${fw}`);
    expect(page).toContain("Export section (CSV)");

    const retiredPage = await statementPage(retired);
    expect(retiredPage).not.toContain("Export whole statement");
    expect(retiredPage).not.toContain("Print whole statement");
    expect(retiredPage).not.toContain("Export section");
  });

  it("the print page has the cover facts and a section per Framework, or one section", async () => {
    const page = await printPage(active);
    expect(page).toContain("Statement of Applicability");
    expect(page).toContain(N("active"));
    expect(page).toContain(N("admin"));
    expect(page).toContain("Counted Systems");
    expect(page).toContain("Print / Save as PDF");
    expect(page).toContain("Test 421 ui Framework");
    const one = await printPage(active, fw);
    expect(one).toContain("Test 421 ui Framework");
    expect(one).toContain("Framework</dt>");
  });

  it("says so for a Framework the Boundary doesn't hold, a retired or unknown Boundary, and asks for an acting user first", async () => {
    expect(await printPage(active, other)).toContain("doesn&#x27;t hold that Framework");
    expect(await printPage(retired)).toContain("retired Compliance Boundary has no Statement");
    expect(await printPage("00000000-0000-4000-8000-000000000000")).toContain("Compliance Boundary not found");
    acting.userId = null;
    try {
      expect(await printPage(active)).toContain("Pick a user to act as first.");
    } finally {
      acting.userId = adminId;
    }
  });
});
