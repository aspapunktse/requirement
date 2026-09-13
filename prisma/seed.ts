import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: {
      email: "owner@example.com",
      name: "Default System Owner",
      role: "SYSTEM_OWNER",
    },
  });

  const requirements = [
    {
      code: "SEC-001",
      title: "Data encrypted in transit and at rest",
      description: "The vendor must support TLS 1.2+ in transit and encryption at rest for all customer data.",
      category: "Security",
      framework: "ISO27001 A.8.24",
    },
    {
      code: "SEC-002",
      title: "SSO / SAML integration available",
      description: "The system must support enterprise SSO via SAML or OIDC.",
      category: "Security",
      framework: "Internal Policy",
    },
    {
      code: "PRIV-001",
      title: "Data Processing Agreement in place",
      description: "A signed DPA covering data handling and sub-processors must be on file.",
      category: "Privacy",
      framework: "GDPR Art. 28",
    },
    {
      code: "OPS-001",
      title: "Vendor SLA meets uptime requirements",
      description: "Vendor-committed uptime SLA must be 99.9% or higher.",
      category: "Operational",
      framework: "Internal Policy",
    },
  ];

  for (const req of requirements) {
    await prisma.requirement.upsert({
      where: { code: req.code },
      update: {},
      create: req,
    });
  }

  console.log("Seed complete. Default owner:", owner.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
