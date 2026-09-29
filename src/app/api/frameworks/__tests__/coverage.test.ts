import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET as listFrameworks } from "../route";
import { GET as getCoverage } from "../[id]/coverage/route";
import { PUT as acceptGap, DELETE as unacceptGap } from "../[id]/requirements/[requirementId]/gap-acceptance/route";
import { POST as createSupplementary } from "../[id]/requirements/[requirementId]/supplementary-control/route";
import { POST as createMapping } from "../[id]/requirements/[requirementId]/mappings/route";
import { PATCH as patchMapping } from "../[id]/requirements/[requirementId]/mappings/[mappingId]/route";
import { GET as listControls } from "../../controls/route";
import { GET as getControl } from "../../controls/[id]/route";

// Lets one test make the Change Event write fail, to prove create-from-gap is a single transaction.
const failEventLogging = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/frameworks", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/frameworks")>();
  return {
    ...original,
    logMappingChange: (...args: Parameters<typeof original.logMappingChange>) => {
      if (failEventLogging.on) throw new Error("event logging failed");
      return original.logMappingChange(...args);
    },
  };
});

/**
 * Framework Coverage view, gap acceptance and Supplementary Controls from gaps
 * (#74). Every fixture is created here (CI's DB is migrated but not seeded)
 * and removed in afterAll; the seeded base Framework is never touched.
 */

const SUFFIX = Date.now();
const email = (tag: string) => `test-fw-coverage-${tag}-${SUFFIX}@example.com`;

