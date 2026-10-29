import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createFixtureFramework, getBaseFramework } from "@/test/framework-fixtures";
import { PATCH } from "../[id]/route";

const SUFFIX = `${process.pid}-${Date.now()}`;

function patch(id: string, userId: string | null, body: unknown) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return PATCH(new NextRequest(`http://localhost/api/frameworks/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

describe("PATCH /api/frameworks/[id]: the onboarding question and hint", () => {
  const users: Record<string, string> = {};
  let frameworkId: string;
  let baseId: string;

  beforeAll(async () => {
    for (const [key, role] of Object.entries({ cm: "COMPLIANCE_MANAGER", admin: "ADMIN", owner: "SYSTEM_OWNER", viewer: "VIEWER" } satisfies Record<string, UserRole>)) {
      users[key] = (await prisma.user.create({ data: { email: `test-fwq-${key}-${SUFFIX}@example.com`, name: `Test fwq ${key}`, role } })).id;
    }
    frameworkId = (await createFixtureFramework("Onboarding question")).id;
    baseId = (await getBaseFramework()).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  async function stored(id = frameworkId) {
    const { onboardingQuestion, onboardingHint } = await prisma.framework.findUniqueOrThrow({ where: { id } });
    return { onboardingQuestion, onboardingHint };
  }

  it("lets a Compliance Manager set, change and clear the question and hint", async () => {
    const set = await patch(frameworkId, users.cm, { onboardingQuestion: "  Does it hold personal data?  ", onboardingHint: "Customers, employees." });
    expect(set.status).toBe(200);
    expect(await stored()).toEqual({ onboardingQuestion: "Does it hold personal data?", onboardingHint: "Customers, employees." });

    // A patch that leaves them out leaves them alone.
    expect((await patch(frameworkId, users.cm, { description: "Something" })).status).toBe(200);
    expect(await stored()).toEqual({ onboardingQuestion: "Does it hold personal data?", onboardingHint: "Customers, employees." });

    expect((await patch(frameworkId, users.cm, { onboardingHint: "" })).status).toBe(200);
    expect(await stored()).toEqual({ onboardingQuestion: "Does it hold personal data?", onboardingHint: null });

    expect((await patch(frameworkId, users.admin, { onboardingQuestion: null, onboardingHint: null })).status).toBe(200);
    expect(await stored()).toEqual({ onboardingQuestion: null, onboardingHint: null });
  });

  it("refuses every other role and an anonymous caller, and changes nothing", async () => {
    await patch(frameworkId, users.cm, { onboardingQuestion: "Keep me?" });
    for (const userId of [users.owner, users.viewer]) {
      expect((await patch(frameworkId, userId, { onboardingQuestion: "Changed" })).status).toBe(403);
    }
    expect((await patch(frameworkId, null, { onboardingQuestion: "Changed" })).status).toBe(401);
    expect(await stored()).toEqual({ onboardingQuestion: "Keep me?", onboardingHint: null });
    await patch(frameworkId, users.cm, { onboardingQuestion: null });
  });

  it("refuses a question on the base Framework, and a hint without a question, and changes nothing", async () => {
    const before = await stored(baseId);
    const onBase = await patch(baseId, users.cm, { onboardingQuestion: "Is it in scope?" });
    expect(onBase.status).toBe(409);
    expect(await stored(baseId)).toEqual(before);

    const hintOnly = await patch(frameworkId, users.cm, { onboardingHint: "A hint alone" });
    expect(hintOnly.status).toBe(400);
    expect(await stored()).toEqual({ onboardingQuestion: null, onboardingHint: null });

    const tooLong = await patch(frameworkId, users.cm, { onboardingQuestion: "x".repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(await stored()).toEqual({ onboardingQuestion: null, onboardingHint: null });
  });

  it("refuses making a Framework with a question the base Framework", async () => {
    await patch(frameworkId, users.cm, { onboardingQuestion: "Still here?" });
    const response = await patch(frameworkId, users.cm, { isBase: true });
    expect(response.status).toBe(409);
    expect((await prisma.framework.findUniqueOrThrow({ where: { id: frameworkId } })).isBase).toBe(false);
    expect(await prisma.framework.count({ where: { isBase: true } })).toBe(1);
  });
});
