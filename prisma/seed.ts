import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient, type Requirement } from "@prisma/client";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The seed JSON authors one framework label per row as a plain string, for
// authoring convenience — converted to the schema's `framework: String[]`
// (see #52) when loaded below.
type SeedRequirementJson = Omit<Requirement, "id" | "createdAt" | "framework"> & { framework: string | null };

// Placeholder requirements from before the ISO 27001 Annex A catalog was seeded.
const OBSOLETE_PLACEHOLDER_CODES = ["SEC-001", "SEC-002", "PRIV-001", "OPS-001"];

async function main() {
  const users = [
    { email: "admin@example.com", name: "Default Admin", role: "ADMIN" as const },
    { email: "owner@example.com", name: "Default System Owner", role: "SYSTEM_OWNER" as const },
    { email: "risk-owner@example.com", name: "Default Risk Owner", role: "RISK_OWNER" as const },
    { email: "reviewer@example.com", name: "Default Reviewer", role: "REVIEWER" as const },
    { email: "viewer@example.com", name: "Default Viewer", role: "VIEWER" as const },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    });
  }

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });

  await prisma.requirement.deleteMany({ where: { code: { in: OBSOLETE_PLACEHOLDER_CODES } } });

  const requirementsPath = path.join(__dirname, "seed-data", "iso27001-annex-a.json");
  const requirements: SeedRequirementJson[] = JSON.parse(readFileSync(requirementsPath, "utf-8"));

  for (const { framework, ...req } of requirements) {
    const data = { ...req, framework: framework ? [framework] : [] };
    await prisma.requirement.upsert({
      where: { code: req.code },
      update: data,
      create: data,
    });
  }

  console.log(
    `Seed complete. Default owner: ${owner.email}. Requirement catalog: ${requirements.length} controls.`,
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