function req(path: string, method: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

describe("Framework coverage: view, gap acceptance, Supplementary Controls", () => {
  const userIds: Record<string, string> = {};
  let publishedId: string;
  let draftId: string;
  let otherId: string;
  let control1: { id: string; code: string };
  let control2: { id: string; code: string };
  let requirements: Record<string, string> = {};
  let otherRequirementId: string;
  let nextCode = 0;

  // ORGANIZATIONAL on purpose: an unscoped PER_SYSTEM Control would apply to every System, and other test
  // files running concurrently would pick it up and trip over its cleanup (the known shared-DB flake).
  const controlBody = (over: Record<string, unknown> = {}) => ({
    code: `TEST-COV-SUP-${SUFFIX}-${++nextCode}`,
    title: "Supplementary control",
    description: "Notify the CSIRT within 24 hours",
    category: "Legal",
    applicability: "ORGANIZATIONAL",
    ...over,
  });

  const coverageOf = async (frameworkId: string, tag = "cm") => {
    const response = await getCoverage(
      req(`/api/frameworks/${frameworkId}/coverage`, "GET", userIds[tag]),
      params({ id: frameworkId }),
    );
    return { status: response.status, body: await response.json() };
  };
  const accept = (frameworkId: string, requirementId: string, tag: string | null, body?: unknown) =>
    acceptGap(
      req(`/api/frameworks/${frameworkId}/requirements/${requirementId}/gap-acceptance`, "PUT", tag ? userIds[tag] : null, body),
      params({ id: frameworkId, requirementId }),
    );
  const unaccept = (frameworkId: string, requirementId: string, tag: string | null) =>
    unacceptGap(
      req(`/api/frameworks/${frameworkId}/requirements/${requirementId}/gap-acceptance`, "DELETE", tag ? userIds[tag] : null),
      params({ id: frameworkId, requirementId }),
    );
  const createFromGap = (frameworkId: string, requirementId: string, tag: string | null, body: unknown) =>
    createSupplementary(
      req(
        `/api/frameworks/${frameworkId}/requirements/${requirementId}/supplementary-control`,
        "POST",
        tag ? userIds[tag] : null,
        body,
      ),
      params({ id: frameworkId, requirementId }),
    );
  const gapFields = (requirementId: string) =>
    prisma.requirement.findUniqueOrThrow({
      where: { id: requirementId },
      select: { gapAcceptedAt: true, gapAcceptedById: true, gapJustification: true },
    });

  beforeAll(async () => {
    const roles: [string, UserRole][] = [
      ["cm", "COMPLIANCE_MANAGER"],
      ["admin", "ADMIN"],
      ["viewer", "VIEWER"],
      ["owner", "SYSTEM_OWNER"],
    ];
    for (const [tag, role] of roles) {
      const user = await prisma.user.create({ data: { email: email(tag), name: `Coverage ${tag}`, role } });
      userIds[tag] = user.id;
    }
    const [published, draft, other] = await Promise.all([
      prisma.framework.create({ data: { name: `Test Coverage Published ${SUFFIX}`, version: "1", status: "PUBLISHED" } }),
      prisma.framework.create({ data: { name: `Test Coverage Draft ${SUFFIX}`, version: "1" } }),
      prisma.framework.create({ data: { name: `Test Coverage Other ${SUFFIX}`, version: "1", status: "PUBLISHED" } }),
    ]);
    publishedId = published.id;
    draftId = draft.id;
    otherId = other.id;
    const controlData = (n: number) => ({
      code: `TEST-COV-${SUFFIX}-${n}`,
      title: `Coverage control ${n}`,
      description: "d",
      category: "Test",
      applicability: "ORGANIZATIONAL" as const,
    });
    [control1, control2] = await Promise.all([
      prisma.control.create({ data: controlData(1) }),
      prisma.control.create({ data: controlData(2) }),
    ]);
    otherRequirementId = (
      await prisma.requirement.create({
        data: { frameworkId: otherId, code: "O-1", section: "Other", title: "Other", text: "x" },
      })
    ).id;
  });

  afterAll(async () => {
    const frameworkIds = [publishedId, draftId, otherId];
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(userIds) } } });
    // Supplementary Controls restrict deleting their origin Framework, so they go first.
    await prisma.control.deleteMany({
      where: { OR: [{ id: { in: [control1.id, control2.id] } }, { originFrameworkId: { in: frameworkIds } }] },
    });
    await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  beforeEach(async () => {
    failEventLogging.on = false;
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(userIds) } } });
    await prisma.control.deleteMany({ where: { originFrameworkId: { in: [publishedId, draftId] } } });
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: [publishedId, draftId] } } });
    // full (Full), partial (Partial only), unmapped, accepted (Partial + accepted gap)
    requirements = {};
    for (const code of ["full", "partial", "unmapped", "accepted"]) {
      const created = await prisma.requirement.create({
        data: { frameworkId: publishedId, code, section: "Section 1", title: `Title ${code}`, text: "x" },
      });
      requirements[code] = created.id;
    }
    await prisma.controlMapping.create({
      data: { requirementId: requirements.full, controlId: control1.id, coverage: "FULL" },
    });
    await prisma.controlMapping.create({
      data: { requirementId: requirements.partial, controlId: control1.id, coverage: "PARTIAL" },
    });
    await prisma.controlMapping.create({
      data: { requirementId: requirements.accepted, controlId: control2.id, coverage: "PARTIAL" },
    });
    await prisma.requirement.update({
      where: { id: requirements.accepted },
      data: { gapAcceptedAt: new Date(), gapAcceptedById: userIds.cm, gapJustification: "Handled by policy" },
    });
  });

  describe("GET /api/frameworks/[id]/coverage", () => {
    it("shows every signed-in user a Published Framework's states and counts", async () => {
      for (const tag of ["viewer", "owner", "cm", "admin"]) {
        const { status, body } = await coverageOf(publishedId, tag);
        expect(status).toBe(200);
        expect(body.summary).toEqual({ total: 4, covered: 1, gaps: 2, accepted: 1 });
        const stateOf = Object.fromEntries(body.requirements.map((r: { code: string; state: string }) => [r.code, r.state]));
        expect(stateOf).toEqual({ full: "COVERED", partial: "GAP", unmapped: "GAP", accepted: "ACCEPTED_GAP" });
      }
    });

    it("includes each Requirement's mapped Controls with their Coverage, and the acceptance", async () => {
      const { body } = await coverageOf(publishedId, "viewer");
      const partial = body.requirements.find((r: { code: string }) => r.code === "partial");
      expect(partial.mappings).toEqual([
        expect.objectContaining({ coverage: "PARTIAL", control: expect.objectContaining({ code: control1.code }) }),
      ]);
      const accepted = body.requirements.find((r: { code: string }) => r.code === "accepted");
      expect(accepted).toMatchObject({
        gapJustification: "Handled by policy",
        gapAcceptedBy: { id: userIds.cm },
      });
    });

    it("a Draft Framework is a 404 for a Viewer and System Owner but readable by a Compliance Manager and Admin", async () => {
      await prisma.requirement.create({
        data: { frameworkId: draftId, code: "D-1", section: "S", title: "Draft req", text: "x" },
      });
      for (const tag of ["viewer", "owner"]) {
        expect((await coverageOf(draftId, tag)).status).toBe(404);
      }
      for (const tag of ["cm", "admin"]) {
        const { status, body } = await coverageOf(draftId, tag);
        expect(status).toBe(200);
        expect(body.summary).toEqual({ total: 1, covered: 0, gaps: 1, accepted: 0 });
      }
    });

    it("requires a signed-in user, and 404s an unknown Framework", async () => {
      const anonymous = await getCoverage(req(`/api/frameworks/${publishedId}/coverage`, "GET", null), params({ id: publishedId }));
      expect(anonymous.status).toBe(401);
      expect((await coverageOf("nope")).status).toBe(404);
    });
  });

  describe("Framework list counts (F-FW.6)", () => {
    it("each listed Framework carries its covered / gap / accepted counts", async () => {
      const { frameworks } = await (await listFrameworks(req("/api/frameworks", "GET", userIds.viewer))).json();
      const published = frameworks.find((f: { id: string }) => f.id === publishedId);
      expect(published.coverage).toEqual({ total: 4, covered: 1, gaps: 2, accepted: 1 });
      const other = frameworks.find((f: { id: string }) => f.id === otherId);
      expect(other.coverage).toEqual({ total: 1, covered: 0, gaps: 1, accepted: 0 });
    });
  });

  describe("accept / un-accept a gap", () => {
    it("requires Compliance Manager or Admin", async () => {
      expect((await accept(publishedId, requirements.unmapped, null, { justification: "x" })).status).toBe(401);
      for (const tag of ["viewer", "owner"]) {
        expect((await accept(publishedId, requirements.unmapped, tag, { justification: "x" })).status).toBe(403);
        expect((await unaccept(publishedId, requirements.accepted, tag)).status).toBe(403);
      }
      expect((await unaccept(publishedId, requirements.accepted, null)).status).toBe(401);
      expect((await gapFields(requirements.unmapped)).gapAcceptedAt).toBeNull();
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).not.toBeNull();
    });

    it("accepts an unmapped or Partial-only gap with a justification, recording who and when; counts update", async () => {
      for (const [tag, code] of [
        ["cm", "unmapped"],
        ["admin", "partial"],
      ] as const) {
        const response = await accept(publishedId, requirements[code], tag, { justification: `  Risk accepted for ${code}  ` });
        expect(response.status).toBe(200);
        expect(await gapFields(requirements[code])).toMatchObject({
          gapAcceptedById: userIds[tag],
          gapJustification: `Risk accepted for ${code}`,
        });
        expect((await gapFields(requirements[code])).gapAcceptedAt).toBeInstanceOf(Date);
      }
      expect((await coverageOf(publishedId)).body.summary).toEqual({ total: 4, covered: 1, gaps: 0, accepted: 3 });
    });

    it("requires a non-blank justification", async () => {
      for (const body of [undefined, {}, { justification: "" }, { justification: "   " }, { justification: 5 }]) {
        expect((await accept(publishedId, requirements.unmapped, "cm", body)).status).toBe(400);
      }
      expect((await gapFields(requirements.unmapped)).gapAcceptedAt).toBeNull();
    });

    it("refuses to accept a Requirement that is covered by a Full mapping (409)", async () => {
      const response = await accept(publishedId, requirements.full, "cm", { justification: "x" });
      expect(response.status).toBe(409);
      expect((await gapFields(requirements.full)).gapAcceptedAt).toBeNull();
    });

    it("scopes the Requirement to the Framework in the URL (404 otherwise)", async () => {
      expect((await accept(otherId, requirements.unmapped, "cm", { justification: "x" })).status).toBe(404);
      expect((await accept(publishedId, otherRequirementId, "cm", { justification: "x" })).status).toBe(404);
      expect((await accept(publishedId, "nope", "cm", { justification: "x" })).status).toBe(404);
      expect((await unaccept(otherId, requirements.accepted, "cm")).status).toBe(404);
    });

    it("accepting again replaces the justification and re-stamps who accepted", async () => {
      const response = await accept(publishedId, requirements.accepted, "admin", { justification: "New reasoning" });
      expect(response.status).toBe(200);
      expect(await gapFields(requirements.accepted)).toMatchObject({
        gapAcceptedById: userIds.admin,
        gapJustification: "New reasoning",
      });
    });

    it("un-accepting clears all three fields and the gap counts as open again; un-accepting twice is a 409", async () => {
      const response = await unaccept(publishedId, requirements.accepted, "cm");
      expect(response.status).toBe(204);
      expect(await gapFields(requirements.accepted)).toEqual({
        gapAcceptedAt: null,
        gapAcceptedById: null,
        gapJustification: null,
      });
      expect((await coverageOf(publishedId)).body.summary).toEqual({ total: 4, covered: 1, gaps: 3, accepted: 0 });
      expect((await unaccept(publishedId, requirements.accepted, "cm")).status).toBe(409);
    });

    it("a Draft Framework's gaps can be accepted by a curator", async () => {
      const draftRequirement = await prisma.requirement.create({
        data: { frameworkId: draftId, code: "D-1", section: "S", title: "Draft req", text: "x" },
      });
      expect((await accept(draftId, draftRequirement.id, "cm", { justification: "Draft note" })).status).toBe(200);
    });
  });

  describe("gaining a Full mapping ends a gap acceptance", () => {
    const mappingsPath = (requirementId: string) => `/api/frameworks/${publishedId}/requirements/${requirementId}/mappings`;

    it("adding a FULL mapping to an accepted gap clears the acceptance; the Requirement is covered", async () => {
      const response = await createMapping(
        req(mappingsPath(requirements.accepted), "POST", userIds.cm, { controlId: control1.id, coverage: "FULL" }),
        params({ id: publishedId, requirementId: requirements.accepted }),
      );
      expect(response.status).toBe(201);
      expect(await gapFields(requirements.accepted)).toEqual({
        gapAcceptedAt: null,
        gapAcceptedById: null,
        gapJustification: null,
      });
      expect((await coverageOf(publishedId)).body.summary).toMatchObject({ covered: 2, accepted: 0 });
    });

    it("adding a PARTIAL mapping keeps the acceptance", async () => {
      const response = await createMapping(
        req(mappingsPath(requirements.accepted), "POST", userIds.cm, { controlId: control1.id, coverage: "PARTIAL" }),
        params({ id: publishedId, requirementId: requirements.accepted }),
      );
      expect(response.status).toBe(201);
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).not.toBeNull();
    });

    it("upgrading a Partial mapping to Full clears the acceptance; a rationale-only edit keeps it", async () => {
      const mapping = await prisma.controlMapping.findFirstOrThrow({ where: { requirementId: requirements.accepted } });
      const path = `${mappingsPath(requirements.accepted)}/${mapping.id}`;
      const ctx = params({ id: publishedId, requirementId: requirements.accepted, mappingId: mapping.id });

      await patchMapping(req(path, "PATCH", userIds.cm, { rationale: "just a note" }), ctx);
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).not.toBeNull();

      const response = await patchMapping(req(path, "PATCH", userIds.cm, { coverage: "FULL" }), ctx);
      expect(response.status).toBe(200);
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).toBeNull();
    });
  });

  describe("POST …/supplementary-control (create a Supplementary Control from a gap)", () => {
    it("requires Compliance Manager or Admin and creates nothing otherwise", async () => {
      const before = await prisma.control.count();
      expect((await createFromGap(publishedId, requirements.unmapped, null, controlBody())).status).toBe(401);
      for (const tag of ["viewer", "owner"]) {
        expect((await createFromGap(publishedId, requirements.unmapped, tag, controlBody())).status).toBe(403);
      }
      expect(await prisma.control.count()).toBe(before);
    });

    it("creates the Control with its origin Framework and a FULL mapping, leaving the Requirement covered", async () => {
      const body = controlBody();
      const response = await createFromGap(publishedId, requirements.unmapped, "cm", body);
      expect(response.status).toBe(201);
      const { control, mapping } = await response.json();
      expect(control).toMatchObject({
        code: body.code,
        originFrameworkId: publishedId,
        originFramework: { id: publishedId },
        mandatory: true,
      });
      expect(mapping.coverage).toBe("FULL");

      const stored = await prisma.controlMapping.findMany({ where: { requirementId: requirements.unmapped } });
      expect(stored).toEqual([expect.objectContaining({ controlId: control.id, coverage: "FULL" })]);

      const { body: coverage } = await coverageOf(publishedId);
      const row = coverage.requirements.find((r: { code: string }) => r.code === "unmapped");
      expect(row.state).toBe("COVERED");
      expect(row.mappings[0].control.originFramework).toMatchObject({ id: publishedId });
      expect(coverage.summary).toEqual({ total: 4, covered: 2, gaps: 1, accepted: 1 });
    });

    it("works for a Partial-only gap (which stays mapped Partial to the other Control)", async () => {
      const response = await createFromGap(publishedId, requirements.partial, "admin", controlBody());
      expect(response.status).toBe(201);
      const mappings = await prisma.controlMapping.findMany({ where: { requirementId: requirements.partial } });
      expect(mappings.map((m) => m.coverage).sort()).toEqual(["FULL", "PARTIAL"]);
    });

    it("logs the same CONTROL_MAPPING_CHANGED event as the mapping endpoint", async () => {
      const body = controlBody();
      await createFromGap(publishedId, requirements.unmapped, "cm", body);
      const events = await prisma.changeEvent.findMany({
        where: { action: "CONTROL_MAPPING_CHANGED", actorId: userIds.cm },
      });
      expect(events).toHaveLength(1);
      expect(events[0].systemId).toBeNull();
      expect(events[0].detail).toBe(
        `Control Mapping added: Requirement Test Coverage Published ${SUFFIX}:1 unmapped ↔ Control ${body.code} (none → FULL)`,
      );
    });

    it("closing an accepted gap this way ends the acceptance", async () => {
      const response = await createFromGap(publishedId, requirements.accepted, "cm", controlBody());
      expect(response.status).toBe(201);
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).toBeNull();
      expect((await coverageOf(publishedId)).body.summary).toEqual({ total: 4, covered: 2, gaps: 2, accepted: 0 });
    });

    it("validates the Control like POST /api/controls (400) and refuses a covered Requirement (409)", async () => {
      const before = await prisma.control.count();
      for (const body of [
        undefined,
        {},
        controlBody({ code: "" }),
        controlBody({ applicability: "SOMETIMES" }),
        controlBody({ applicability: "PER_SYSTEM" }), // a PER_SYSTEM Control needs a Self-Assessment Question (rejected, so never created)
      ]) {
        expect((await createFromGap(publishedId, requirements.unmapped, "cm", body)).status).toBe(400);
      }
      expect((await createFromGap(publishedId, requirements.full, "cm", controlBody())).status).toBe(409);
      expect(await prisma.control.count()).toBe(before);
    });

    it("scopes the Requirement to the Framework in the URL (404)", async () => {
      expect((await createFromGap(otherId, requirements.unmapped, "cm", controlBody())).status).toBe(404);
      expect((await createFromGap(publishedId, "nope", "cm", controlBody())).status).toBe(404);
    });

    it("a duplicate Control code is a 409 and leaves no Control, mapping or event behind", async () => {
      const body = controlBody({ code: control1.code });
      const response = await createFromGap(publishedId, requirements.unmapped, "cm", body);
      expect(response.status).toBe(409);
      expect(await prisma.controlMapping.count({ where: { requirementId: requirements.unmapped } })).toBe(0);
      expect(await prisma.control.count({ where: { originFrameworkId: publishedId } })).toBe(0);
      expect(await prisma.changeEvent.count({ where: { action: "CONTROL_MAPPING_CHANGED", actorId: userIds.cm } })).toBe(0);
    });

    it("is one transaction: if a later step fails, the Control and mapping are rolled back too", async () => {
      failEventLogging.on = true;
      const body = controlBody();
      await expect(createFromGap(publishedId, requirements.accepted, "cm", body)).rejects.toThrow("event logging failed");
      failEventLogging.on = false;

      expect(await prisma.control.findUnique({ where: { code: body.code } })).toBeNull();
      expect(await prisma.controlMapping.count({ where: { requirementId: requirements.accepted, coverage: "FULL" } })).toBe(0);
      // The gap acceptance is untouched by the failed attempt.
      expect((await gapFields(requirements.accepted)).gapAcceptedAt).not.toBeNull();
    });

    it("works for a curator on a Draft Framework", async () => {
      const draftRequirement = await prisma.requirement.create({
        data: { frameworkId: draftId, code: "D-1", section: "S", title: "Draft req", text: "x" },
      });
      const response = await createFromGap(draftId, draftRequirement.id, "cm", controlBody());
      expect(response.status).toBe(201);
      expect((await response.json()).control.originFrameworkId).toBe(draftId);
    });
  });

  describe("Supplementary Controls in the Control Library API", () => {
    it("lists a Supplementary Control with its origin Framework and a base Control without one", async () => {
      const body = controlBody();
      const { control } = await (await createFromGap(publishedId, requirements.unmapped, "cm", body)).json();

      for (const tag of ["cm", "viewer"]) {
        const { controls } = await (await listControls(req("/api/controls", "GET", userIds[tag]))).json();
        const supplementary = controls.find((c: { id: string }) => c.id === control.id);
        expect(supplementary.originFramework).toMatchObject({ id: publishedId, name: `Test Coverage Published ${SUFFIX}` });
        const base = controls.find((c: { id: string }) => c.id === control1.id);
        expect(base.originFramework).toBeNull();
      }
    });

    it("hides a Draft origin Framework from users who can't see Drafts, but not from curators", async () => {
      const draftRequirement = await prisma.requirement.create({
        data: { frameworkId: draftId, code: "D-1", section: "S", title: "Draft req", text: "x" },
      });
      const { control } = await (await createFromGap(draftId, draftRequirement.id, "cm", controlBody())).json();

      const asViewer = await (await listControls(req("/api/controls", "GET", userIds.viewer))).json();
      expect(asViewer.controls.find((c: { id: string }) => c.id === control.id).originFramework).toBeNull();
      const single = await getControl(req(`/api/controls/${control.id}`, "GET", userIds.viewer), params({ id: control.id }));
      expect((await single.json()).control.originFramework).toBeNull();

      const asCm = await (await listControls(req("/api/controls", "GET", userIds.cm))).json();
      expect(asCm.controls.find((c: { id: string }) => c.id === control.id).originFramework).toMatchObject({ id: draftId });
    });
  });
});
