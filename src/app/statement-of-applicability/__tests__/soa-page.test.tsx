import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ user: null as { id: string; role: UserRole } | null }));
vi.mock("@/lib/acting-user", () => ({ getActingUser: async () => acting.user }));

import StatementOfApplicabilityPage from "../page";
import { StatementLedger } from "../StatementLedger";

/**
 * The page itself (#272): no acting user gets the prompt; every role gets the ledger, and only a Compliance
 * Manager or an Admin gets the editor. Real Postgres, own users (the rows are whatever Controls the database holds).
 */
const suffix = `${process.pid}-${Date.now()}`;
const users: Record<string, { id: string; role: UserRole }> = {};

beforeAll(async () => {
  for (const [key, role] of [["cm", "COMPLIANCE_MANAGER"], ["admin", "ADMIN"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["auditor", "INTERNAL_AUDITOR"]] as const) {
    const row = await prisma.user.create({ data: { email: `test-272-page-${key}-${suffix}@example.com`, name: `Test 272 ${key}`, role } });
    users[key] = { id: row.id, role };
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

beforeEach(() => {
  acting.user = null;
});

type Element = { type: unknown; key: string | null; props: { view: { canEdit: boolean; userId: string; rows: unknown[] } } };

describe("the Statement of Applicability page", { timeout: 30_000 }, () => {
  it("asks for an acting user first", async () => {
    const element = (await StatementOfApplicabilityPage()) as unknown as { props: { children: string } };
    expect(element.props.children).toBe("Pick a user to act as first.");
  });

  it("gives every role the ledger, keyed on the acting user, with the editor for Compliance Managers and Admins only", async () => {
    for (const [key, canEdit] of [["cm", true], ["admin", true], ["viewer", false], ["owner", false], ["auditor", false]] as const) {
      acting.user = users[key];
      const element = (await StatementOfApplicabilityPage()) as unknown as Element;
      expect(element.type, key).toBe(StatementLedger);
      expect(element.key).toBe(users[key].id);
      expect(element.props.view.userId).toBe(users[key].id);
      expect(element.props.view.canEdit, key).toBe(canEdit);
    }
  });
});
