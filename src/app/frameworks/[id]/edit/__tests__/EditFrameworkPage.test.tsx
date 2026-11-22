import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

// The editor is a client component under the app router; static markup has no router to mount.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import EditFrameworkPage from "../page";

// The role gate of /frameworks/[id]/edit (#413): whoever may curate the Framework gets the editor, anyone else a
// refusal that names nothing of it, and a Framework the user can't see (or that doesn't exist) is a 404.
const SUFFIX = `${process.pid}-${Date.now()}`;
const DRAFT_NAME = `Test 413 draft ${SUFFIX}`;
const PUBLISHED_NAME = `Test 413 published ${SUFFIX}`;
const EMAILS = ["cm", "admin", "owner", "other", "viewer"].map((key) => `test-413-${key}-${SUFFIX}@example.com`);

describe("the Framework edit page", () => {
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-413-${key}-${SUFFIX}@example.com`, name: `Test 413 ${key}`, role } });
    users[key] = user.id;
  }

  beforeAll(async () => {
    await makeUser("cm", "COMPLIANCE_MANAGER");
    await makeUser("admin", "ADMIN");
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("other", "SYSTEM_OWNER");
    await makeUser("viewer", "VIEWER");
    ids.draft = (await prisma.framework.create({ data: { name: DRAFT_NAME, version: "1", status: "DRAFT", ownerId: users.owner, onboardingQuestion: "Do you?" } })).id;
    ids.published = (await prisma.framework.create({ data: { name: PUBLISHED_NAME, version: "1", status: "PUBLISHED", ownerId: users.owner } })).id;
  });

  afterAll(async () => {
    await prisma.framework.deleteMany({ where: { id: { in: [ids.draft, ids.published] } } });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });

  async function render(userKey: string | null, id: string) {
    acting.userId = userKey ? users[userKey] : null;
    return renderToStaticMarkup(await EditFrameworkPage({ params: Promise.resolve({ id }) } as never));
  }
  async function thrown(userKey: string | null, id: string) {
    try {
      await render(userKey, id);
    } catch (error) {
      return error;
    }
    return undefined;
  }

  it("shows the editor to a Compliance Manager and an Admin, on a Draft and a Published Framework", async () => {
    for (const key of ["cm", "admin"]) {
      for (const id of [ids.draft, ids.published]) {
        const markup = await render(key, id);
        expect(markup).toContain("Details");
        expect(markup).toContain("Requirements and Control Mappings");
        expect(markup).toContain("Review Group");
      }
    }
    const draft = await render("cm", ids.draft);
    expect(draft).toContain(`Edit ${DRAFT_NAME}:1`);
    expect(draft).toContain("This Framework is a Draft");
    expect(draft).toContain(">Publish<");
    expect(draft).toContain("fc-danger");
    expect(await render("cm", ids.published)).not.toContain("fc-danger");
  });

  it("shows the editor to the owner of a non-base Framework, with no Delete", async () => {
    const markup = await render("owner", ids.draft);
    expect(markup).toContain("As this Framework&#x27;s owner you edit the description");
    expect(markup).toContain(">Publish<");
    expect(markup).not.toContain("fc-danger");
  });

  it("refuses a user who can see the Framework but not curate it, naming nothing but a way back", async () => {
    for (const [key, id] of [["viewer", ids.published], ["other", ids.published]] as const) {
      const markup = await render(key, id);
      expect(markup).toContain("Only this Framework");
      expect(markup).toContain('href="/frameworks"');
      expect(markup).not.toContain("Details");
      expect(markup).not.toContain(PUBLISHED_NAME);
      expect(markup).not.toContain("Requirements and Control Mappings");
    }
  });

  it("refuses everyone but a Compliance Manager and an Admin on the base Framework, its owner included", async () => {
    const base = await getBaseFramework();
    const markup = await render("viewer", base.id);
    expect(markup).toContain("Only Compliance Managers and Admins can edit the base Framework.");
    expect(markup).not.toContain("Details");
    const cm = await render("cm", base.id);
    expect(cm).toContain("Base Framework");
    expect(cm).not.toContain("Onboarding question");
    expect(cm).not.toContain("fc-danger");
    expect(cm).toContain("can&#x27;t be tied to a Review Group");
  });

  it("is a 404 for a Draft the user can't see, and for an id no Framework has", async () => {
    for (const [key, id] of [["viewer", ids.draft], ["other", ids.draft], ["cm", "no-such-framework"]] as const) {
      expect(await thrown(key, id), `${key} ${id}`).toMatchObject({ digest: expect.stringContaining("404") });
    }
  });

  it("asks to pick a user when nobody is acting", async () => {
    expect(await render(null, ids.draft)).toContain("Pick a user to act as first.");
  });
});
