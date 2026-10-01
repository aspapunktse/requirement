import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createOrganizationImplementationFor } from "@/lib/organization-implementation";
import { POST as createControl } from "../route";
import { POST as createSupplementary } from "../../frameworks/[id]/requirements/[requirementId]/supplementary-control/route";

/**
 * Creating a Control creates its Organization Control Implementation when it is
 * Organizational or Both, and not when it is Per-System (#120). Both routes that
 * create Controls: `POST /api/controls` and the supplementary-control route. Fixtures only.
 *
 * The BOTH / PER_SYSTEM Controls made through the API are unscoped, but they are mapped to no
 * Published Framework, so they apply to no System; they are deleted at the end of each test anyway.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const PREFIX = `TEST-OCI-CREATE-${SUFFIX}`;

function post(path: string, userId: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` },
    body: JSON.stringify(body),
  });
}

const controlBody = (applicability: string, key: string) => ({
  code: `${PREFIX}-${key}`,
  title: `Test created ${key}`,
  description: "d",
  category: "Test",
  applicability,
  ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?" }),
});

describe("creating a Control creates its Organization Control Implementation (#120)", () => {
  let adminId: string;
  let managerId: string;
  let draftFrameworkId: string;
  let requirementId: string;

  const implementationOf = async (code: string) => {
    const control = await prisma.control.findUniqueOrThrow({ where: { code }, select: { id: true } });
    return prisma.organizationControlImplementation.findMany({ where: { controlId: control.id } });
  };

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `test-oci-create-admin-${SUFFIX}@example.com`, name: "Test OCI Create admin", role: "ADMIN" } })).id;
    managerId = (
      await prisma.user.create({ data: { email: `test-oci-create-cm-${SUFFIX}@example.com`, name: "Test OCI Create cm", role: "COMPLIANCE_MANAGER" } })
    ).id;
    draftFrameworkId = (await prisma.framework.create({ data: { name: `Test OCI Create Draft ${SUFFIX}`, version: "1" } })).id;
    requirementId = (
      await prisma.requirement.create({ data: { frameworkId: draftFrameworkId, code: "R-1", section: "S", title: "Gap", text: "x" } })
    ).id;
  });

  afterAll(async () => {
    // The supplementary-control route logs a (System-less) Control Mapping Change Event.
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: [adminId, managerId] } } });
    await prisma.control.deleteMany({ where: { code: { startsWith: PREFIX } } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId] } } });
  });

  describe("POST /api/controls", () => {
    it.each(["ORGANIZATIONAL", "BOTH"])("creates a Not Started implementation for a %s Control", async (applicability) => {
      const body = controlBody(applicability, `post-${applicability}`);
      const response = await createControl(post("/api/controls", adminId, body));
      expect(response.status).toBe(201);

      const rows = await implementationOf(body.code);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "NOT_STARTED", description: null, updatedById: null });
    });

    it("creates none for a PER_SYSTEM Control", async () => {
      const body = controlBody("PER_SYSTEM", "post-per-system");
      const response = await createControl(post("/api/controls", managerId, body));
      expect(response.status).toBe(201);
      expect(await implementationOf(body.code)).toHaveLength(0);
    });

    it("creates nothing when the Control is refused (duplicate code, invalid body)", async () => {
      const body = controlBody("ORGANIZATIONAL", "post-dup");
      expect((await createControl(post("/api/controls", adminId, body))).status).toBe(201);
      const own = () => prisma.organizationControlImplementation.count({ where: { control: { code: { startsWith: PREFIX } } } });
      const before = await own();

      expect((await createControl(post("/api/controls", adminId, body))).status).toBe(409);
      expect((await createControl(post("/api/controls", adminId, { ...body, code: `${PREFIX}-bad`, title: "" }))).status).toBe(400);

      expect(await own()).toBe(before);
      expect(await prisma.control.count({ where: { code: `${PREFIX}-bad` } })).toBe(0);
    });
  });

  describe("POST …/supplementary-control", () => {
    // Each Supplementary Control closes the gap, so the Requirement has to be a gap again for the next one.
    beforeEach(async () => {
      await prisma.controlMapping.deleteMany({ where: { requirementId } });
    });

    const createFromGap = (userId: string, body: unknown) =>
      createSupplementary(post(`/api/frameworks/${draftFrameworkId}/requirements/${requirementId}/supplementary-control`, userId, body), {
        params: Promise.resolve({ id: draftFrameworkId, requirementId }),
      } as never);

    it("creates a Not Started implementation for a Supplementary Organizational Control", async () => {
      const body = controlBody("ORGANIZATIONAL", "sup-org");
      const response = await createFromGap(managerId, body);
      expect(response.status).toBe(201);

      const rows = await implementationOf(body.code);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "NOT_STARTED", description: null });
    });

    it("creates one for a Supplementary Both Control, and none for a Per-System one", async () => {
      const both = controlBody("BOTH", "sup-both");
      expect((await createFromGap(adminId, both)).status).toBe(201);
      expect(await implementationOf(both.code)).toHaveLength(1);

      await prisma.controlMapping.deleteMany({ where: { requirementId } });
      const perSystem = controlBody("PER_SYSTEM", "sup-per-system");
      expect((await createFromGap(adminId, perSystem)).status).toBe(201);
      expect(await implementationOf(perSystem.code)).toHaveLength(0);
    });
  });

  describe("createOrganizationImplementationFor (also used by the seed)", () => {
    it("is idempotent and never resets an existing implementation", async () => {
      const control = await prisma.control.create({
        data: { code: `${PREFIX}-helper`, title: "helper", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      });
      await createOrganizationImplementationFor(prisma, control);
      await prisma.organizationControlImplementation.update({
        where: { controlId: control.id },
        data: { status: "FULFILLED", description: "Done" },
      });

      await createOrganizationImplementationFor(prisma, control);
      await createOrganizationImplementationFor(prisma, control);

      const rows = await prisma.organizationControlImplementation.findMany({ where: { controlId: control.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "FULFILLED", description: "Done" });
    });

    it("does nothing for a PER_SYSTEM Control", async () => {
      // No Control row needed: it returns before touching the database, and an unscoped Per-System fixture would be a hazard.
      await createOrganizationImplementationFor(prisma, { id: "no-such-control", applicability: "PER_SYSTEM" });
      expect(await prisma.organizationControlImplementation.count({ where: { controlId: "no-such-control" } })).toBe(0);
    });
  });

  it("removes the implementation with its Control", async () => {
    const body = controlBody("ORGANIZATIONAL", "cascade");
    await createControl(post("/api/controls", adminId, body));
    const control = await prisma.control.findUniqueOrThrow({ where: { code: body.code } });
    expect(await prisma.organizationControlImplementation.count({ where: { controlId: control.id } })).toBe(1);

    await prisma.control.delete({ where: { id: control.id } });
    expect(await prisma.organizationControlImplementation.count({ where: { controlId: control.id } })).toBe(0);
  });
});
