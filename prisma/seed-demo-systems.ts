/**
 * Demo-only seed: 10 fictive-but-recognizable enterprise Systems, spread
 * across every lifecycle stage/role scenario, so the app's views (landing
 * page, /systems, admin catalogs, Business Risk Owner dashboard) can be
 * inspected against realistic data rather than an empty database.
 *
 * Not wired into `prisma db seed` — run on demand:
 *   npx tsx prisma/seed-demo-systems.ts
 *
 * Idempotent: re-running deletes and recreates the 10 named Systems (their
 * Assessments/Risks/Approvals cascade with them) without touching anything
 * else (Control Library, other Systems/Users).
 */
import type { ImpactLevel } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getApplicableControls, type SystemClassification } from "../src/lib/control-assessments";
import { applyCapabilityDeclared } from "../src/lib/capability-fulfillment";

const DEMO_SYSTEM_NAMES = [
  "Jira",
  "Confluence",
  "Microsoft 365",
  "OpenText",
  "CATIA",
  "Workday",
  "ServiceNow",
  "GitHub",
  "Entra ID",
  "Unily",
];

async function main() {
  // --- Users -------------------------------------------------------------
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
  const reviewer = await prisma.user.findUniqueOrThrow({ where: { email: "reviewer@example.com" } });
  const riskOwner = await prisma.user.findUniqueOrThrow({ where: { email: "risk-owner@example.com" } });
  const businessRiskOwner = await prisma.user.findUniqueOrThrow({
    where: { email: "business-risk-owner@example.com" },
  });

  const extraOwners = [
    { email: "priya.shah@example.com", name: "Priya Shah", role: "SYSTEM_OWNER" as const },
    { email: "marcus.lindqvist@example.com", name: "Marcus Lindqvist", role: "SYSTEM_OWNER" as const },
    { email: "elena.voss@example.com", name: "Elena Voss", role: "SYSTEM_OWNER" as const },
  ];
  for (const u of extraOwners) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: u });
  }
  const priya = await prisma.user.findUniqueOrThrow({ where: { email: "priya.shah@example.com" } });
  const marcus = await prisma.user.findUniqueOrThrow({ where: { email: "marcus.lindqvist@example.com" } });
  const elena = await prisma.user.findUniqueOrThrow({ where: { email: "elena.voss@example.com" } });

  // --- Cleanup (idempotent re-run) ----------------------------------------
  await prisma.system.deleteMany({ where: { name: { in: DEMO_SYSTEM_NAMES } } });

  // --- Catalogs ------------------------------------------------------------
  const facetNames = ["SaaS", "Cloud IaaS/PaaS", "On-Premises Datacenter"] as const;
  const facets = Object.fromEntries(
    await Promise.all(
      facetNames.map(async (name) => [
        name,
        await prisma.deploymentFacet.upsert({ where: { name }, update: {}, create: { name } }),
      ]),
    ),
  ) as Record<(typeof facetNames)[number], { id: string }>;

  // The regimes that used to be Regulatory Overlays (retired by ADR 0007 / #88)
  // are Frameworks now, shaped exactly as the migration creates them (version
  // '1', QUOTABLE, Published, no Requirements yet), so a freshly seeded database
  // matches a migrated one. A System declaring one puts it in its Framework Scope.
  const regimeNames = ["GDPR", "Export Control (EAR/ITAR)"] as const;
  const regimes = Object.fromEntries(
    await Promise.all(
      regimeNames.map(async (name) => [
        name,
        await prisma.framework.upsert({
          where: { name_version: { name, version: "1" } },
          update: {},
          create: { name, version: "1", licensing: "QUOTABLE", status: "PUBLISHED" },
        }),
      ]),
    ),
  ) as Record<(typeof regimeNames)[number], { id: string }>;

  const businessUnitNames = ["Engineering", "IT Operations", "HR", "Finance", "Legal", "Sales"] as const;
  const businessUnits = Object.fromEntries(
    await Promise.all(
      businessUnitNames.map(async (name) => [
        name,
        await prisma.businessUnit.upsert({ where: { name }, update: {}, create: { name } }),
      ]),
    ),
  ) as Record<(typeof businessUnitNames)[number], { id: string }>;

  // The base Framework, created by the main seed (prisma/seed.ts).
  const isoFramework = await prisma.framework.findFirstOrThrow({ where: { isBase: true } });

  // Corporate SSO capability, auto-fulfilling the identity/access-control
  // Controls a System inherits by declaring it — see CONTEXT.md's
  // Capability entry (deliberately distinct from the Entra ID *System* below,
  // even though it's the same real-world product, per that glossary note).
  const ssoCapability = await prisma.capability.upsert({
    where: { name: "Entra ID SSO" },
    update: {},
    create: { name: "Entra ID SSO" },
  });
  const ssoControlCodes = ["A.5.15", "A.5.16", "A.5.17", "A.8.5"];
  await prisma.capability.update({
    where: { id: ssoCapability.id },
    data: { controls: { connect: ssoControlCodes.map((code) => ({ code })) } },
  });

  // Scope one PER_SYSTEM Control to the On-Premises Datacenter facet
  // only, so it can be used below to demonstrate a stale ControlAssessment
  // (one left behind after a System's declared Facets change) — see
  // getStaleAssessments.
  const equipmentSiting = await prisma.control.update({
    where: { code: "A.7.8" },
    data: { deploymentFacets: { connect: { id: facets["On-Premises Datacenter"].id } } },
  });

  // --- Helpers ---------------------------------------------------------
  async function fulfillMost(
    system: { id: string } & SystemClassification,
    options: { waiveEvery?: number; naEvery?: number } = {},
  ) {
    const applicable = await getApplicableControls(system);
    const { waiveEvery = 11, naEvery = 23 } = options;
    const rows = applicable.map((control, i) => {
      if (i > 0 && i % naEvery === 0) {
        return {
          systemId: system.id,
          controlId: control.id,
          status: "NOT_APPLICABLE" as const,
          selfAssessmentAnswer: "NA" as const,
          notes: "Not applicable to this deployment model — confirmed with vendor's shared-responsibility matrix.",
          assessedById: owner.id,
          assessedAt: new Date(),
        };
      }
      if (i > 0 && i % waiveEvery === 0) {
        return {
          systemId: system.id,
          controlId: control.id,
          status: "WAIVED" as const,
          notes: "Waived pending vendor roadmap item; compensating control tracked as a Risk.",
          assessedById: riskOwner.id,
          assessedAt: new Date(),
        };
      }
      return {
        systemId: system.id,
        controlId: control.id,
        status: "FULFILLED" as const,
        selfAssessmentAnswer: "YES" as const,
        evidence: "See onboarding evidence pack in Confluence.",
        assessedById: owner.id,
        assessedAt: new Date(),
      };
    });
    await prisma.controlAssessment.createMany({ data: rows });
  }

  async function partiallyAssess(system: { id: string } & SystemClassification, doneCount: number) {
    const applicable = await getApplicableControls(system);
    const rows = applicable.slice(0, doneCount).map((control, i) => ({
      systemId: system.id,
      controlId: control.id,
      status: i % 4 === 0 ? ("IN_PROGRESS" as const) : ("FULFILLED" as const),
      selfAssessmentAnswer: i % 4 === 0 ? undefined : ("YES" as const),
      assessedById: i % 4 === 0 ? undefined : owner.id,
      assessedAt: i % 4 === 0 ? undefined : new Date(),
    }));
    if (rows.length > 0) await prisma.controlAssessment.createMany({ data: rows });
  }

  function classification(
    facetKeys: (keyof typeof facets)[],
    regimeKeys: (keyof typeof regimes)[] = [],
    impact: {
      c?: ImpactLevel | null;
      i?: ImpactLevel | null;
      a?: ImpactLevel | null;
    } = {},
  ): SystemClassification {
    return {
      deploymentFacets: facetKeys.map((k) => ({ id: facets[k].id })),
      // Declared Framework Scope rows (here just the regimes); the base Framework (ISO 27001) is always in scope on top.
      frameworkScopes: regimeKeys.map((k) => ({ id: regimes[k].id })),
      confidentialityImpactLevel: impact.c ?? null,
      integrityImpactLevel: impact.i ?? null,
      availabilityImpactLevel: impact.a ?? null,
    };
  }

  // --- 1. Jira (Onboarded) ------------------------------------------------
  const jiraClass = classification(["SaaS"], [], { c: "MODERATE", i: "MODERATE", a: "HIGH" });
  const jira = await prisma.system.create({
    data: {
      name: "Jira",
      vendor: "Atlassian",
      description: "Issue tracking and agile project management for engineering teams.",
      ownerId: priya.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: jiraClass.deploymentFacets },
      confidentialityImpactLevel: jiraClass.confidentialityImpactLevel,
      integrityImpactLevel: jiraClass.integrityImpactLevel,
      availabilityImpactLevel: jiraClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.Engineering.id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }] },
    },
  });
  await fulfillMost({ id: jira.id, ...jiraClass });
  await prisma.approval.create({
    data: { systemId: jira.id, approverId: reviewer.id, decision: "APPROVED", comment: "Meets baseline controls." },
  });
  await prisma.risk.create({
    data: {
      systemId: jira.id,
      title: "Third-party marketplace apps not centrally reviewed",
      description: "Team-installed Jira/Confluence marketplace apps can request broad OAuth scopes.",
      severity: "MEDIUM",
      likelihood: "MEDIUM",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });
  await prisma.risk.create({
    data: {
      systemId: jira.id,
      title: "Guest access left enabled on a project",
      description: "An external-guest project was found with anonymous issue viewing enabled.",
      severity: "LOW",
      likelihood: "LOW",
      status: "CLOSED",
      ownerId: riskOwner.id,
    },
  });

  // --- 2. Confluence (Onboarded) ------------------------------------------
  const confluenceClass = classification(["SaaS"], ["GDPR"], { c: "MODERATE", i: "MODERATE", a: "MODERATE" });
  const confluence = await prisma.system.create({
    data: {
      name: "Confluence",
      vendor: "Atlassian",
      description: "Team wiki and documentation platform.",
      ownerId: priya.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: confluenceClass.deploymentFacets },
      confidentialityImpactLevel: confluenceClass.confidentialityImpactLevel,
      integrityImpactLevel: confluenceClass.integrityImpactLevel,
      availabilityImpactLevel: confluenceClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.Engineering.id }, { id: businessUnits.Legal.id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }, ...confluenceClass.frameworkScopes] },
    },
  });
  await fulfillMost({ id: confluence.id, ...confluenceClass });
  await prisma.approval.create({
    data: { systemId: confluence.id, approverId: reviewer.id, decision: "APPROVED" },
  });
  await prisma.risk.create({
    data: {
      systemId: confluence.id,
      title: "Personal data occasionally pasted into meeting-notes pages",
      description: "Spot-check found employee PII pasted into unrestricted spaces.",
      severity: "MEDIUM",
      likelihood: "HIGH",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });

  // --- 3. Microsoft 365 (Onboarded, declares Entra ID SSO capability) -----
  const m365Class = classification(["SaaS"], ["GDPR"], { c: "HIGH", i: "HIGH", a: "CRITICAL" });
  const m365 = await prisma.system.create({
    data: {
      name: "Microsoft 365",
      vendor: "Microsoft",
      description: "Email, calendaring, and office productivity suite for the whole organization.",
      ownerId: marcus.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: m365Class.deploymentFacets },
      confidentialityImpactLevel: m365Class.confidentialityImpactLevel,
      integrityImpactLevel: m365Class.integrityImpactLevel,
      availabilityImpactLevel: m365Class.availabilityImpactLevel,
      businessUnits: {
        connect: businessUnitNames.map((name) => ({ id: businessUnits[name].id })),
      },
      frameworkScopes: { connect: [{ id: isoFramework.id }, ...m365Class.frameworkScopes] },
      capabilities: { connect: [{ id: ssoCapability.id }] },
    },
  });
  await fulfillMost({ id: m365.id, ...m365Class });
  await applyCapabilityDeclared({ id: m365.id, ...m365Class }, ssoCapability);
  await prisma.approval.create({
    data: { systemId: m365.id, approverId: reviewer.id, decision: "APPROVED", comment: "Org-wide baseline." },
  });
  await prisma.risk.create({
    data: {
      systemId: m365.id,
      title: "Legacy mail-protocol basic auth still permitted for two service accounts",
      description: "IMAP/SMTP basic auth exceptions predate the Conditional Access rollout.",
      severity: "HIGH",
      likelihood: "MEDIUM",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });
  await prisma.risk.create({
    data: {
      systemId: m365.id,
      title: "Phishing-simulation click rate above target",
      description: "Quarterly phishing simulation click-through rate exceeded the 5% target.",
      severity: "MEDIUM",
      likelihood: "HIGH",
      status: "MITIGATED",
      mitigationPlan: "Additional mandatory security-awareness training rolled out org-wide.",
      ownerId: riskOwner.id,
    },
  });

  // --- 4. OpenText (In Review) ---------------------------------------------
  const openTextClass = classification(["On-Premises Datacenter", "Cloud IaaS/PaaS"], [], {
    c: "HIGH",
    i: "MODERATE",
    a: "MODERATE",
  });
  const openText = await prisma.system.create({
    data: {
      name: "OpenText",
      vendor: "OpenText",
      description: "Enterprise content management and records archive for Legal.",
      ownerId: marcus.id,
      status: "IN_REVIEW",
      deploymentFacets: { connect: openTextClass.deploymentFacets },
      confidentialityImpactLevel: openTextClass.confidentialityImpactLevel,
      integrityImpactLevel: openTextClass.integrityImpactLevel,
      availabilityImpactLevel: openTextClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.Legal.id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }] },
    },
  });
  await fulfillMost({ id: openText.id, ...openTextClass });
  await prisma.risk.create({
    data: {
      systemId: openText.id,
      title: "Records-retention schedule not yet enforced automatically",
      description: "Legal hold and retention rules are currently applied manually by records staff.",
      severity: "MEDIUM",
      likelihood: "MEDIUM",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });

  // --- 5. CATIA (Draft, rejected-and-returned + stale Assessment) ---------
  // First declared On-Premises Datacenter (the license server's original
  // home), so A.7.8 (Equipment siting and protection, scoped to that facet
  // above) was applicable and got assessed — then the System migrated to
  // Cloud IaaS/PaaS, leaving that Assessment stale (see getStaleAssessments).
  const catiaInitialClass = classification(["On-Premises Datacenter"], ["Export Control (EAR/ITAR)"], {
    c: "HIGH",
    i: "HIGH",
    a: "MODERATE",
  });
  const catia = await prisma.system.create({
    data: {
      name: "CATIA",
      vendor: "Dassault Systèmes",
      description: "CAD/PLM platform for mechanical and aerospace engineering design.",
      ownerId: owner.id,
      status: "DRAFT",
      deploymentFacets: { connect: catiaInitialClass.deploymentFacets },
      frameworkScopes: { connect: catiaInitialClass.frameworkScopes },
      confidentialityImpactLevel: catiaInitialClass.confidentialityImpactLevel,
      integrityImpactLevel: catiaInitialClass.integrityImpactLevel,
      availabilityImpactLevel: catiaInitialClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.Engineering.id }] },
    },
  });
  await prisma.controlAssessment.create({
    data: {
      systemId: catia.id,
      controlId: equipmentSiting.id,
      status: "FULFILLED",
      selfAssessmentAnswer: "YES",
      evidence: "Datacenter access-control audit, 2026 Q1.",
      assessedById: owner.id,
      assessedAt: new Date(),
    },
  });
  await partiallyAssess({ id: catia.id, ...catiaInitialClass }, 12);
  // Rejected once while still assembling evidence...
  await prisma.approval.create({
    data: {
      systemId: catia.id,
      approverId: reviewer.id,
      decision: "REJECTED",
      comment: "Export-control classification evidence was incomplete — please attach the ECCN determination.",
    },
  });
  // ...then migrated the license server to cloud, orphaning the equipment
  // Assessment above (a direct facet swap, not through the recompute path,
  // to actually produce the stale-assessment scenario rather than have it
  // cleaned up automatically).
  await prisma.system.update({
    where: { id: catia.id },
    data: {
      deploymentFacets: {
        disconnect: [{ id: facets["On-Premises Datacenter"].id }],
        connect: [{ id: facets["Cloud IaaS/PaaS"].id }],
      },
    },
  });

  // --- 6. Workday (Onboarded) ----------------------------------------------
  const workdayClass = classification(["SaaS"], ["GDPR"], { c: "CRITICAL", i: "HIGH", a: "HIGH" });
  const workday = await prisma.system.create({
    data: {
      name: "Workday",
      vendor: "Workday, Inc.",
      description: "HR system of record: payroll, benefits, and employee lifecycle management.",
      ownerId: elena.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: workdayClass.deploymentFacets },
      confidentialityImpactLevel: workdayClass.confidentialityImpactLevel,
      integrityImpactLevel: workdayClass.integrityImpactLevel,
      availabilityImpactLevel: workdayClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.HR.id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }, ...workdayClass.frameworkScopes] },
    },
  });
  await fulfillMost({ id: workday.id, ...workdayClass });
  await prisma.approval.create({
    data: { systemId: workday.id, approverId: reviewer.id, decision: "APPROVED", comment: "PII controls verified." },
  });
  // A "No" self-assessment answer, left open with its auto-generated Risk —
  // see CONTEXT.md's Risk entry.
  const dataMaskingControl = await prisma.control.findUniqueOrThrow({ where: { code: "A.8.11" } });
  const dataMaskingAssessment = await prisma.controlAssessment.upsert({
    where: { systemId_controlId: { systemId: workday.id, controlId: dataMaskingControl.id } },
    update: { selfAssessmentAnswer: "NO", status: "IN_PROGRESS", assessedById: elena.id, assessedAt: new Date() },
    create: {
      systemId: workday.id,
      controlId: dataMaskingControl.id,
      selfAssessmentAnswer: "NO",
      status: "IN_PROGRESS",
      assessedById: elena.id,
      assessedAt: new Date(),
    },
  });
  await prisma.risk.create({
    data: {
      systemId: workday.id,
      title: "Compensation data not masked in the sandbox/reporting tenant",
      description: "Non-production reporting tenant currently mirrors production compensation fields unmasked.",
      severity: "HIGH",
      likelihood: "MEDIUM",
      status: "OPEN",
      ownerId: riskOwner.id,
      controlAssessmentId: dataMaskingAssessment.id,
    },
  });

  // --- 7. ServiceNow (In Review) --------------------------------------------
  const serviceNowClass = classification(["SaaS"], [], { c: "MODERATE", i: "MODERATE", a: "HIGH" });
  const serviceNow = await prisma.system.create({
    data: {
      name: "ServiceNow",
      vendor: "ServiceNow",
      description: "IT service management: incident, change, and asset workflows.",
      ownerId: marcus.id,
      status: "IN_REVIEW",
      deploymentFacets: { connect: serviceNowClass.deploymentFacets },
      confidentialityImpactLevel: serviceNowClass.confidentialityImpactLevel,
      integrityImpactLevel: serviceNowClass.integrityImpactLevel,
      availabilityImpactLevel: serviceNowClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits["IT Operations"].id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }] },
    },
  });
  await fulfillMost({ id: serviceNow.id, ...serviceNowClass });

  // --- 8. GitHub (Onboarded, declares Entra ID SSO capability) ------------
  const githubClass = classification(["SaaS"], [], { c: "HIGH", i: "HIGH", a: "MODERATE" });
  const github = await prisma.system.create({
    data: {
      name: "GitHub",
      vendor: "GitHub (Microsoft)",
      description: "Source control and CI/CD for every engineering repository.",
      ownerId: priya.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: githubClass.deploymentFacets },
      confidentialityImpactLevel: githubClass.confidentialityImpactLevel,
      integrityImpactLevel: githubClass.integrityImpactLevel,
      availabilityImpactLevel: githubClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits.Engineering.id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }] },
      capabilities: { connect: [{ id: ssoCapability.id }] },
    },
  });
  await fulfillMost({ id: github.id, ...githubClass });
  await applyCapabilityDeclared({ id: github.id, ...githubClass }, ssoCapability);
  await prisma.approval.create({
    data: { systemId: github.id, approverId: reviewer.id, decision: "APPROVED" },
  });
  await prisma.risk.create({
    data: {
      systemId: github.id,
      title: "A handful of repos still allow direct pushes to main",
      description: "Branch-protection rollout is not yet 100% across all repositories.",
      severity: "MEDIUM",
      likelihood: "MEDIUM",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });

  // --- 9. Entra ID (Onboarded) ----------------------------------------------
  // The identity platform itself, tracked as a System distinct from the
  // "Entra ID SSO" Capability other Systems declare — see CONTEXT.md.
  const entraClass = classification(["SaaS"], [], { c: "CRITICAL", i: "CRITICAL", a: "CRITICAL" });
  const entra = await prisma.system.create({
    data: {
      name: "Entra ID",
      vendor: "Microsoft",
      description: "Central identity provider: SSO, Conditional Access, and privileged identity management.",
      ownerId: marcus.id,
      status: "ONBOARDED",
      onboardedAt: new Date(),
      deploymentFacets: { connect: entraClass.deploymentFacets },
      confidentialityImpactLevel: entraClass.confidentialityImpactLevel,
      integrityImpactLevel: entraClass.integrityImpactLevel,
      availabilityImpactLevel: entraClass.availabilityImpactLevel,
      businessUnits: { connect: [{ id: businessUnits["IT Operations"].id }] },
      frameworkScopes: { connect: [{ id: isoFramework.id }] },
    },
  });
  await fulfillMost({ id: entra.id, ...entraClass }, { waiveEvery: 19, naEvery: 37 });
  await prisma.approval.create({
    data: {
      systemId: entra.id,
      approverId: reviewer.id,
      decision: "APPROVED",
      comment: "Critical infrastructure — approved with a follow-up Risk tracked for PIM coverage.",
    },
  });
  await prisma.risk.create({
    data: {
      systemId: entra.id,
      title: "Privileged Identity Management review overdue for two roles",
      description: "Quarterly access review for Global Administrator and Exchange Administrator is overdue.",
      severity: "CRITICAL",
      likelihood: "LOW",
      status: "OPEN",
      ownerId: riskOwner.id,
    },
  });

  // --- 10. Unily (Draft, clean/in-progress) --------------------------------
  const unily = await prisma.system.create({
    data: {
      name: "Unily",
      vendor: "Unily",
      description: "Employee intranet and internal communications hub.",
      ownerId: owner.id,
      status: "DRAFT",
      deploymentFacets: { connect: [{ id: facets.SaaS.id }] },
      businessUnits: { connect: [{ id: businessUnits.HR.id }, { id: businessUnits["IT Operations"].id }] },
    },
  });
  await partiallyAssess(
    { id: unily.id, ...classification(["SaaS"]) },
    9,
  );

  console.log("Demo Systems seeded:", DEMO_SYSTEM_NAMES.join(", "));
  console.log("Owners:", [owner, priya, marcus, elena].map((u) => u.email).join(", "));
  console.log(`Business Risk Owner portfolio: Business Unit "Engineering" + Framework "${isoFramework.name}:${isoFramework.version}".`);
  await prisma.user.update({
    where: { id: businessRiskOwner.id },
    data: {
      businessUnitScopes: { set: [{ id: businessUnits.Engineering.id }] },
      frameworkScopes: { set: [{ id: isoFramework.id }] },
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
