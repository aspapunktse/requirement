import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { onFrameworkPublished } from "@/lib/frameworks";
import { GET as listFrameworks } from "../route";
import { GET as getFramework, PATCH as patchFramework } from "../[id]/route";
import { POST as publishFramework } from "../[id]/publish/route";
import { GET as listRequirements, POST as createRequirement } from "../[id]/requirements/route";
import { PATCH as patchRequirement, DELETE as deleteRequirement } from "../[id]/requirements/[requirementId]/route";
import { POST as createMapping } from "../[id]/requirements/[requirementId]/mappings/route";
import {
  PATCH as patchMapping,
  DELETE as deleteMapping,
} from "../[id]/requirements/[requirementId]/mappings/[mappingId]/route";
import { GET as listControls } from "../../controls/route";

// Only the hook is replaced (a spy), so the publish route's call to it can be asserted.
vi.mock("@/lib/frameworks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/frameworks")>()),
  onFrameworkPublished: vi.fn(async () => {}),
}));

/**
 * Framework authoring (#73): Requirements, Control Mappings, Publish, Draft
 * invisibility and the System-less Change Events. Every fixture is created
 * here (CI's DB is migrated but not seeded) and removed in afterAll; the base
 * Framework's rules are covered in route.test.ts, which owns that fixture.
 */

const SUFFIX = Date.now();
const email = (tag: string) => `test-fw-authoring-${tag}-${SUFFIX}@example.com`;

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

