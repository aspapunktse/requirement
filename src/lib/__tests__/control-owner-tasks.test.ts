import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleView } from "@/app/home/role-view";
import { CONTROL_OWNER_TASKS_HREF, getControlOwnerTasks } from "../control-owner-tasks";

/**
 * "My tasks" for a Control Owner (#120): one row per Control they own whose Organization Control
 * Implementation is Not Started or In Progress (a missing row counts as Not Started), for any role.
 * Fixtures only; a fresh User per case owns exactly the Controls the case creates.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];

describe("Control Owner tasks (#120)", () => {
  const userIds: string[] = [];
  const controlIds: string[] = [];
  let facetId: string;
  let counter = 0;

  async function makeUser(role: UserRole) {
    const user = await prisma.user.create({
      data: { email: `test-cot-${role}-${++counter}-${SUFFIX}@example.com`, name: `Test COT ${role} ${counter}`, role },
    });
    userIds.push(user.id);
    return user;
  }

  /** A Control owned by `ownerId`; `status` undefined means no implementation row at all. */
  async function makeControl(
    ownerId: string | null,
    status: ControlAssessmentStatus | undefined,
    applicability: "ORGANIZATIONAL" | "BOTH" | "PER_SYSTEM" = "ORGANIZATIONAL",
  ) {
    const n = ++counter;
    const control = await prisma.control.create({
      data: {
        code: `TEST-COT-${SUFFIX}-${String(n).padStart(3, "0")}`,
        title: `Test COT control ${n}`,
        description: "d",
        category: "Test",
        applicability,
        ownerId,
        // BOTH / PER_SYSTEM fixtures are scoped to a Facet no System has, so they cannot leak into other files' Systems.
        ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?", deploymentFacets: { connect: { id: facetId } } }),
        ...(status !== undefined && { organizationImplementation: { create: { status } } }),
      },
    });
    controlIds.push(control.id);
    return control;
  }

  beforeAll(async () => {
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test COT Facet ${SUFFIX}` } })).id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  describe("getControlOwnerTasks", () => {
    it("gives one row for each Not Started and In Progress Control the user owns, and none for the rest", async () => {
      const owner = await makeUser("VIEWER");
      const notStarted = await makeControl(owner.id, "NOT_STARTED");
      const inProgress = await makeControl(owner.id, "IN_PROGRESS");
      await makeControl(owner.id, "FULFILLED");
      await makeControl(owner.id, "WAIVED");
      await makeControl(owner.id, "NOT_APPLICABLE");

      const rows = await getControlOwnerTasks(owner);
      expect(rows.map((r) => r.id)).toEqual([`${notStarted.id}:implementation`, `${inProgress.id}:implementation`]);
      expect(rows.map((r) => r.status)).toEqual(["Not Started", "In Progress"]);
      expect(rows[0]).toMatchObject({
        kind: "Control",
        title: `${notStarted.code} — ${notStarted.title}`,
        href: CONTROL_OWNER_TASKS_HREF,
      });
      expect(CONTROL_OWNER_TASKS_HREF).toBe("/organization/controls?mine=1");
    });

    it("counts a Control with no implementation row as Not Started", async () => {
      const owner = await makeUser("VIEWER");
      const control = await makeControl(owner.id, undefined);
      expect(await prisma.organizationControlImplementation.count({ where: { controlId: control.id } })).toBe(0);

      const rows = await getControlOwnerTasks(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: `${control.id}:implementation`, status: "Not Started" });
      // Reading creates no row.
      expect(await prisma.organizationControlImplementation.count({ where: { controlId: control.id } })).toBe(0);
    });

    it("includes a Both Control, and never a Per-System one", async () => {
      const owner = await makeUser("VIEWER");
      const both = await makeControl(owner.id, undefined, "BOTH");
      await makeControl(owner.id, undefined, "PER_SYSTEM");

      expect((await getControlOwnerTasks(owner)).map((r) => r.id)).toEqual([`${both.id}:implementation`]);
    });

    it("gives a user nothing for Controls they do not own, unowned Controls, or when they own none", async () => {
      const owner = await makeUser("VIEWER");
      const other = await makeUser("ADMIN");
      await makeControl(owner.id, "NOT_STARTED");
      await makeControl(null, "NOT_STARTED");

      expect(await getControlOwnerTasks(other)).toEqual([]);
    });

    it("drops a row once the implementation is Fulfilled, and brings it back when it moves back to In Progress", async () => {
      const owner = await makeUser("VIEWER");
      const control = await makeControl(owner.id, "NOT_STARTED");
      expect(await getControlOwnerTasks(owner)).toHaveLength(1);

      await prisma.organizationControlImplementation.update({ where: { controlId: control.id }, data: { status: "FULFILLED" } });
      expect(await getControlOwnerTasks(owner)).toHaveLength(0);

      await prisma.organizationControlImplementation.update({ where: { controlId: control.id }, data: { status: "IN_PROGRESS" } });
      expect(await getControlOwnerTasks(owner)).toHaveLength(1);
    });

    it("stops listing a Control once its owner is cleared", async () => {
      const owner = await makeUser("VIEWER");
      const control = await makeControl(owner.id, "NOT_STARTED");
      await prisma.control.update({ where: { id: control.id }, data: { ownerId: null } });
      expect(await getControlOwnerTasks(owner)).toEqual([]);
    });
  });

  describe("on /home (roleView)", () => {
    const controlRows = (view: { tasks?: { kind: string; id: string }[] }) => (view.tasks ?? []).filter((t) => t.kind === "Control");

    it.each(ROLES)("shows a %s who owns Controls the open ones in My tasks, and not the Fulfilled one", async (role) => {
      const owner = await makeUser(role);
      const open = await makeControl(owner.id, "NOT_STARTED");
      await makeControl(owner.id, "FULFILLED");

      const view = await roleView(owner);
      expect(controlRows(view).map((t) => t.id)).toEqual([`${open.id}:implementation`]);
    });

    it("shows a Compliance Manager the Control rows although they get no System owner tasks", async () => {
      const manager = await makeUser("COMPLIANCE_MANAGER");
      const control = await makeControl(manager.id, undefined);

      const view = await roleView(manager);
      expect(controlRows(view).map((t) => t.id)).toEqual([`${control.id}:implementation`]);
      expect(view.stats.map((s) => s.label)).not.toContain("Your Systems needing attention");
    });

    it("creates My tasks for a Viewer who owns a Control, with nothing else in it", async () => {
      const viewer = await makeUser("VIEWER");
      await makeControl(viewer.id, "IN_PROGRESS");

      const view = await roleView(viewer);
      expect(view.tasks).toHaveLength(1);
      expect(view.tasks?.[0]).toMatchObject({ kind: "Control", status: "In Progress" });
      expect(view.stats.map((s) => s.label)).toEqual(["Onboarded systems"]);
    });

    it("leaves /home exactly as before for a user who owns no Control, whatever the role", async () => {
      const bystander = await makeUser("VIEWER");
      const otherOwner = await makeUser("VIEWER");
      await makeControl(otherOwner.id, "NOT_STARTED");

      const view = await roleView(bystander);
      expect(view.tasks).toBeUndefined(); // a Viewer has no My tasks section
      for (const role of ROLES) {
        const user = await makeUser(role);
        expect(controlRows(await roleView(user)), role).toEqual([]);
      }
    });

    it("does not show Control rows for a user whose owned Controls are all done or Per-System", async () => {
      const owner = await makeUser("VIEWER");
      await makeControl(owner.id, "FULFILLED");
      await makeControl(owner.id, undefined, "PER_SYSTEM");

      expect((await roleView(owner)).tasks).toBeUndefined();
    });

    it("puts the Organization Controls tile on the Compliance Manager's and the Admin's home, and on nobody else's", async () => {
      for (const role of ROLES) {
        const user = await makeUser(role);
        const tile = (await roleView(user)).tiles.find((t) => t.href === "/organization/controls");
        if (role === "ADMIN" || role === "COMPLIANCE_MANAGER") {
          expect(tile?.title, role).toBe("Organization Controls");
        } else {
          expect(tile, role).toBeUndefined();
        }
      }
    });
  });
});
