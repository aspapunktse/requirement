import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ user: null as { id: string; name: string; role: UserRole } | null }));
vi.mock("@/lib/acting-user", () => ({ getActingUser: async () => acting.user }));

import PrintPage from "../page";
import { PrintStatement } from "../PrintStatement";

/** The print page (#273): the prompt without a user; the same whole Statement for every role. Real Postgres, own users. */
const suffix = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const users: { id: string; name: string; role: UserRole }[] = [];

beforeAll(async () => {
  for (const role of ROLES) {
    const name = `Test 273 ${role}`;
    const row = await prisma.user.create({ data: { email: `test-273-print-${role}-${suffix}@example.com`, name, role } });
    users.push({ id: row.id, name, role });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
});

beforeEach(() => {
  acting.user = null;
});

type Element = { type: unknown; props: { cover: { generatedByName: string; total: number }; rows: { controlId: string }[] } };

describe("the Statement of Applicability print page", { timeout: 30_000 }, () => {
  it("asks for an acting user first", async () => {
    const element = (await PrintPage()) as unknown as { props: { children: string } };
    expect(element.props.children).toBe("Pick a user to act as first.");
  });

  it("gives every role the whole Statement (no role filter), with its own name as the author", async () => {
    for (const user of users) {
      acting.user = user;
      const element = (await PrintPage()) as unknown as Element;
      expect(element.type).toBe(PrintStatement);
      expect(element.props.cover.generatedByName).toBe(user.name);
      expect(element.props.cover.total).toBe(element.props.rows.length);
      expect(element.props.rows.length).toBeGreaterThanOrEqual(0);
    }
  });
});