describe("Framework authoring: Requirements, Control Mappings, Publish", () => {
  const userIds: Record<string, string> = {};
  let draftId: string;
  let publishedId: string;
  let control1: { id: string; code: string };
  let control2: { id: string; code: string };
  const cm = () => userIds.cm;

  const draftLabel = `Test Authoring FW ${SUFFIX}:1`;
  const events = (action: "CONTROL_MAPPING_CHANGED" | "FRAMEWORK_PUBLISHED") =>
    prisma.changeEvent.findMany({
      where: { action, actorId: { in: Object.values(userIds) } },
      orderBy: { createdAt: "asc" },
    });

  async function addRequirement(frameworkId: string, code: string, section = "Section 1") {
    return prisma.requirement.create({
      data: { frameworkId, code, section, title: `Title ${code}`, text: `Text ${code}` },
    });
  }

  beforeAll(async () => {
    const roles: [string, UserRole][] = [
      ["cm", "COMPLIANCE_MANAGER"],
      ["admin", "ADMIN"],
      ["viewer", "VIEWER"],
      ["owner", "SYSTEM_OWNER"],
    ];
    for (const [tag, role] of roles) {
      const user = await prisma.user.create({ data: { email: email(tag), name: `Authoring ${tag}`, role } });
      userIds[tag] = user.id;
    }
    const [draft, published] = await Promise.all([
      prisma.framework.create({ data: { name: `Test Authoring FW ${SUFFIX}`, version: "1" } }),
      prisma.framework.create({
        data: { name: `Test Authoring Published FW ${SUFFIX}`, version: "1", status: "PUBLISHED" },
      }),
    ]);
    draftId = draft.id;
    publishedId = published.id;
    const controlData = (n: number) => ({
      code: `TEST-AUTH-${SUFFIX}-${n}`,
      title: `Authoring control ${n}`,
      description: "d",
      category: "Test",
      applicability: "ORGANIZATIONAL" as const,
    });
    [control1, control2] = await Promise.all([
      prisma.control.create({ data: controlData(1) }),
      prisma.control.create({ data: controlData(2) }),
    ]);
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(userIds) } } });
    await prisma.framework.deleteMany({ where: { id: { in: [draftId, publishedId] } } });
    await prisma.control.deleteMany({ where: { id: { in: [control1.id, control2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  beforeEach(async () => {
    vi.mocked(onFrameworkPublished).mockClear();
    // Each test starts from a Framework with no Requirements; the Draft is also reset to Draft.
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: [draftId, publishedId] } } });
    await prisma.framework.update({ where: { id: draftId }, data: { status: "DRAFT" } });
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(userIds) } } });
  });

  describe("Draft Frameworks are invisible outside the requirement-database roles", () => {
    it("the Framework list hides Drafts from a Viewer and a System Owner, and shows them to a Compliance Manager and an Admin", async () => {
      for (const tag of ["cm", "admin"]) {
        const { frameworks } = await (await listFrameworks(req("/api/frameworks", "GET", userIds[tag]))).json();
        const ids = frameworks.map((f: { id: string }) => f.id);
        expect(ids).toContain(draftId);
        expect(ids).toContain(publishedId);
      }
      for (const tag of ["viewer", "owner"]) {
        const { frameworks } = await (await listFrameworks(req("/api/frameworks", "GET", userIds[tag]))).json();
        const ids = frameworks.map((f: { id: string }) => f.id);
        expect(ids).not.toContain(draftId);
        expect(ids).toContain(publishedId);
      }
    });

    it("Framework detail and its Requirements are a 404 for a Draft unless you're a curator", async () => {
      for (const tag of ["viewer", "owner"]) {
        const detail = await getFramework(req(`/api/frameworks/${draftId}`, "GET", userIds[tag]), params({ id: draftId }));
        expect(detail.status).toBe(404);
        const list = await listRequirements(
          req(`/api/frameworks/${draftId}/requirements`, "GET", userIds[tag]),
          params({ id: draftId }),
        );
        expect(list.status).toBe(404);
      }
      for (const tag of ["cm", "admin"]) {
        const detail = await getFramework(req(`/api/frameworks/${draftId}`, "GET", userIds[tag]), params({ id: draftId }));
        expect(detail.status).toBe(200);
        expect((await detail.json()).framework).toMatchObject({ id: draftId, status: "DRAFT" });
      }
    });

    it("a Published Framework and its Requirements and mappings are readable by every signed-in user", async () => {
      const requirement = await addRequirement(publishedId, "P-1");
      await prisma.controlMapping.create({
        data: { requirementId: requirement.id, controlId: control1.id, coverage: "FULL", rationale: "because" },
      });

      const detail = await getFramework(req(`/api/frameworks/${publishedId}`, "GET", userIds.viewer), params({ id: publishedId }));
      expect(detail.status).toBe(200);

      const list = await listRequirements(
        req(`/api/frameworks/${publishedId}/requirements`, "GET", userIds.viewer),
        params({ id: publishedId }),
      );
      const { requirements } = await list.json();
      expect(requirements).toHaveLength(1);
      expect(requirements[0].mappings).toEqual([
        expect.objectContaining({ coverage: "FULL", rationale: "because", control: expect.objectContaining({ code: control1.code }) }),
      ]);
    });

    it("rejects unauthenticated reads", async () => {
      expect((await listFrameworks(req("/api/frameworks", "GET", null))).status).toBe(401);
      expect(
        (await getFramework(req(`/api/frameworks/${publishedId}`, "GET", null), params({ id: publishedId }))).status,
      ).toBe(401);
      expect(
        (await listRequirements(req(`/api/frameworks/${publishedId}/requirements`, "GET", null), params({ id: publishedId })))
          .status,
      ).toBe(401);
    });

    it("a Control's mappings into a Draft Framework are only visible to a curator", async () => {
      const requirement = await addRequirement(draftId, "D-1");
      const publishedRequirement = await addRequirement(publishedId, "P-1");
      await prisma.controlMapping.createMany({
        data: [
          { requirementId: requirement.id, controlId: control1.id, coverage: "FULL" },
          { requirementId: publishedRequirement.id, controlId: control1.id, coverage: "PARTIAL" },
        ],
      });

      const mappingsFor = async (userId: string) => {
        const { controls } = await (await listControls(req("/api/controls", "GET", userId))).json();
        const control = controls.find((c: { id: string }) => c.id === control1.id);
        return control.mappings.map((m: { requirement: { code: string } }) => m.requirement.code).sort();
      };
      expect(await mappingsFor(userIds.viewer)).toEqual(["P-1"]);
      expect(await mappingsFor(userIds.cm)).toEqual(["D-1", "P-1"]);
    });
  });

  describe("writes are restricted to COMPLIANCE_MANAGER and ADMIN", () => {
    it("403s a Viewer and a System Owner (401 signed out) on every write endpoint, and changes nothing", async () => {
      const requirement = await addRequirement(draftId, "W-1");
      const mapping = await prisma.controlMapping.create({
        data: { requirementId: requirement.id, controlId: control1.id, coverage: "FULL" },
      });
      const requirementPath = `/api/frameworks/${draftId}/requirements`;
      const requirementParams = { id: draftId, requirementId: requirement.id };
      const mappingParams = { ...requirementParams, mappingId: mapping.id };

      const writes: [string, (userId: string | null) => Promise<Response>][] = [
        ["publish", (u) => publishFramework(req(`/api/frameworks/${draftId}/publish`, "POST", u), params({ id: draftId }))],
        [
          "create Requirement",
          (u) =>
            createRequirement(
              req(requirementPath, "POST", u, { code: "X", section: "S", title: "T", text: "t" }),
              params({ id: draftId }),
            ),
        ],
        [
          "patch Requirement",
          (u) =>
            patchRequirement(req(`${requirementPath}/${requirement.id}`, "PATCH", u, { title: "Nope" }), params(requirementParams)),
        ],
        ["delete Requirement", (u) => deleteRequirement(req(`${requirementPath}/${requirement.id}`, "DELETE", u), params(requirementParams))],
        [
          "create mapping",
          (u) =>
            createMapping(
              req(`${requirementPath}/${requirement.id}/mappings`, "POST", u, { controlId: control2.id, coverage: "FULL" }),
              params(requirementParams),
            ),
        ],
        [
          "patch mapping",
          (u) =>
            patchMapping(
              req(`${requirementPath}/${requirement.id}/mappings/${mapping.id}`, "PATCH", u, { coverage: "PARTIAL" }),
              params(mappingParams),
            ),
        ],
        [
          "delete mapping",
          (u) => deleteMapping(req(`${requirementPath}/${requirement.id}/mappings/${mapping.id}`, "DELETE", u), params(mappingParams)),
        ],
      ];

      for (const [name, call] of writes) {
        for (const tag of ["viewer", "owner"]) {
          expect((await call(userIds[tag])).status, `${name} as ${tag}`).toBe(403);
        }
        expect((await call(null)).status, `${name} signed out`).toBe(401);
      }

      expect((await prisma.framework.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");
      expect(await prisma.requirement.count({ where: { frameworkId: draftId } })).toBe(1);
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } })).title).toBe("Title W-1");
      expect(await prisma.controlMapping.findMany({ where: { requirementId: requirement.id } })).toEqual([
        expect.objectContaining({ id: mapping.id, coverage: "FULL" }),
      ]);
      expect(await events("CONTROL_MAPPING_CHANGED")).toHaveLength(0);
      expect(await events("FRAMEWORK_PUBLISHED")).toHaveLength(0);
      expect(onFrameworkPublished).not.toHaveBeenCalled();
    });

    it("an Admin can author too", async () => {
      const response = await createRequirement(
        req(`/api/frameworks/${draftId}/requirements`, "POST", userIds.admin, {
          code: "A-1",
          section: "S",
          title: "T",
          text: "t",
        }),
        params({ id: draftId }),
      );
      expect(response.status).toBe(201);
    });
  });

  describe("Requirements", () => {
    const path = () => `/api/frameworks/${draftId}/requirements`;
    const create = (body: unknown, frameworkId = draftId) =>
      createRequirement(req(`/api/frameworks/${frameworkId}/requirements`, "POST", cm(), body), params({ id: frameworkId }));
    const valid = { code: "1.1", section: "Section 1", title: "A title", text: "An own-words paraphrase" };

    it("creates a Requirement (trimmed) and lists it grouped-ready by section then code", async () => {
      const response = await create({ ...valid, code: "  1.10 ", section: "B" });
      expect(response.status).toBe(201);
      expect((await response.json()).requirement).toMatchObject({ code: "1.10", section: "B", mappings: [] });
      await create({ ...valid, code: "1.2", section: "A" });
      await create({ ...valid, code: "1.1", section: "A" });

      const list = await listRequirements(req(path(), "GET", cm()), params({ id: draftId }));
      const { requirements } = await list.json();
      expect(requirements.map((r: { section: string; code: string }) => `${r.section}/${r.code}`)).toEqual([
        "A/1.1",
        "A/1.2",
        "B/1.10",
      ]);
    });

    it("validates the body: code, section, title and text are all required", async () => {
      for (const missing of ["code", "section", "title", "text"]) {
        const body: Record<string, string> = { ...valid };
        delete body[missing];
        expect((await create(body)).status, `missing ${missing}`).toBe(400);
        expect((await create({ ...valid, [missing]: "   " })).status, `blank ${missing}`).toBe(400);
      }
      expect(await prisma.requirement.count({ where: { frameworkId: draftId } })).toBe(0);
    });

    it("a code is unique within its Framework but reusable in another", async () => {
      expect((await create(valid)).status).toBe(201);
      expect((await create(valid)).status).toBe(409);
      expect((await create(valid, publishedId)).status).toBe(201);
    });

    it("404s on an unknown Framework", async () => {
      expect((await create(valid, "no-such-framework")).status).toBe(404);
    });

    it("edits a Requirement, refusing a duplicate code, an empty update, and another Framework's Requirement", async () => {
      const a = await addRequirement(draftId, "E-1");
      await addRequirement(draftId, "E-2");
      const other = await addRequirement(publishedId, "E-1");
      const patch = (requirementId: string, body: unknown, frameworkId = draftId) =>
        patchRequirement(
          req(`/api/frameworks/${frameworkId}/requirements/${requirementId}`, "PATCH", cm(), body),
          params({ id: frameworkId, requirementId }),
        );

      const ok = await patch(a.id, { title: "New title", text: "New text", section: "New section", code: "E-9" });
      expect(ok.status).toBe(200);
      expect((await ok.json()).requirement).toMatchObject({
        code: "E-9",
        title: "New title",
        text: "New text",
        section: "New section",
      });

      expect((await patch(a.id, { code: "E-2" })).status).toBe(409);
      expect((await patch(a.id, {})).status).toBe(400);
      expect((await patch(a.id, { title: "  " })).status).toBe(400);
      // `other` belongs to the published Framework, so it isn't reachable through the Draft's URL.
      expect((await patch(other.id, { title: "Hijack" })).status).toBe(404);
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: other.id } })).title).toBe("Title E-1");
      expect((await patch("no-such-requirement", { title: "x" })).status).toBe(404);
    });

    it("deletes a Requirement; a second delete is a 404", async () => {
      const a = await addRequirement(draftId, "D-1");
      const del = () =>
        deleteRequirement(
          req(`${path()}/${a.id}`, "DELETE", cm()),
          params({ id: draftId, requirementId: a.id }),
        );
      expect((await del()).status).toBe(204);
      expect(await prisma.requirement.findUnique({ where: { id: a.id } })).toBeNull();
      expect((await del()).status).toBe(404);
    });

    it("deleting a Requirement removes its mappings and logs one 'removed' event per mapping, naming the cascade", async () => {
      const a = await addRequirement(draftId, "D-2");
      await prisma.controlMapping.createMany({
        data: [
          { requirementId: a.id, controlId: control1.id, coverage: "FULL" },
          { requirementId: a.id, controlId: control2.id, coverage: "PARTIAL" },
        ],
      });

      const response = await deleteRequirement(
        req(`${path()}/${a.id}`, "DELETE", cm()),
        params({ id: draftId, requirementId: a.id }),
      );
      expect(response.status).toBe(204);
      expect(await prisma.controlMapping.count({ where: { requirementId: a.id } })).toBe(0);

      const logged = await events("CONTROL_MAPPING_CHANGED");
      expect(logged).toHaveLength(2);
      expect(logged.every((e) => e.systemId === null && e.actorId === cm())).toBe(true);
      expect(logged.map((e) => e.detail).sort()).toEqual(
        [
          `Control Mapping removed: Requirement ${draftLabel} D-2 ↔ Control ${control1.code} (FULL → none); Requirement deleted`,
          `Control Mapping removed: Requirement ${draftLabel} D-2 ↔ Control ${control2.code} (PARTIAL → none); Requirement deleted`,
        ].sort(),
      );
    });

    it("deleting a Requirement with no mappings logs nothing", async () => {
      const a = await addRequirement(draftId, "D-3");
      await deleteRequirement(req(`${path()}/${a.id}`, "DELETE", cm()), params({ id: draftId, requirementId: a.id }));
      expect(await events("CONTROL_MAPPING_CHANGED")).toHaveLength(0);
    });
  });

  describe("Control Mappings", () => {
    let requirementId: string;
    const base = () => `/api/frameworks/${draftId}/requirements/${requirementId}/mappings`;
    const add = (body: unknown, userId = cm()) =>
      createMapping(req(base(), "POST", userId, body), params({ id: draftId, requirementId }));
    const patch = (mappingId: string, body: unknown) =>
      patchMapping(req(`${base()}/${mappingId}`, "PATCH", cm(), body), params({ id: draftId, requirementId, mappingId }));
    const remove = (mappingId: string) =>
      deleteMapping(req(`${base()}/${mappingId}`, "DELETE", cm()), params({ id: draftId, requirementId, mappingId }));
    const detail = (change: string, control: { code: string }, change2: string) =>
      `Control Mapping ${change}: Requirement ${draftLabel} M-1 ↔ Control ${control.code} (${change2})`;

    beforeEach(async () => {
      requirementId = (await addRequirement(draftId, "M-1")).id;
    });

    it("adds a mapping with Full or Partial Coverage and an optional rationale, and logs a System-less event by the acting user", async () => {
      const full = await add({ controlId: control1.id, coverage: "FULL" });
      expect(full.status).toBe(201);
      expect((await full.json()).mapping).toMatchObject({ coverage: "FULL", rationale: null, control: { code: control1.code } });

      const partial = await add({ controlId: control2.id, coverage: "PARTIAL", rationale: "Covers only backups" });
      expect(partial.status).toBe(201);
      expect((await partial.json()).mapping).toMatchObject({ coverage: "PARTIAL", rationale: "Covers only backups" });

      const logged = await events("CONTROL_MAPPING_CHANGED");
      expect(logged.map((e) => [e.systemId, e.actorId, e.detail])).toEqual([
        [null, cm(), detail("added", control1, "none → FULL")],
        [null, cm(), detail("added", control2, "none → PARTIAL")],
      ]);
    });

    it("validates: coverage must be FULL or PARTIAL, the Control must exist, and a pair maps only once", async () => {
      expect((await add({ controlId: control1.id })).status).toBe(400);
      expect((await add({ controlId: control1.id, coverage: "HALF" })).status).toBe(400);
      expect((await add({ coverage: "FULL" })).status).toBe(400);
      expect((await add({ controlId: "no-such-control", coverage: "FULL" })).status).toBe(400);
      expect((await add({ controlId: control1.id, coverage: "FULL" })).status).toBe(201);
      expect((await add({ controlId: control1.id, coverage: "PARTIAL" })).status).toBe(409);
      expect(await prisma.controlMapping.count({ where: { requirementId } })).toBe(1);
      expect(await events("CONTROL_MAPPING_CHANGED")).toHaveLength(1);
    });

    it("404s when the Requirement isn't in that Framework", async () => {
      const response = await createMapping(
        req(`/api/frameworks/${publishedId}/requirements/${requirementId}/mappings`, "POST", cm(), {
          controlId: control1.id,
          coverage: "FULL",
        }),
        params({ id: publishedId, requirementId }),
      );
      expect(response.status).toBe(404);
    });

    it("a Requirement maps to several Controls, and a Control to several Requirements", async () => {
      const other = await addRequirement(publishedId, "M-2");
      expect((await add({ controlId: control1.id, coverage: "FULL" })).status).toBe(201);
      expect((await add({ controlId: control2.id, coverage: "FULL" })).status).toBe(201);
      const second = await createMapping(
        req(`/api/frameworks/${publishedId}/requirements/${other.id}/mappings`, "POST", cm(), {
          controlId: control1.id,
          coverage: "PARTIAL",
        }),
        params({ id: publishedId, requirementId: other.id }),
      );
      expect(second.status).toBe(201);
      expect(await prisma.controlMapping.count({ where: { controlId: control1.id } })).toBe(2);
    });

    it("changing Coverage logs old → new; a rationale-only edit and a no-op Coverage 'change' log nothing", async () => {
      const { mapping } = await (await add({ controlId: control1.id, coverage: "FULL" })).json();

      const changed = await patch(mapping.id, { coverage: "PARTIAL", rationale: "Only in part" });
      expect(changed.status).toBe(200);
      expect((await changed.json()).mapping).toMatchObject({ coverage: "PARTIAL", rationale: "Only in part" });

      expect((await patch(mapping.id, { rationale: "Reworded" })).status).toBe(200);
      expect((await patch(mapping.id, { coverage: "PARTIAL" })).status).toBe(200);
      expect((await patch(mapping.id, { rationale: null })).status).toBe(200);
      expect((await prisma.controlMapping.findUniqueOrThrow({ where: { id: mapping.id } })).rationale).toBeNull();

      const logged = await events("CONTROL_MAPPING_CHANGED");
      expect(logged.map((e) => e.detail)).toEqual([
        detail("added", control1, "none → FULL"),
        detail("changed", control1, "FULL → PARTIAL"),
      ]);
      expect(logged.every((e) => e.systemId === null && e.actorId === cm())).toBe(true);
    });

    it("rejects an invalid or empty mapping update, and an unknown mapping", async () => {
      const { mapping } = await (await add({ controlId: control1.id, coverage: "FULL" })).json();
      expect((await patch(mapping.id, {})).status).toBe(400);
      expect((await patch(mapping.id, { coverage: "HALF" })).status).toBe(400);
      expect((await patch("no-such-mapping", { coverage: "PARTIAL" })).status).toBe(404);
      expect((await remove("no-such-mapping")).status).toBe(404);
    });

    it("can't reach a mapping through another Requirement's URL", async () => {
      const { mapping } = await (await add({ controlId: control1.id, coverage: "FULL" })).json();
      const otherRequirement = await addRequirement(draftId, "M-3");
      const wrong = { id: draftId, requirementId: otherRequirement.id, mappingId: mapping.id };
      const wrongBase = `/api/frameworks/${draftId}/requirements/${otherRequirement.id}/mappings/${mapping.id}`;
      expect((await patchMapping(req(wrongBase, "PATCH", cm(), { coverage: "PARTIAL" }), params(wrong))).status).toBe(404);
      expect((await deleteMapping(req(wrongBase, "DELETE", cm()), params(wrong))).status).toBe(404);
      expect((await prisma.controlMapping.findUniqueOrThrow({ where: { id: mapping.id } })).coverage).toBe("FULL");
    });

    it("removing a mapping deletes it and logs old Coverage → none", async () => {
      const { mapping } = await (await add({ controlId: control1.id, coverage: "PARTIAL" })).json();
      expect((await remove(mapping.id)).status).toBe(204);
      expect(await prisma.controlMapping.findUnique({ where: { id: mapping.id } })).toBeNull();

      const logged = await events("CONTROL_MAPPING_CHANGED");
      expect(logged.map((e) => e.detail)).toEqual([
        detail("added", control1, "none → PARTIAL"),
        detail("removed", control1, "PARTIAL → none"),
      ]);
      expect(logged[1]).toMatchObject({ systemId: null, actorId: cm() });
    });

    it("mapping changes on a Published Framework work the same way (and log)", async () => {
      const published = await addRequirement(publishedId, "M-9");
      const response = await createMapping(
        req(`/api/frameworks/${publishedId}/requirements/${published.id}/mappings`, "POST", userIds.admin, {
          controlId: control1.id,
          coverage: "FULL",
        }),
        params({ id: publishedId, requirementId: published.id }),
      );
      expect(response.status).toBe(201);
      const logged = await events("CONTROL_MAPPING_CHANGED");
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ systemId: null, actorId: userIds.admin });
      expect(logged[0].detail).toContain(`Test Authoring Published FW ${SUFFIX}:1 M-9`);
    });
  });

  describe("Publish", () => {
    const publish = (frameworkId: string, userId: string | null = cm()) =>
      publishFramework(req(`/api/frameworks/${frameworkId}/publish`, "POST", userId), params({ id: frameworkId }));

    it("publishes a Draft: Published status, a System-less FRAMEWORK_PUBLISHED event by the actor, and the hook is called once", async () => {
      await addRequirement(draftId, "PUB-1");
      await addRequirement(draftId, "PUB-2");

      const response = await publish(draftId);
      expect(response.status).toBe(200);
      expect((await response.json()).framework).toMatchObject({ id: draftId, status: "PUBLISHED", _count: { requirements: 2 } });
      expect((await prisma.framework.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("PUBLISHED");

      const logged = await events("FRAMEWORK_PUBLISHED");
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        systemId: null,
        actorId: cm(),
        detail: `Framework "${draftLabel}" published (2 Requirements)`,
      });
      expect(onFrameworkPublished).toHaveBeenCalledTimes(1);
      expect(onFrameworkPublished).toHaveBeenCalledWith(draftId);
    });

    it("once Published, everyone can see it", async () => {
      await publish(draftId);
      const detail = await getFramework(req(`/api/frameworks/${draftId}`, "GET", userIds.viewer), params({ id: draftId }));
      expect(detail.status).toBe(200);
      const { frameworks } = await (await listFrameworks(req("/api/frameworks", "GET", userIds.owner))).json();
      expect(frameworks.map((f: { id: string }) => f.id)).toContain(draftId);
    });

    it("is one-way: publishing again is a 409 with no second event or hook call, and Draft can't be restored", async () => {
      expect((await publish(draftId)).status).toBe(200);
      expect((await publish(draftId)).status).toBe(409);
      expect(await events("FRAMEWORK_PUBLISHED")).toHaveLength(1);
      expect(onFrameworkPublished).toHaveBeenCalledTimes(1);

      const back = await patchFramework(
        req(`/api/frameworks/${draftId}`, "PATCH", cm(), { status: "DRAFT" }),
        params({ id: draftId }),
      );
      expect(back.status).toBe(409);
      expect((await prisma.framework.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("PUBLISHED");
    });

    it("PATCH refuses to publish a Draft (use the publish endpoint) and accepts a same-status no-op", async () => {
      const viaPatch = await patchFramework(
        req(`/api/frameworks/${draftId}`, "PATCH", cm(), { status: "PUBLISHED" }),
        params({ id: draftId }),
      );
      expect(viaPatch.status).toBe(400);
      expect((await prisma.framework.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");

      const noop = await patchFramework(
        req(`/api/frameworks/${draftId}`, "PATCH", cm(), { status: "DRAFT", description: "Edited" }),
        params({ id: draftId }),
      );
      expect(noop.status).toBe(200);
      expect((await noop.json()).framework).toMatchObject({ status: "DRAFT", description: "Edited" });
    });

    it("404s on an unknown Framework and 403s a non-curator", async () => {
      expect((await publish("no-such-framework")).status).toBe(404);
      expect((await publish(draftId, userIds.viewer)).status).toBe(403);
      expect((await publish(draftId, userIds.owner)).status).toBe(403);
      expect(onFrameworkPublished).not.toHaveBeenCalled();
    });
  });
});
