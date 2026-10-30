import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

// The list is a client component under the app router; static markup has no router to mount.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import FrameworksOverviewPage from "../page";
import AdminFrameworksPage from "../../admin/frameworks/page";

// Version lineage on both Framework lists (#146): 2013 <- 2022 (Draft) <- 2030, plus 2030 <- 2040 (Draft).
// Fixtures are deleted newest-first; supersedes is also SetNull, so order only matters for tidiness.
const SUFFIX = `${process.pid}-${Date.now()}`;
const NAME = `Test 146 lineage ${SUFFIX}`;
const EMAILS = ["cm", "viewer"].map((k) => `test-146-${k}-${SUFFIX}@example.com`);

describe("version lineage on /frameworks and /admin/frameworks", () => {
  const users: Record<string, string> = {};
  const frameworkIds: string[] = [];

  async function makeFramework(version: string, status: "DRAFT" | "PUBLISHED", supersedesId: string | null) {
    const framework = await prisma.framework.create({ data: { name: NAME, version, status, supersedesId } });
    frameworkIds.push(framework.id);
    return framework;
  }

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-146-${key}-${SUFFIX}@example.com`, name: `Test 146 ${key}`, role } });
    users[key] = user.id;
  }

  beforeAll(async () => {
    await makeUser("cm", "COMPLIANCE_MANAGER");
    await makeUser("viewer", "VIEWER");
    const v2013 = await makeFramework("2013", "PUBLISHED", null);
    const v2022 = await makeFramework("2022", "DRAFT", v2013.id);
    const v2030 = await makeFramework("2030", "PUBLISHED", v2022.id);
    await makeFramework("2040", "DRAFT", v2030.id);
  });

  afterAll(async () => {
    for (const id of [...frameworkIds].reverse()) await prisma.framework.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });

  async function html(page: () => Promise<React.ReactNode>, userKey: string) {
    acting.userId = users[userKey];
    return renderToStaticMarkup(await page());
  }
  const text = (markup: string) => markup.replace(/<[^>]*>/g, "").replace(/&gt;/g, ">");

  it("shows a three-version chain in order on /frameworks, Drafts marked, for a Compliance Manager", async () => {
    const markup = await html(FrameworksOverviewPage, "cm");
    const plain = text(markup);
    const chain = `Version lineage: ${NAME}:2013 → ${NAME}:2022 (Draft) → ${NAME}:2030 → ${NAME}:2040 (Draft)`;
    expect(plain).toContain(chain);
    expect(markup).toContain('aria-current="true"');
  });

  it("shows the same chain in order on /admin/frameworks for a Compliance Manager", async () => {
    const plain = text(await html(AdminFrameworksPage, "cm"));
    expect(plain).toContain(
      `Version lineage: ${NAME}:2013 → ${NAME}:2022 (Draft) → ${NAME}:2030 → ${NAME}:2040 (Draft)`,
    );
  });

  it("closes the chain over the Draft for a user who can't see Drafts, leaking nothing of it", async () => {
    const markup = await html(FrameworksOverviewPage, "viewer");
    expect(text(markup)).toContain(`Version lineage: ${NAME}:2013 → ${NAME}:2030`);
    expect(markup).not.toContain(`${NAME}:2022`);
    expect(markup).not.toContain(`${NAME}:2040`);
    expect(markup).not.toContain("(Draft)");
    // The only rows of this fixture a user who can't see Drafts is given are the two Published versions.
    expect(markup.match(new RegExp(`<b>${NAME}</b><code>`, "g"))).toHaveLength(2);
  });
});
