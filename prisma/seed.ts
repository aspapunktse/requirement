import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient, type Control } from "@prisma/client";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The seed JSON holds the base Control Library (ISO/IEC 27001:2022 Annex A).
// Each Control also becomes an ISO Requirement, FULL-mapped 1:1 — the same
// shape the #72 data migration produced from the old Control.frameworks tag.
type SeedControlJson = Omit<Control, "id" | "createdAt" | "originFrameworkId">;

// The base Framework: exactly one, always Published (ADR 0005, #72).
const BASE_FRAMEWORK = { name: "ISO/IEC 27001", version: "2022" };

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

  console.log(
    `Seed complete. Default owner: ${owner.email}. Control Library: ${controls.length} controls, ${controls.length} ${BASE_FRAMEWORK.name}:${BASE_FRAMEWORK.version} Requirements mapped Full.`,
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
