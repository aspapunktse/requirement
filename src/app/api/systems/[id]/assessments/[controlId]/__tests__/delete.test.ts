import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { REMOVED_ASSESSMENT_TEXT_LIMIT } from "@/lib/control-assessments";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { PATCH as patchSystem } from "../../../route";
import { DELETE } from "../route";

/**
 * Removing a stale Control Assessment (#109). A row is stale when its Control
 * no longer applies to the System but someone worked on it, so a recompute
 * kept it. Fixtures are self-contained (CI's DB is migrated, not seeded): the
 * stale Control is scoped to a fixture Deployment Facet and mapped to the base
 * Framework, then made stale by taking that Facet off the System through the
 * classification route, which is how it happens for real. Every System is
 * Onboarded so every role can see it and the 403s are real 403s.
 */

const SUFFIX = Date.now();

function req(url: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const urlFor = (systemId: string, controlId: string) => `/api/systems/${systemId}/assessments/${controlId}`;
const ctxFor = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) });

function remove(systemId: string, controlId: string, userId: string) {
  return DELETE(req(urlFor(systemId, controlId), "DELETE", userId), ctxFor(systemId, controlId));
}

describe("DELETE /api/systems/[id]/assessments/[controlId] (#109)", { timeout: 30_000 }, () => {
  const users = {} as Record<
    "owner" | "otherOwner" | "reviewer" | "riskOwner" | "complianceManager" | "viewer" | "admin",
    string
  >;
  const systemIds: string[] = [];
  let facetStale: string;
  let facetLive: string;
  // Scoped to facetStale: stale once the System drops that Facet.
  let staleControlId: string;
  let staleControlCode: string;
  // Scoped to facetLive: applies to every fixture System throughout.
  let liveControlId: string;

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "SYSTEM_OWNER"],
      ["otherOwner", "SYSTEM_OWNER"],
      ["reviewer", "REVIEWER"],
      ["riskOwner", "RISK_OWNER"],
      ["complianceManager", "COMPLIANCE_MANAGER"],
      ["viewer", "VIEWER"],
      ["admin", "ADMIN"],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: { email: `test-remove-stale-${key}-${SUFFIX}@example.com`, name: `Test Remove Stale ${key}`, role },
        })
      ).id;
    }
    facetStale = (await prisma.deploymentFacet.create({ data: { name: `Test Remove Stale Facet A ${SUFFIX}` } })).id;
    facetLive = (await prisma.deploymentFacet.create({ data: { name: `Test Remove Stale Facet B ${SUFFIX}` } })).id;

    staleControlCode = `TEST-RS-STALE-${SUFFIX}`;
    staleControlId = (
      await prisma.control.create({
        data: {
          code: staleControlCode,
          title: "Test Remove Stale Control",
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          mandatory: false,
          deploymentFacets: { connect: [{ id: facetStale }] },
        },
      })
    ).id;
    liveControlId = (
      await prisma.control.create({
        data: {
          code: `TEST-RS-LIVE-${SUFFIX}`,
          title: "Test Remove Stale Live Control",
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          mandatory: false,
          deploymentFacets: { connect: [{ id: facetLive }] },
        },
      })
    ).id;
    await mapControlsToBase([staleControlId, liveControlId]);
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Assessments and Queries cascade
    await prisma.control.deleteMany({ where: { id: { in: [staleControlId, liveControlId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetStale, facetLive] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  /**
   * An Onboarded System that declared both Facets and had both Controls worked
   * on (a touched Assessment each), then drops the stale Control's Facet through
   * the classification route, so that Assessment is kept as stale.
   */
  async function makeStaleSystem(
    ownerId = users.owner,
    assessment: { status?: "FULFILLED" | "IN_PROGRESS"; evidence?: string | null; notes?: string | null } = {},
  ) {
    const system = await prisma.system.create({
      data: {
        name: `Test Remove Stale System ${SUFFIX}-${systemIds.length}`,
        ownerId,
        status: "ONBOARDED",
        onboardedAt: new Date("2026-01-15T10:00:00Z"),
        deploymentFacets: { connect: [{ id: facetStale }, { id: facetLive }] },
      },
    });
    systemIds.push(system.id);
    for (const controlId of [staleControlId, liveControlId]) {
      await prisma.controlAssessment.create({
        data: {
          systemId: system.id,
          controlId,
          status: assessment.status ?? "FULFILLED",
          evidence: assessment.evidence === undefined ? "https://example.com/evidence" : assessment.evidence,
          notes: assessment.notes === undefined ? "Checked in the 2025 audit" : assessment.notes,
          assessedById: users.owner,
          assessedAt: new Date(),
        },
      });
    }
    const dropped = await patchSystem(
      req(`/api/systems/${system.id}`, "PATCH", users.admin, { deploymentFacetIds: [facetLive] }),
      { params: Promise.resolve({ id: system.id }) },
    );
    expect(dropped.status).toBe(200);
    // The recompute kept the touched Assessment.
    expect(await assessmentOf(system.id, staleControlId)).not.toBeNull();
    return system.id;
  }

  const assessmentOf = (systemId: string, controlId: string) =>
    prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId, controlId } } });

  const removalEvents = (systemId: string) =>
    prisma.changeEvent.findMany({ where: { systemId, action: "ASSESSMENT_REMOVED" } });

  /** Everything a refused removal could have touched. */
  async function snapshot(systemId: string) {
    return {
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } })).map(
        (a) => `${a.controlId}:${a.status}:${a.evidence}:${a.notes}`,
      ),
      queries: await prisma.assessmentQuery.count({ where: { controlAssessment: { systemId } } }),
      changeEvents: await prisma.changeEvent.count({ where: { systemId } }),
    };
  }

  async function raiseQuery(systemId: string, resolved: boolean, body = "Is this still true?") {
    const assessment = await assessmentOf(systemId, staleControlId);
    return prisma.assessmentQuery.create({
      data: {
        controlAssessmentId: assessment!.id,
        lastMessageAuthorId: users.reviewer,
        resolved,
        resolvedById: resolved ? users.reviewer : null,
        resolvedAt: resolved ? new Date() : null,
        messages: { create: { authorId: users.reviewer, body } },
      },
    });
  }

  it("lets the System's owner remove a stale Assessment, recording its last status, evidence and notes in a Change Event", async () => {
    const systemId = await makeStaleSystem();

    const response = await remove(systemId, staleControlId, users.owner);

    expect(response.status).toBe(200);
    expect(await assessmentOf(systemId, staleControlId)).toBeNull();
    // Only the stale row goes: the live Assessment is untouched.
    expect(await assessmentOf(systemId, liveControlId)).not.toBeNull();

    const events = await removalEvents(systemId);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(users.owner);
    expect(events[0].detail).toBe(
      `Stale Assessment for ${staleControlCode} removed (was Fulfilled; evidence: "https://example.com/evidence"; notes: "Checked in the 2025 audit")`,
    );
  });

  it("lets an Admin who doesn't own the System remove it, with the Admin as the actor", async () => {
    const systemId = await makeStaleSystem();

    const response = await remove(systemId, staleControlId, users.admin);

    expect(response.status).toBe(200);
    expect(await assessmentOf(systemId, staleControlId)).toBeNull();
    const events = await removalEvents(systemId);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(users.admin);
  });

  it("lets a Risk Owner remove a stale Assessment on a System they own", async () => {
    const systemId = await makeStaleSystem(users.riskOwner);

    expect((await remove(systemId, staleControlId, users.riskOwner)).status).toBe(200);
    expect(await assessmentOf(systemId, staleControlId)).toBeNull();
  });

  it("omits an empty evidence and notes from the detail, and truncates long ones with an ellipsis", async () => {
    const bare = await makeStaleSystem(users.owner, { status: "IN_PROGRESS", evidence: null, notes: "   " });
    await remove(bare, staleControlId, users.owner);
    expect((await removalEvents(bare))[0].detail).toBe(
      `Stale Assessment for ${staleControlCode} removed (was In Progress)`,
    );

    const long = "x".repeat(REMOVED_ASSESSMENT_TEXT_LIMIT + 300);
    const verbose = await makeStaleSystem(users.owner, { evidence: long, notes: long });
    await remove(verbose, staleControlId, users.owner);
    const kept = `${"x".repeat(REMOVED_ASSESSMENT_TEXT_LIMIT)}…`;
    expect((await removalEvents(verbose))[0].detail).toBe(
      `Stale Assessment for ${staleControlCode} removed (was Fulfilled; evidence: "${kept}"; notes: "${kept}")`,
    );
  });

  it.each([
    ["a SYSTEM_OWNER who doesn't own the System", "otherOwner"],
    ["a Reviewer", "reviewer"],
    ["a Risk Owner who doesn't own the System", "riskOwner"],
    ["a Viewer", "viewer"],
    ["a Compliance Manager", "complianceManager"],
  ] as const)("refuses %s with 403 and changes nothing", async (_label, who) => {
    const systemId = await makeStaleSystem();
    const before = await snapshot(systemId);

    const response = await remove(systemId, staleControlId, users[who]);

    expect(response.status).toBe(403);
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("refuses a Compliance Manager even when they are the System's recorded owner", async () => {
    const systemId = await makeStaleSystem(users.complianceManager);
    const before = await snapshot(systemId);

    expect((await remove(systemId, staleControlId, users.complianceManager)).status).toBe(403);
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("returns 409 for an Assessment whose Control still applies, and never deletes a live Assessment", async () => {
    const systemId = await makeStaleSystem();
    const before = await snapshot(systemId);

    for (const who of [users.owner, users.admin]) {
      const response = await remove(systemId, liveControlId, who);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/still applies/);
    }
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("returns 404 when there is no Assessment for that Control, or no such System", async () => {
    const systemId = await makeStaleSystem();
    await remove(systemId, staleControlId, users.owner);
    const before = await snapshot(systemId);

    expect((await remove(systemId, staleControlId, users.owner)).status).toBe(404);
    expect((await remove(systemId, "no-such-control", users.owner)).status).toBe(404);
    expect((await remove("no-such-system", staleControlId, users.owner)).status).toBe(404);
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("returns 409 while an Assessment Query on it is open, and removes it once the Query is resolved", async () => {
    const systemId = await makeStaleSystem();
    const query = await raiseQuery(systemId, false);
    const before = await snapshot(systemId);

    const blocked = await remove(systemId, staleControlId, users.owner);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/open question/);
    expect(await snapshot(systemId)).toEqual(before);

    await prisma.assessmentQuery.update({
      where: { id: query.id },
      data: { resolved: true, resolvedById: users.reviewer, resolvedAt: new Date() },
    });

    expect((await remove(systemId, staleControlId, users.owner)).status).toBe(200);
    expect(await assessmentOf(systemId, staleControlId)).toBeNull();
    // The resolved Query (and its messages) went with the row; only the count is kept in the event.
    expect(await prisma.assessmentQuery.count({ where: { id: query.id } })).toBe(0);
    expect(await prisma.queryMessage.count({ where: { assessmentQueryId: query.id } })).toBe(0);
    expect((await removalEvents(systemId))[0].detail).toBe(
      `Stale Assessment for ${staleControlCode} removed (was Fulfilled; evidence: "https://example.com/evidence"; notes: "Checked in the 2025 audit"; 1 resolved Query removed with it)`,
    );
  });

  it("blocks on any open Query even when other Queries on it are resolved", async () => {
    const systemId = await makeStaleSystem();
    await raiseQuery(systemId, true, "Old resolved question");
    await raiseQuery(systemId, false, "New open question");
    const before = await snapshot(systemId);

    expect((await remove(systemId, staleControlId, users.admin)).status).toBe(409);
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("keeps a Risk opened from the Assessment, detached from it", async () => {
    const systemId = await makeStaleSystem();
    const assessment = await assessmentOf(systemId, staleControlId);
    const risk = await prisma.risk.create({
      data: {
        systemId,
        title: `Test Remove Stale Risk ${SUFFIX}`,
        description: "d",
        severity: "MEDIUM",
        likelihood: "MEDIUM",
        ownerId: users.owner,
        controlAssessmentId: assessment!.id,
      },
    });

    expect((await remove(systemId, staleControlId, users.owner)).status).toBe(200);

    const kept = await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(kept.controlAssessmentId).toBeNull();
  });

  it("clears the owner's 'Stale assessment' task from My tasks when the last stale row is removed on an Onboarded System", async () => {
    const systemId = await makeStaleSystem();
    const staleTasks = async () =>
      (await getSystemsNeedingAttention(users.owner)).filter((e) => e.id === systemId && e.reason === "stale");

    expect(await staleTasks()).toHaveLength(1);

    expect((await remove(systemId, staleControlId, users.owner)).status).toBe(200);

    expect(await staleTasks()).toHaveLength(0);
    // The System itself is untouched.
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    expect(system.status).toBe("ONBOARDED");
    expect(system.onboardedAt).not.toBeNull();
  });
});
