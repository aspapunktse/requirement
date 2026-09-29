import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient, type Control } from "@prisma/client";

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The seed JSON authors one framework label per row as a plain string, for
// authoring convenience — resolved to a Framework catalog row (created if
// it doesn't exist yet) and connected below. See #55.
type SeedControlJson = Omit<Control, "id" | "createdAt"> & { framework: string | null };

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

  const frameworkNames = [...new Set(controls.map((r) => r.framework).filter((f) => f != null))];
  for (const name of frameworkNames) {
    await prisma.framework.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const { framework, ...control } of controls) {
    const data = {
      ...control,
      frameworks: framework ? { connect: { name: framework } } : undefined,
    };
    await prisma.control.upsert({
      where: { code: control.code },
      update: data,
      create: data,
    });
  }

  console.log(
    `Seed complete. Default owner: ${owner.email}. Control Library: ${controls.length} controls.`,
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
