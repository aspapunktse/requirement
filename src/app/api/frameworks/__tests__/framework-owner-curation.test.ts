import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { cleanupFixtureRequirements, createFixtureFramework, getBaseFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { loadFrameworksView } from "@/app/frameworks/frameworks-data";
import { loadCoverageView } from "@/app/frameworks/[id]/coverage/coverage-data";
import { GET as getFramework, PATCH as patchFramework, DELETE as deleteFramework } from "../[id]/route";
import { GET as listFrameworks } from "../route";
import { GET as listRequirements, POST as createRequirement } from "../[id]/requirements/route";
import { PATCH as patchRequirement, DELETE as deleteRequirement } from "../[id]/requirements/[requirementId]/route";
import { POST as createMapping } from "../[id]/requirements/[requirementId]/mappings/route";
import { PATCH as patchMapping, DELETE as deleteMapping } from "../[id]/requirements/[requirementId]/mappings/[mappingId]/route";
import { PUT as acceptGap, DELETE as unacceptGap } from "../[id]/requirements/[requirementId]/gap-acceptance/route";
import { PUT as acceptGaps } from "../[id]/gap-acceptances/route";
import { POST as createSupplementary } from "../[id]/requirements/[requirementId]/supplementary-control/route";
import { PUT as tieGroup, DELETE as untieGroup } from "../[id]/review-group/route";
import { POST as publish } from "../[id]/publish/route";
import { PUT as putFirstRound } from "../[id]/first-round-controls/[controlId]/route";
import { GET as getCoverage } from "../[id]/coverage/route";

/**
 * A Framework Owner curates their own non-base Framework (#320): Requirements, Control Mappings, gaps, Supplementary
 * Controls, the descriptive details, the Review Group tie and publishing, and sees it while it is a Draft. The same
 * user gets 403 on a Framework they don't own, and the owner of the base Framework gets 403 on base curation. A
 * Compliance Manager keeps every right. Fixtures are created here (CI's database is not seeded) and removed in afterAll.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, method: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest("http://localhost/api/test", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

type UserKey = "cm" | "admin" | "owner" | "other" | "baseOwner" | "stranger";

describe("Framework Owner curation (#320)", () => {
  const users = {} as Record<UserKey, string>;
  const controlIds: string[] = [];
  const groupIds: string[] = [];
  let fw: { id: string; name: string; version: string }; // Published, owned by `owner`
  let fwOther: { id: string }; // Published, owned by `other`
  let fwDraft: { id: string }; // Draft, owned by `owner`
  let base: { id: string; ownerId: string | null };
  let originalBaseOwner: string | null;
  let c1: string;
  let c2: string;
  let gapReq: string; // in fw, no mapping
  let otherReq: string; // in fwOther, mapped to c1
  let otherMapping: string;

  const as = (key: UserKey) => users[key];
  const fwFields = (id: string) => prisma.framework.findUniqueOrThrow({ where: { id } });
  const reqCount = (frameworkId: string) => prisma.requirement.count({ where: { frameworkId } });
  const mappingCount = (frameworkId: string) => prisma.controlMapping.count({ where: { requirement: { frameworkId } } });
  const events = () => prisma.changeEvent.count({ where: { actorId: { in: Object.values(users) } } });

  async function makeControl(tag: string) {
    const control = await prisma.control.create({
      data: { code: `TEST-OC-${tag}-${SUFFIX}`, title: `Test OC ${tag}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL", mandatory: false },
    });
    controlIds.push(control.id);
    return control.id;
  }
  const newRequirement = (frameworkId: string, tag: string) =>
    prisma.requirement.create({ data: { frameworkId, code: `TEST-OC-R-${tag}-${SUFFIX}`, section: "Test", title: `Test OC ${tag}`, text: "t" } });

  beforeAll(async () => {
    const roles: Record<UserKey, UserRole> = {
      cm: "COMPLIANCE_MANAGER",
      admin: "ADMIN",
      owner: "VIEWER",
      other: "VIEWER",
      baseOwner: "VIEWER",
      stranger: "SYSTEM_OWNER",
    };
    for (const [key, role] of Object.entries(roles)) {
      users[key as UserKey] = (await prisma.user.create({ data: { email: `test-oc-${key}-${SUFFIX}@example.com`, name: `Test oc ${key}`, role } })).id;
    }
    fw = await createFixtureFramework("OC Owned");
    fwOther = await createFixtureFramework("OC Other");
    fwDraft = await createFixtureFramework("OC Draft");
    await prisma.framework.update({ where: { id: fw.id }, data: { ownerId: users.owner } });
    await prisma.framework.update({ where: { id: fwOther.id }, data: { ownerId: users.other } });
    await prisma.framework.update({ where: { id: fwDraft.id }, data: { ownerId: users.owner, status: "DRAFT" } });
    base = await getBaseFramework();
    originalBaseOwner = base.ownerId;
    await prisma.framework.update({ where: { id: base.id }, data: { ownerId: users.baseOwner } });

    c1 = await makeControl("1");
    c2 = await makeControl("2");
    await mapControlsToFramework(fw.id, [c1]);
    gapReq = (await newRequirement(fw.id, "gap")).id;
    otherReq = await mapControlsToFramework(fwOther.id, [c1]);
    otherMapping = (await prisma.controlMapping.findFirstOrThrow({ where: { requirementId: otherReq } })).id;
  });

  afterAll(async () => {
    await prisma.framework.update({ where: { id: base.id }, data: { ownerId: originalBaseOwner } });
    await prisma.framework.updateMany({ where: { reviewGroupId: { in: groupIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groupIds } } });
    // Supplementary Controls reference their origin Framework, so they go before the fixture Frameworks do.
    await prisma.control.deleteMany({ where: { code: { startsWith: "TEST-OC-SUP-" }, originFramework: { name: { startsWith: "Test OC " } } } });
    await cleanupFixtureRequirements();
    await prisma.requirement.deleteMany({ where: { code: { contains: SUFFIX } } });
    await prisma.control.deleteMany({ where: { OR: [{ id: { in: controlIds } }, { code: { contains: SUFFIX } }] } });
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(users) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("Requirements", () => {
    const body = (tag: string) => ({ code: `TEST-OC-NEW-${tag}-${SUFFIX}`, section: "Test", title: "New", text: "text" });

    it("lets the owner create, edit and delete a Requirement of their Framework", async () => {
      const created = await createRequirement(requestAs(as("owner"), "POST", body("a")), ctx({ id: fw.id }));
      expect(created.status).toBe(201);
      const { requirement } = await created.json();
      const edited = await patchRequirement(requestAs(as("owner"), "PATCH", { title: "Edited" }), ctx({ id: fw.id, requirementId: requirement.id }));
      expect(edited.status).toBe(200);
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } })).title).toBe("Edited");
      const removed = await deleteRequirement(requestAs(as("owner"), "DELETE"), ctx({ id: fw.id, requirementId: requirement.id }));
      expect(removed.status).toBe(204);
      expect(await prisma.requirement.count({ where: { id: requirement.id } })).toBe(0);
    });

    it("still lets a Compliance Manager and an Admin create", async () => {
      for (const key of ["cm", "admin"] as const) {
        const response = await createRequirement(requestAs(as(key), "POST", body(key)), ctx({ id: fw.id }));
        expect(response.status).toBe(201);
      }
    });

    it("refuses the same user on a Framework they don't own, and the base Framework's owner on the base, changing nothing", async () => {
      const beforeOther = await reqCount(fwOther.id);
      const beforeBase = await reqCount(base.id);
      expect((await createRequirement(requestAs(as("owner"), "POST", body("x")), ctx({ id: fwOther.id }))).status).toBe(403);
      expect((await createRequirement(requestAs(as("baseOwner"), "POST", body("y")), ctx({ id: base.id }))).status).toBe(403);
      expect((await patchRequirement(requestAs(as("owner"), "PATCH", { title: "Nope" }), ctx({ id: fwOther.id, requirementId: otherReq }))).status).toBe(403);
      expect((await deleteRequirement(requestAs(as("owner"), "DELETE"), ctx({ id: fwOther.id, requirementId: otherReq }))).status).toBe(403);
      expect((await deleteRequirement(requestAs(as("baseOwner"), "DELETE"), ctx({ id: base.id, requirementId: "none" }))).status).toBe(403);
      expect(await reqCount(fwOther.id)).toBe(beforeOther);
      expect(await reqCount(base.id)).toBe(beforeBase);
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: otherReq } })).title).not.toBe("Nope");
    });

    it("answers 401 to an anonymous caller and 404 for a Requirement of another Framework in the URL", async () => {
      expect((await createRequirement(requestAs(null, "POST", body("z")), ctx({ id: fw.id }))).status).toBe(401);
      expect((await patchRequirement(requestAs(as("owner"), "PATCH", { title: "Hop" }), ctx({ id: fw.id, requirementId: otherReq }))).status).toBe(404);
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: otherReq } })).title).not.toBe("Hop");
    });
  });

  describe("Control Mappings and Coverage", () => {
    it("lets the owner add, change and remove a mapping, and records each as a Change Event by the owner", async () => {
      const before = await events();
      const created = await createMapping(requestAs(as("owner"), "POST", { controlId: c2, coverage: "PARTIAL" }), ctx({ id: fw.id, requirementId: gapReq }));
      expect(created.status).toBe(201);
      const { mapping } = await created.json();
      const changed = await patchMapping(requestAs(as("owner"), "PATCH", { coverage: "FULL" }), ctx({ id: fw.id, requirementId: gapReq, mappingId: mapping.id }));
      expect(changed.status).toBe(200);
      expect((await prisma.controlMapping.findUniqueOrThrow({ where: { id: mapping.id } })).coverage).toBe("FULL");
      const removed = await deleteMapping(requestAs(as("owner"), "DELETE"), ctx({ id: fw.id, requirementId: gapReq, mappingId: mapping.id }));
      expect(removed.status).toBe(204);
      expect(await events()).toBe(before + 3);
      expect(await prisma.changeEvent.count({ where: { actorId: users.owner, action: "CONTROL_MAPPING_CHANGED" } })).toBe(3);
    });

    it("still lets a Compliance Manager add a mapping", async () => {
      const created = await createMapping(requestAs(as("cm"), "POST", { controlId: c2, coverage: "PARTIAL" }), ctx({ id: fw.id, requirementId: gapReq }));
      expect(created.status).toBe(201);
      const { mapping } = await created.json();
      expect((await deleteMapping(requestAs(as("cm"), "DELETE"), ctx({ id: fw.id, requirementId: gapReq, mappingId: mapping.id }))).status).toBe(204);
    });

    it("refuses the same user on another Framework and the base owner on the base, writing nothing", async () => {
      const before = { other: await mappingCount(fwOther.id), base: await mappingCount(base.id), events: await events() };
      expect((await createMapping(requestAs(as("owner"), "POST", { controlId: c2, coverage: "FULL" }), ctx({ id: fwOther.id, requirementId: otherReq }))).status).toBe(403);
      expect((await patchMapping(requestAs(as("owner"), "PATCH", { coverage: "PARTIAL" }), ctx({ id: fwOther.id, requirementId: otherReq, mappingId: otherMapping }))).status).toBe(403);
      expect((await deleteMapping(requestAs(as("owner"), "DELETE"), ctx({ id: fwOther.id, requirementId: otherReq, mappingId: otherMapping }))).status).toBe(403);
      expect((await createMapping(requestAs(as("baseOwner"), "POST", { controlId: c2, coverage: "FULL" }), ctx({ id: base.id, requirementId: "none" }))).status).toBe(403);
      expect(await mappingCount(fwOther.id)).toBe(before.other);
      expect(await mappingCount(base.id)).toBe(before.base);
      expect(await events()).toBe(before.events);
      expect((await prisma.controlMapping.findUniqueOrThrow({ where: { id: otherMapping } })).coverage).toBe("FULL");
    });
  });

  describe("Coverage Gaps and Supplementary Controls", () => {
    const gapState = (id: string) => prisma.requirement.findUniqueOrThrow({ where: { id }, select: { gapAcceptedAt: true, gapAcceptedById: true, gapJustification: true } });

    it("lets the owner accept, edit and un-accept a gap, and accept several at once", async () => {
      const accepted = await acceptGap(requestAs(as("owner"), "PUT", { justification: "Out of scope" }), ctx({ id: fw.id, requirementId: gapReq }));
      expect(accepted.status).toBe(200);
      expect(await gapState(gapReq)).toMatchObject({ gapAcceptedById: users.owner, gapJustification: "Out of scope" });
      expect((await acceptGap(requestAs(as("owner"), "PUT", { justification: "Edited" }), ctx({ id: fw.id, requirementId: gapReq }))).status).toBe(200);
      expect((await unacceptGap(requestAs(as("owner"), "DELETE"), ctx({ id: fw.id, requirementId: gapReq }))).status).toBe(204);
      expect((await gapState(gapReq)).gapAcceptedAt).toBeNull();
      const second = await newRequirement(fw.id, "gap2");
      const bulk = await acceptGaps(requestAs(as("owner"), "PUT", { requirementIds: [gapReq, second.id], justification: "Bulk" }), ctx({ id: fw.id }));
      expect(bulk.status).toBe(200);
      expect((await gapState(second.id)).gapJustification).toBe("Bulk");
      for (const id of [gapReq, second.id]) await unacceptGap(requestAs(as("cm"), "DELETE"), ctx({ id: fw.id, requirementId: id }));
    });

    it("still lets a Compliance Manager accept", async () => {
      expect((await acceptGap(requestAs(as("cm"), "PUT", { justification: "CM" }), ctx({ id: fw.id, requirementId: gapReq }))).status).toBe(200);
      await unacceptGap(requestAs(as("cm"), "DELETE"), ctx({ id: fw.id, requirementId: gapReq }));
    });

    it("refuses the same user on another Framework and the base owner on the base, writing nothing", async () => {
      const open = await newRequirement(fwOther.id, "gap3");
      expect((await acceptGap(requestAs(as("owner"), "PUT", { justification: "x" }), ctx({ id: fwOther.id, requirementId: open.id }))).status).toBe(403);
      expect((await acceptGaps(requestAs(as("owner"), "PUT", { requirementIds: [open.id], justification: "x" }), ctx({ id: fwOther.id }))).status).toBe(403);
      expect((await acceptGap(requestAs(as("baseOwner"), "PUT", { justification: "x" }), ctx({ id: base.id, requirementId: "none" }))).status).toBe(403);
      expect((await acceptGaps(requestAs(as("baseOwner"), "PUT", { requirementIds: ["none"], justification: "x" }), ctx({ id: base.id }))).status).toBe(403);
      expect((await unacceptGap(requestAs(as("owner"), "DELETE"), ctx({ id: fwOther.id, requirementId: open.id }))).status).toBe(403);
      expect((await gapState(open.id)).gapAcceptedAt).toBeNull();
    });

    const control = (tag: string) => ({ code: `TEST-OC-SUP-${tag}-${SUFFIX}`, title: "Supplementary", description: "d", category: "Test", applicability: "ORGANIZATIONAL" });

    it("lets the owner author a Supplementary Control, with its mapping and Change Event, and refuses it elsewhere", async () => {
      const before = await events();
      const created = await createSupplementary(requestAs(as("owner"), "POST", control("a")), ctx({ id: fw.id, requirementId: gapReq }));
      expect(created.status).toBe(201);
      const stored = await prisma.control.findUniqueOrThrow({ where: { code: control("a").code } });
      expect(stored.originFrameworkId).toBe(fw.id);
      expect(await prisma.controlMapping.count({ where: { requirementId: gapReq, controlId: stored.id, coverage: "FULL" } })).toBe(1);
      expect(await events()).toBe(before + 1);
      const refused = await createSupplementary(requestAs(as("owner"), "POST", control("b")), ctx({ id: fwOther.id, requirementId: otherReq }));
      expect(refused.status).toBe(403);
      expect((await createSupplementary(requestAs(as("baseOwner"), "POST", control("c")), ctx({ id: base.id, requirementId: "none" }))).status).toBe(403);
      expect(await prisma.control.count({ where: { code: { in: [control("b").code, control("c").code] } } })).toBe(0);
    });
  });

  describe("the Framework's own details", () => {
    const patch = (key: UserKey | null, id: string, body: unknown) => patchFramework(requestAs(key ? as(key) : null, "PATCH", body), ctx({ id }));

    it("lets the owner change the description and the onboarding question and hint", async () => {
      const response = await patch("owner", fw.id, { description: "By the owner", onboardingQuestion: "Does it hold data?", onboardingHint: "Any data." });
      expect(response.status).toBe(200);
      expect(await fwFields(fw.id)).toMatchObject({ description: "By the owner", onboardingQuestion: "Does it hold data?", onboardingHint: "Any data." });
      expect((await patch("owner", fw.id, { onboardingQuestion: null, onboardingHint: null })).status).toBe(200);
      expect((await fwFields(fw.id)).onboardingQuestion).toBeNull();
    });

    it("refuses the owner's attempt on ownerId, isBase, name, licensing, strictness, supersedes and status, changing nothing", async () => {
      const before = await fwFields(fw.id);
      for (const body of [
        { ownerId: users.stranger },
        { ownerId: null },
        { isBase: true },
        { isBase: false },
        { name: "Renamed" },
        { version: "9" },
        { licensing: "QUOTABLE" },
        { strictComplianceRequired: true },
        { supersedesId: fwOther.id },
        { status: "PUBLISHED" },
      ]) {
        expect((await patch("owner", fw.id, body)).status).toBe(403);
      }
      expect(await fwFields(fw.id)).toEqual(before);
    });

    it("refuses a body that mixes allowed and forbidden fields in full", async () => {
      const before = await fwFields(fw.id);
      expect((await patch("owner", fw.id, { description: "Sneaky", ownerId: users.owner })).status).toBe(403);
      expect(await fwFields(fw.id)).toEqual(before);
    });

    it("refuses the owner on a Framework they don't own and on the base, and a Compliance Manager still changes the owner", async () => {
      const beforeOther = await fwFields(fwOther.id);
      const beforeBase = await fwFields(base.id);
      expect((await patch("owner", fwOther.id, { description: "x" })).status).toBe(403);
      expect((await patch("baseOwner", base.id, { description: "x" })).status).toBe(403);
      expect((await patch("baseOwner", base.id, { ownerId: null })).status).toBe(403);
      expect(await fwFields(fwOther.id)).toEqual(beforeOther);
      expect(await fwFields(base.id)).toEqual(beforeBase);
      expect((await patch("cm", fw.id, { ownerId: users.owner })).status).toBe(200);
    });

    it("refuses the owner's DELETE of their Framework, which stays", async () => {
      const response = await deleteFramework(requestAs(as("owner"), "DELETE"), ctx({ id: fw.id }));
      expect(response.status).toBe(403);
      expect(await prisma.framework.count({ where: { id: fw.id } })).toBe(1);
    });
  });

  describe("tying a Review Group", () => {
    it("lets the owner tie and untie, and refuses a Framework they don't own and the base", async () => {
      const group = await prisma.reviewGroup.create({ data: { name: `Test OC Group ${SUFFIX}` } });
      groupIds.push(group.id);
      const tied = await tieGroup(requestAs(as("owner"), "PUT", { reviewGroupId: group.id }), ctx({ id: fw.id }));
      expect(tied.status).toBe(200);
      expect((await fwFields(fw.id)).reviewGroupId).toBe(group.id);
      expect((await untieGroup(requestAs(as("owner"), "DELETE"), ctx({ id: fw.id }))).status).toBe(200);
      expect((await fwFields(fw.id)).reviewGroupId).toBeNull();

      expect((await tieGroup(requestAs(as("owner"), "PUT", { reviewGroupId: group.id }), ctx({ id: fwOther.id }))).status).toBe(403);
      expect((await tieGroup(requestAs(as("baseOwner"), "PUT", { reviewGroupId: group.id }), ctx({ id: base.id }))).status).toBe(403);
      expect((await untieGroup(requestAs(as("owner"), "DELETE"), ctx({ id: fwOther.id }))).status).toBe(403);
      expect((await fwFields(fwOther.id)).reviewGroupId).toBeNull();
      expect((await fwFields(base.id)).reviewGroupId).toBeNull();
      // A Compliance Manager still can.
      expect((await tieGroup(requestAs(as("cm"), "PUT", { reviewGroupId: group.id }), ctx({ id: fwOther.id }))).status).toBe(200);
      expect((await untieGroup(requestAs(as("cm"), "DELETE"), ctx({ id: fwOther.id }))).status).toBe(200);
    });
  });

  describe("a Draft Framework", () => {
    it("is seen by its owner and by nobody else without Draft rights", async () => {
      const get = (key: UserKey, id = fwDraft.id) => getFramework(requestAs(as(key), "GET"), ctx({ id }));
      expect((await get("owner")).status).toBe(200);
      expect((await get("cm")).status).toBe(200);
      expect((await get("other")).status).toBe(404);
      expect((await get("stranger")).status).toBe(404);
      expect((await listRequirements(requestAs(as("owner"), "GET"), ctx({ id: fwDraft.id }))).status).toBe(200);
      expect((await listRequirements(requestAs(as("other"), "GET"), ctx({ id: fwDraft.id }))).status).toBe(404);
      expect((await getCoverage(requestAs(as("owner"), "GET"), ctx({ id: fwDraft.id }))).status).toBe(200);
      expect((await getCoverage(requestAs(as("other"), "GET"), ctx({ id: fwDraft.id }))).status).toBe(404);
      // The plain list that pickers use stays Published-only for them.
      const listed = (await (await listFrameworks(requestAs(as("owner"), "GET"))).json()).frameworks.map((f: { id: string }) => f.id);
      expect(listed).not.toContain(fwDraft.id);
      const curatable = (
        await (await listFrameworks(new NextRequest("http://localhost/api/frameworks?curatable=true", { headers: { cookie: `${ACTING_USER_COOKIE}=${users.owner}` } }))).json()
      ).frameworks.map((f: { id: string }) => f.id);
      expect(curatable).toContain(fwDraft.id);
      expect(curatable).toContain(fw.id);
      expect(curatable).not.toContain(fwOther.id);
      expect(curatable).not.toContain(base.id);
    });

    it("lets the owner mark first round on it, and not another user", async () => {
      await mapControlsToFramework(fwDraft.id, [c1]);
      expect((await putFirstRound(requestAs(as("owner"), "PUT", { firstRound: true }), ctx({ id: fwDraft.id, controlId: c1 }))).status).toBe(200);
      expect((await putFirstRound(requestAs(as("other"), "PUT", { firstRound: true }), ctx({ id: fwDraft.id, controlId: c1 }))).status).toBe(404);
      expect(await prisma.frameworkFirstRoundControl.count({ where: { frameworkId: fwDraft.id } })).toBe(1);
    });

    it("lets its owner publish it, once; refuses another user and the base's owner, changing nothing", async () => {
      expect((await publish(requestAs(as("other"), "POST"), ctx({ id: fwDraft.id }))).status).toBe(403);
      expect((await publish(requestAs(as("baseOwner"), "POST"), ctx({ id: base.id }))).status).toBe(403);
      expect((await fwFields(fwDraft.id)).status).toBe("DRAFT");
      const before = await prisma.changeEvent.count({ where: { action: "FRAMEWORK_PUBLISHED", actorId: users.owner } });
      const response = await publish(requestAs(as("owner"), "POST"), ctx({ id: fwDraft.id }));
      expect(response.status).toBe(200);
      expect((await fwFields(fwDraft.id)).status).toBe("PUBLISHED");
      expect(await prisma.changeEvent.count({ where: { action: "FRAMEWORK_PUBLISHED", actorId: users.owner } })).toBe(before + 1);
      expect((await publish(requestAs(as("owner"), "POST"), ctx({ id: fwDraft.id }))).status).toBe(409);
    });
  });

  describe("pages", () => {
    const actor = (key: UserKey, role: UserRole) => ({ id: users[key], role });

    it("shows the owner their Draft in the list and the coverage page with curation on, and a non-owner neither", async () => {
      const draft = await prisma.framework.create({
        data: { name: `Test OC Page Draft ${SUFFIX}`, version: "1", status: "DRAFT", ownerId: users.owner },
      });
      try {
        const ownerView = await loadFrameworksView(actor("owner", "VIEWER"));
        expect(ownerView.rows.find((r) => r.id === draft.id)).toMatchObject({ status: "DRAFT", canCurate: true });
        expect(ownerView.canCurate).toBe(false);
        expect(ownerView.rows.find((r) => r.id === fwOther.id)?.canCurate).toBe(false);
        expect(ownerView.rows.find((r) => r.id === base.id)?.canCurate).toBe(false);
        expect((await loadFrameworksView(actor("other", "VIEWER"))).rows.some((r) => r.id === draft.id)).toBe(false);
        expect((await loadFrameworksView(actor("cm", "COMPLIANCE_MANAGER"))).rows.find((r) => r.id === draft.id)?.canCurate).toBe(true);

        const coverage = await loadCoverageView(actor("owner", "VIEWER"), draft.id);
        expect(coverage).toMatchObject({ canCurate: true, canAssignOwner: false, canMarkFirstRound: true });
        expect(coverage?.controls.length).toBeGreaterThan(0);
        expect(coverage?.frameworks.some((f) => f.id === draft.id)).toBe(true);
        expect(await loadCoverageView(actor("other", "VIEWER"), draft.id)).toBeNull();
        expect((await loadCoverageView(actor("cm", "COMPLIANCE_MANAGER"), draft.id))?.canAssignOwner).toBe(true);
      } finally {
        await prisma.framework.delete({ where: { id: draft.id } });
      }
    });

    it("gives the owner no curation of a Framework they don't own, nor of the base", async () => {
      expect(await loadCoverageView(actor("owner", "VIEWER"), fwOther.id)).toMatchObject({ canCurate: false, controls: [], canMarkFirstRound: false });
      const baseView = await loadCoverageView(actor("baseOwner", "VIEWER"), base.id);
      expect(baseView).toMatchObject({ canCurate: false, canAssignOwner: false, canMarkFirstRound: true, controls: [] });
      expect(await loadCoverageView(actor("cm", "COMPLIANCE_MANAGER"), base.id)).toMatchObject({ canCurate: true });
    });
  });
});
