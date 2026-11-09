import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { appliesToTrack, applicableRequirements, documentationStatusFor, listSystemDocuments, systemDocumentBodySchema } from "../system-documentation";

/**
 * Document Requirement applicability, the body schema and `documentationStatusFor` (#324). The catalogue is shared by
 * every test file, so the database tests look only at their own `Test ...` fixtures; the "nothing applies" case is a
 * stub client. CI's DB is migrated, not seeded.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test SD ${label} ${suffix}`;

describe("applicability by Track", () => {
  const both = { tracks: ["SELF", "FULL"] as const };
  const fullOnly = { tracks: ["FULL"] as const };
  const selfOnly = { tracks: ["SELF"] as const };

  it("applies every requirement before a System has a Track (null or omitted)", () => {
    for (const requirement of [both, fullOnly, selfOnly]) {
      expect(appliesToTrack(requirement)).toBe(true);
      expect(appliesToTrack(requirement, null)).toBe(true);
    }
    expect(applicableRequirements([both, fullOnly, selfOnly], null)).toHaveLength(3);
  });

  it("applies only the requirements whose Tracks contain the System's Track once it has one", () => {
    expect(applicableRequirements([both, fullOnly, selfOnly], "SELF")).toEqual([both, selfOnly]);
    expect(applicableRequirements([both, fullOnly, selfOnly], "FULL")).toEqual([both, fullOnly]);
  });
});

describe("systemDocumentBodySchema", () => {
  it("trims the link, turns an empty one into none and accepts http and https", () => {
    expect(systemDocumentBodySchema.parse({ link: "  https://example.com/a  ", provided: true })).toEqual({ link: "https://example.com/a", provided: true });
    expect(systemDocumentBodySchema.parse({ link: "http://example.com", provided: false }).link).toBe("http://example.com");
    expect(systemDocumentBodySchema.parse({ link: "   ", provided: false })).toEqual({ link: null, provided: false });
    expect(systemDocumentBodySchema.parse({ link: null, provided: false })).toEqual({ link: null, provided: false });
  });

  it("refuses other schemes, non-URLs, over-long links, and a missing field", () => {
    for (const link of ["javascript:alert(1)", "ftp://example.com/x", "not a url", "example.com", `https://example.com/${"a".repeat(2000)}`]) {
      expect(systemDocumentBodySchema.safeParse({ link, provided: false }).success, link).toBe(false);
    }
    expect(systemDocumentBodySchema.safeParse({ link: null }).success).toBe(false);
    expect(systemDocumentBodySchema.safeParse({ provided: false }).success).toBe(false);
  });
});

describe("documentationStatusFor", { timeout: 30_000 }, () => {
  let ownerId: string;
  let systemId: string;
  let otherSystemId: string;
  const ids = {} as Record<"first" | "secondSelf" | "second" | "secondFull", string>;

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-sd-owner-${suffix}@example.com`, name: "Test SD Owner", role: "SYSTEM_OWNER" } })).id;
    systemId = (await prisma.system.create({ data: { name: NAME("system"), ownerId, status: "DRAFT" } })).id;
    otherSystemId = (await prisma.system.create({ data: { name: NAME("other"), ownerId, status: "DRAFT" } })).id;
    const make = async (label: keyof typeof ids, stage: "FIRST_DOCUMENTATION" | "SECOND_ROUND", tracks: ("SELF" | "FULL")[]) => {
      ids[label] = (await prisma.documentRequirement.create({ data: { name: NAME(label), stage, tracks } })).id;
    };
    await make("first", "FIRST_DOCUMENTATION", ["FULL"]);
    await make("second", "SECOND_ROUND", ["SELF", "FULL"]);
    await make("secondFull", "SECOND_ROUND", ["FULL"]);
    await make("secondSelf", "SECOND_ROUND", ["SELF"]);
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [systemId, otherSystemId] } } });
    await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  const record = (documentRequirementId: string, data: { link?: string | null; provided: boolean }) =>
    prisma.systemDocument.upsert({
      where: { systemId_documentRequirementId: { systemId, documentRequirementId } },
      create: { systemId, documentRequirementId, link: data.link ?? null, provided: data.provided, updatedById: ownerId },
      update: { link: data.link ?? null, provided: data.provided },
    });
  const mine = (items: { name: string }[]) =>
    items
      .filter((item) => item.name.includes(suffix))
      .map((item) => item.name)
      .sort();

  it("is all provided when nothing applies", async () => {
    const empty = { documentRequirement: { findMany: async () => [] }, systemDocument: { findMany: async () => [] } };
    expect(await documentationStatusFor(empty as never, "any", "FIRST_DOCUMENTATION")).toEqual({ allProvided: true, missing: [] });
  });

  it("lists a requirement that has no row as missing, with its id and name", async () => {
    const status = await documentationStatusFor(prisma, systemId, "FIRST_DOCUMENTATION");
    expect(status.allProvided).toBe(false);
    expect(status.missing).toContainEqual({ id: ids.first, name: NAME("first") });
  });

  it("counts a row with a link but not marked provided as missing", async () => {
    await record(ids.first, { link: "https://example.com/arch", provided: false });
    const status = await documentationStatusFor(prisma, systemId, "FIRST_DOCUMENTATION");
    expect(status.allProvided).toBe(false);
    expect(mine(status.missing)).toEqual([NAME("first")]);
  });

  it("is satisfied once every requirement of the stage is provided, and only for that System and stage", async () => {
    await record(ids.first, { link: "https://example.com/arch", provided: true });
    expect(mine((await documentationStatusFor(prisma, systemId, "FIRST_DOCUMENTATION")).missing)).toEqual([]);
    // The second round is untouched, and another System has provided nothing.
    expect(mine((await documentationStatusFor(prisma, systemId, "SECOND_ROUND")).missing)).toEqual([NAME("second"), NAME("secondFull"), NAME("secondSelf")]);
    expect(mine((await documentationStatusFor(prisma, otherSystemId, "FIRST_DOCUMENTATION")).missing)).toEqual([NAME("first")]);

    for (const key of ["second", "secondFull", "secondSelf"] as const) await record(ids[key], { link: "https://example.com/x", provided: true });
    expect(mine((await documentationStatusFor(prisma, systemId, "SECOND_ROUND")).missing)).toEqual([]);
  });

  it("filters by Track: a Self System is not asked for a Full-only requirement, nor a Full one for a Self-only one", async () => {
    await prisma.systemDocument.deleteMany({ where: { systemId } });
    expect(mine((await documentationStatusFor(prisma, systemId, "SECOND_ROUND", "SELF")).missing)).toEqual([NAME("second"), NAME("secondSelf")]);
    expect(mine((await documentationStatusFor(prisma, systemId, "SECOND_ROUND", "FULL")).missing)).toEqual([NAME("second"), NAME("secondFull")]);
    expect(mine((await documentationStatusFor(prisma, systemId, "SECOND_ROUND", null)).missing)).toHaveLength(3);
    expect(mine((await documentationStatusFor(prisma, systemId, "FIRST_DOCUMENTATION", "SELF")).missing)).toEqual([]);
  });

  it("uses the client it is given, so it can run inside a transaction", async () => {
    const seen = await prisma.$transaction(async (tx) => {
      await tx.systemDocument.create({ data: { systemId, documentRequirementId: ids.first, link: "https://example.com/in-tx", provided: true } });
      return mine((await documentationStatusFor(tx, systemId, "FIRST_DOCUMENTATION")).missing);
    });
    expect(seen).toEqual([]);
  });

  it("lists the applicable requirements with link, provided and who/when, filtered by Track when given one", async () => {
    const rows = (await listSystemDocuments(prisma, systemId)).filter((row) => row.name.includes(suffix));
    // First documentation before second round, then by name.
    expect(rows.map((row) => row.id)).toEqual([ids.first, ids.second, ids.secondFull, ids.secondSelf]);
    expect(rows[0]).toMatchObject({ link: "https://example.com/in-tx", provided: true, updatedBy: null });
    expect(rows[1]).toMatchObject({ link: null, provided: false, updatedAt: null, updatedBy: null });

    const names = async (track: "SELF" | "FULL") =>
      (await listSystemDocuments(prisma, systemId, track))
        .filter((row) => row.name.includes(suffix))
        .map((row) => row.name)
        .sort();
    expect(await names("SELF")).toEqual([NAME("second"), NAME("secondSelf")]);
    expect(await names("FULL")).toEqual([NAME("first"), NAME("second"), NAME("secondFull")]);
  });

  it("drops a deleted catalogue entry from the listing and the status, and removes its rows", async () => {
    await prisma.documentRequirement.delete({ where: { id: ids.first } });
    expect((await listSystemDocuments(prisma, systemId)).some((row) => row.id === ids.first)).toBe(false);
    expect(await prisma.systemDocument.count({ where: { documentRequirementId: ids.first } })).toBe(0);
    expect((await documentationStatusFor(prisma, systemId, "FIRST_DOCUMENTATION")).missing.some((item) => item.id === ids.first)).toBe(false);
  });
});
