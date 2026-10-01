import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient, type Control } from "@prisma/client";
import { createOrganizationImplementationFor } from "../src/lib/organization-implementation";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The seed JSON holds the base Control Library (ISO/IEC 27001:2022 Annex A).
// Each Control also becomes an ISO Requirement, FULL-mapped 1:1 — the same
// shape the #72 data migration produced from the old Control.frameworks tag.
type SeedControlJson = Omit<Control, "id" | "createdAt" | "originFrameworkId">;

// The base Framework: exactly one, always Published (ADR 0005, #72).
const BASE_FRAMEWORK = { name: "ISO/IEC 27001", version: "2022" };

// ISO/IEC 27001:2022 clauses 4-10 (#75): Requirements plus the ORGANIZATIONAL
// Supplementary Controls that cover them. Shaped like the PRD 0001 F-IMP.1
// import sketch. Keep in sync with the SQL data migration
// 20260929170000_add_iso27001_clause_requirements (a test compares the two).
type ClausesJson = {
  framework: { name: string; version: string };
  supplementaryControls: SeedControlJson[];
  requirements: {
    code: string;
    section: string;
    title: string;
    text: string;
    mappings: { control: string; coverage: "FULL" | "PARTIAL"; rationale?: string }[];
  }[];
};

// Placeholder controls from before the ISO 27001 Annex A catalog was seeded.
const OBSOLETE_PLACEHOLDER_CODES = ["SEC-001", "SEC-002", "PRIV-001", "OPS-001"];

async function main() {
  const users = [
    { email: "admin@example.com", name: "Default Admin", role: "ADMIN" as const },
    { email: "owner@example.com", name: "Default System Owner", role: "SYSTEM_OWNER" as const },
    { email: "risk-owner@example.com", name: "Default Risk Owner", role: "RISK_OWNER" as const },
    { email: "reviewer@example.com", name: "Default Reviewer", role: "REVIEWER" as const },
    { email: "viewer@example.com", name: "Default Viewer", role: "VIEWER" as const },
    {
      email: "business-risk-owner@example.com",
      name: "Default Business Risk Owner",
      role: "BUSINESS_RISK_OWNER" as const,
    },
    {
      email: "compliance-manager@example.com",
      name: "Default Compliance Manager",
      role: "COMPLIANCE_MANAGER" as const,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });

  await prisma.control.deleteMany({ where: { code: { in: OBSOLETE_PLACEHOLDER_CODES } } });

  const controlsPath = path.join(__dirname, "seed-data", "iso27001-annex-a.json");
  const controls: SeedControlJson[] = JSON.parse(readFileSync(controlsPath, "utf-8"));

  const baseFramework = await prisma.framework.upsert({
    where: { name_version: BASE_FRAMEWORK },
    update: {},
    create: { ...BASE_FRAMEWORK, isBase: true, status: "PUBLISHED", licensing: "PARAPHRASE_ONLY" },
  });

  for (const controlJson of controls) {
    const control = await prisma.control.upsert({
      where: { code: controlJson.code },
      update: controlJson,
      create: controlJson,
    });
    // Every Organizational/Both Control has an Organization Control Implementation,
    // Not Started; re-seeding never resets one (#120).
    await createOrganizationImplementationFor(prisma, control);

    // Requirement code = the Annex A code, section = the Control's category,
    // title/text = its title/description paraphrase. Left untouched on
    // re-seed so curated Requirements and Coverage aren't clobbered.
    const requirement = await prisma.requirement.upsert({
      where: { frameworkId_code: { frameworkId: baseFramework.id, code: control.code } },
      update: {},
      create: {
        frameworkId: baseFramework.id,
        code: control.code,
        section: control.category,
        title: control.title,
        text: control.description,
      },
    });
    await prisma.controlMapping.upsert({
      where: { requirementId_controlId: { requirementId: requirement.id, controlId: control.id } },
      update: {},
      create: { requirementId: requirement.id, controlId: control.id, coverage: "FULL" },
    });
  }

  // Clauses 4-10. Controls, Requirements and mappings are all upserted by
  // their natural keys without overwriting, so re-seeding never clobbers
  // curation (or anything the data migration already inserted) and duplicates
  // nothing.
  const clausesPath = path.join(__dirname, "seed-data", "iso27001-clauses.json");
  const clauses: ClausesJson = JSON.parse(readFileSync(clausesPath, "utf-8"));
  if (clauses.framework.name !== baseFramework.name || clauses.framework.version !== baseFramework.version) {
    throw new Error("iso27001-clauses.json does not describe the base Framework");
  }

  const clauseControlIdByCode = new Map<string, string>();
  for (const controlJson of clauses.supplementaryControls) {
    const control = await prisma.control.upsert({
      where: { code: controlJson.code },
      update: {},
      create: { ...controlJson, originFrameworkId: baseFramework.id },
    });
    await createOrganizationImplementationFor(prisma, control);
    clauseControlIdByCode.set(control.code, control.id);
  }

  for (const requirementJson of clauses.requirements) {
    const requirement = await prisma.requirement.upsert({
      where: { frameworkId_code: { frameworkId: baseFramework.id, code: requirementJson.code } },
      update: {},
      create: {
        frameworkId: baseFramework.id,
        code: requirementJson.code,
        section: requirementJson.section,
        title: requirementJson.title,
        text: requirementJson.text,
      },
    });
    for (const mapping of requirementJson.mappings) {
      // A clause maps either to a Supplementary Control from this file or to
      // an Annex A Control seeded above.
      const controlId =
        clauseControlIdByCode.get(mapping.control) ??
        (await prisma.control.findUniqueOrThrow({ where: { code: mapping.control }, select: { id: true } })).id;
      await prisma.controlMapping.upsert({
        where: { requirementId_controlId: { requirementId: requirement.id, controlId } },
        update: {},
        create: {
          requirementId: requirement.id,
          controlId,
          coverage: mapping.coverage,
          rationale: mapping.rationale ?? null,
        },
      });
    }
  }

  console.log(
    `Seed complete. Default owner: ${owner.email}. Control Library: ${controls.length} controls, ${controls.length} ${BASE_FRAMEWORK.name}:${BASE_FRAMEWORK.version} Requirements mapped Full, plus ${clauses.requirements.length} clause Requirements (4-10) with ${clauses.supplementaryControls.length} Supplementary Controls.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
