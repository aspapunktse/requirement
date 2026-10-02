/**
 * Read-only pre-deploy check for migration `20261002130000_retire_capability`
 * (#126, ADR 0008, PRD 0001 F-IN.8), which turns every Capability into a Provider
 * System.
 *
 * It reports what the migration will do against the database in DATABASE_URL and
 * whether it will ABORT, so the product owner can run it against production
 * before merging. It writes nothing (only SELECTs) and exits 1 when the migration
 * would abort, 0 otherwise.
 *
 *   npx tsx scripts/check-capability-migration.ts
 *
 * Per Capability it prints: the Provider that will be created and any existing
 * System with the same name (names are not unique, so the Provider is created
 * anyway), its owning Admin, the classification it gets (the union of the Systems
 * that declared the Capability), those Systems, the Full Offerings that will be
 * created, the mapped Controls that get NO Offering and why (Organizational, or the
 * Control does not apply to the Provider), how the declaring Systems' own
 * Assessments of the offered Controls will read afterwards, and the auto-fulfilled
 * Assessments (`fulfilledByCapabilityId`) that go back to untouched and those that
 * are left as they are.
 *
 * The only case where the migration aborts: Capabilities exist and there is no
 * Admin to own the Providers.
 *
 * It reads the Capability tables with raw SQL because, after this change, the
 * Prisma client no longer has a Capability model, and it works on a database where
 * they are already gone ("nothing to migrate"). Whether a Control applies to a
 * Provider is decided here with the application's own rule
 * (`controlAppliesToSystem`); the migration decides it in SQL, and the rehearsal on
 * a copy of the database checks the two agree.
 */
import type { ImpactLevel } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { controlAppliesToSystem, type SystemClassification } from "../src/lib/control-applicability";

const IMPACT_RANK: Record<ImpactLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
const highest = (levels: (ImpactLevel | null)[]): ImpactLevel | null =>
  levels.reduce<ImpactLevel | null>(
    (best, level) => (level && (!best || IMPACT_RANK[level] > IMPACT_RANK[best]) ? level : best),
    null,
  );

type CapabilityRow = { id: string; name: string; description: string | null };

const exists = async (table: string) =>
  (await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT to_regclass('"${table}"') IS NOT NULL AS exists`))[0].exists;

async function main() {
  if (!(await exists("Capability"))) {
    console.log("No Capability table: the migration has already been applied (or this is a fresh database). Nothing to migrate.");
    return;
  }

  const capabilities = await prisma.$queryRawUnsafe<CapabilityRow[]>(
    `SELECT "id", "name", "description" FROM "Capability" ORDER BY "name", "id"`,
  );
  console.log(`Capabilities: ${capabilities.length}`);
  if (capabilities.length === 0) {
    console.log("\nRESULT: nothing to migrate; the migration only drops the (empty) Capability tables.");
    return;
  }

  let wouldAbort = false;

  const [admin] = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1,
  });
  if (!admin) {
    wouldAbort = true;
    console.log(
      "\n!! WOULD ABORT: there is no Admin to own the Providers. Create an Admin (or promote a User) before deploying; " +
        "if the migration already failed, run `prisma migrate resolve --rolled-back 20261002130000_retire_capability` too.",
    );
  } else {
    console.log(`Owning Admin of every new Provider: ${admin.name} <${admin.email}> (the earliest-created Admin)`);
  }

  const declaredRows = await prisma.$queryRawUnsafe<{ capability: string; system: string }[]>(
    `SELECT "A" AS capability, "B" AS system FROM "_CapabilityToSystem"`,
  );
  const mappedRows = await prisma.$queryRawUnsafe<{ capability: string; control: string }[]>(
    `SELECT "A" AS capability, "B" AS control FROM "_CapabilityToControl"`,
  );
  const autoRows = await prisma.$queryRawUnsafe<{ id: string; capability: string }[]>(
    `SELECT "id", "fulfilledByCapabilityId" AS capability FROM "ControlAssessment" WHERE "fulfilledByCapabilityId" IS NOT NULL`,
  );

  const autoAssessments = await prisma.controlAssessment.findMany({
    where: { id: { in: autoRows.map((r) => r.id) } },
    select: { id: true, systemId: true, controlId: true, status: true, assessedById: true, evidence: true, notes: true, selfAssessmentAnswer: true },
  });
  const capabilityOfAssessment = new Map(autoRows.map((r) => [r.id, r.capability]));

  // Every System a Capability row or an auto-fulfilled Assessment points at.
  const systemIds = [...new Set([...declaredRows.map((r) => r.system), ...autoAssessments.map((a) => a.systemId)])];
  const systems = await prisma.system.findMany({
    where: { id: { in: systemIds } },
    select: {
      id: true,
      name: true,
      status: true,
      isProvider: true,
      confidentialityImpactLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      deploymentFacets: { select: { id: true, name: true } },
      frameworkScopes: { select: { id: true, name: true, version: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const systemById = new Map(systems.map((s) => [s.id, s]));

  const controls = await prisma.control.findMany({
    select: {
      id: true,
      code: true,
      title: true,
      applicability: true,
      minConfidentialityImpactLevel: true,
      minIntegrityImpactLevel: true,
      minAvailabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
    },
    orderBy: { code: "asc" },
  });
  const controlById = new Map(controls.map((c) => [c.id, c]));

  const ownOfferings = (await exists("ControlOffering"))
    ? await prisma.controlOffering.findMany({ select: { providerId: true, controlId: true } })
    : [];
  const offersControl = new Set(ownOfferings.map((o) => `${o.providerId}|${o.controlId}`));

  const ownRows = await prisma.controlAssessment.findMany({
    where: { systemId: { in: declaredRows.map((r) => r.system) } },
    select: { systemId: true, controlId: true, status: true, assessedById: true },
  });
  const ownRowOf = new Map(ownRows.map((r) => [`${r.systemId}|${r.controlId}`, r]));

  const classificationOf = (system: (typeof systems)[number]): SystemClassification => system;

  let totalProviders = 0;
  let totalOfferings = 0;
  let totalReset = 0;
  let totalLeft = 0;
  let totalNoOffering = 0;

  for (const capability of capabilities) {
    const declaring = declaredRows
      .filter((r) => r.capability === capability.id)
      .map((r) => systemById.get(r.system))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    const declaringIds = new Set(declaring.map((s) => s.id));

    // The Provider's classification: the union of the declaring Systems.
    const facets = new Map(declaring.flatMap((s) => s.deploymentFacets).map((f) => [f.id, f.name]));
    const scopes = new Map(declaring.flatMap((s) => s.frameworkScopes).map((f) => [f.id, `${f.name} ${f.version}`]));
    const providerClass: SystemClassification = {
      deploymentFacets: [...facets.keys()].map((id) => ({ id })),
      frameworkScopes: [...scopes.keys()].map((id) => ({ id })),
      confidentialityImpactLevel: highest(declaring.map((s) => s.confidentialityImpactLevel)),
      integrityImpactLevel: highest(declaring.map((s) => s.integrityImpactLevel)),
      availabilityImpactLevel: highest(declaring.map((s) => s.availabilityImpactLevel)),
    };

    const sameName = await prisma.system.findMany({ where: { name: capability.name }, select: { id: true, name: true, status: true, isProvider: true } });
    console.log(`\nCapability "${capability.name}"`);
    console.log(`  Provider to create: "${capability.name}" (Onboarded, isProvider, owned by ${admin ? admin.name : "no Admin: would abort"})`);
    console.log(
      sameName.length === 0
        ? "  Existing System with the same name: none"
        : `  !  Existing System(s) with the same name (the Provider is created anyway; rename one to tell them apart): ${sameName
            .map((s) => `${s.name} [${s.status}${s.isProvider ? ", Provider" : ""}] ${s.id}`)
            .join("; ")}`,
    );
    console.log(
      `  Classification (union of the ${declaring.length} declaring System(s)): Deployment Facets: ${facets.size ? [...facets.values()].sort().join(", ") : "none"}; ` +
        `Framework Scope rows: ${scopes.size ? [...scopes.values()].sort().join(", ") : "none"}; ` +
        `Impact Levels C/I/A: ${providerClass.confidentialityImpactLevel ?? "-"}/${providerClass.integrityImpactLevel ?? "-"}/${providerClass.availabilityImpactLevel ?? "-"}`,
    );
    console.log(`  Declaring Systems (each depends on the Provider and gets one "system" Change Event): ${declaring.length}`);
    for (const s of declaring) console.log(`    - ${s.name} [${s.status}${s.isProvider ? ", Provider" : ""}]`);

    // Mapped Controls: Offering or not.
    const mapped = mappedRows
      .filter((r) => r.capability === capability.id)
      .map((r) => controlById.get(r.control))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .sort((a, b) => (a.code < b.code ? -1 : 1));
    const offered = mapped.filter((c) => controlAppliesToSystem(c, providerClass));
    const offeredIds = new Set(offered.map((c) => c.id));
    const dropped = mapped.filter((c) => !offeredIds.has(c.id));
    const applicableToProvider = controls.filter((c) => controlAppliesToSystem(c, providerClass));
    console.log(`  Mapped Controls: ${mapped.length}`);
    console.log(`  Full Offerings to create (each backed by a Fulfilled Assessment on the Provider): ${offered.length}${offered.length ? ` (${offered.map((c) => c.code).join(", ")})` : ""}`);
    // The union takes the highest level on each axis and every Facet and Framework Scope of the declaring Systems, so a
    // Control can apply to the Provider that no single declaring System has (a Facet of one, a threshold only another meets).
    const viaUnionOnly = offered.filter((c) => !declaring.some((s) => controlAppliesToSystem(c, classificationOf(s))));
    if (viaUnionOnly.length > 0) {
      console.log(
        `  Offerings that apply to the Provider only through the union (no single declaring System has the Control applicable, so no dependent is affected): ${viaUnionOnly.map((c) => c.code).join(", ")}`,
      );
    }
    console.log(`  Mapped Controls that get NO Offering: ${dropped.length}`);
    for (const c of dropped) {
      const why =
        c.applicability === "ORGANIZATIONAL"
          ? "Organizational: it has no Control Assessment to back an Offering"
          : "does not apply to the Provider (it applies to none of the declaring Systems)";
      console.log(`    - ${c.code} ${c.title}: ${why}`);
    }
    console.log(
      `  Assessments the Provider gets: ${applicableToProvider.length} (${offered.length} Fulfilled, ${applicableToProvider.length - offered.length} Not Started: they will show in the owning Admin's tasks and lower the pooled Compliance Percentage until assessed)`,
    );

    // How the declaring Systems' own Assessments of the offered Controls read afterwards.
    for (const s of declaring) {
      const own = { personSet: 0, nobodySetFulfilled: 0, becomesFulfilled: 0, notApplicable: 0 };
      for (const c of offered) {
        if (!controlAppliesToSystem(c, classificationOf(s))) {
          own.notApplicable += 1;
          continue;
        }
        const row = ownRowOf.get(`${s.id}|${c.id}`);
        if (row && row.assessedById !== null) own.personSet += 1;
        else if (row && row.status !== "NOT_STARTED") own.nobodySetFulfilled += 1;
        else own.becomesFulfilled += 1;
      }
      console.log(
        `    ${s.name}: of the ${offered.length} offered Control(s): ${own.personSet} person-set (unchanged), ${own.nobodySetFulfilled} already nobody-set and past Not Started (unchanged), ` +
          `${own.becomesFulfilled} untouched or without a row (become effectively Fulfilled through the Provider, unless already inherited), ${own.notApplicable} not applicable to the System`,
      );
    }

    // Auto-fulfilled Assessments of this Capability: reset to untouched, or left alone.
    const auto = autoAssessments.filter((a) => capabilityOfAssessment.get(a.id) === capability.id);
    const mappedIds = new Set(mapped.map((c) => c.id));
    let reset = 0;
    const left: string[] = [];
    for (const a of auto) {
      const system = systemById.get(a.systemId);
      const control = controlById.get(a.controlId);
      const label = `${system?.name ?? a.systemId} / ${control?.code ?? a.controlId}`;
      const touched =
        a.assessedById !== null ||
        a.status !== "FULFILLED" ||
        a.evidence !== null ||
        a.selfAssessmentAnswer !== null ||
        (a.notes !== null && !a.notes.startsWith("Inherited via "));
      let reason: string | null = null;
      if (touched) reason = "someone worked on it (not untouched)";
      else if (!declaringIds.has(a.systemId)) reason = "the System no longer declares the Capability";
      else if (!mappedIds.has(a.controlId)) reason = "the Capability no longer maps the Control";
      else if (!offeredIds.has(a.controlId)) reason = "the Control does not apply to the Provider, so no Offering covers it";
      else if (!system || !control || !controlAppliesToSystem(control, classificationOf(system))) reason = "the Control no longer applies to the System (a stale Assessment)";
      else if (offersControl.has(`${a.systemId}|${a.controlId}`)) reason = "the System is itself a Provider offering this Control, and its dependents read this status";
      if (reason) left.push(`${label}: ${reason}`);
      else reset += 1;
    }
    console.log(`  Auto-fulfilled Assessments (fulfilledByCapabilityId): ${auto.length}; reset to untouched Not Started (the Offering takes over): ${reset}; left exactly as they are (Fulfilled, nobody set): ${left.length}`);
    for (const line of left) console.log(`    - ${line}`);

    totalProviders += 1;
    totalOfferings += offered.length;
    totalNoOffering += dropped.length;
    totalReset += reset;
    totalLeft += left.length;
  }

  console.log(
    `\nTotals: ${totalProviders} Provider(s), ${totalOfferings} Full Offering(s), ${totalNoOffering} mapped Control(s) without an Offering, ` +
      `${totalReset} auto-fulfilled Assessment(s) reset, ${totalLeft} left as they are.`,
  );
  console.log(
    wouldAbort
      ? "\nRESULT: the migration WOULD ABORT (see the !! line). Nothing would be changed."
      : "\nRESULT: the migration would complete. No existing System's effective status for any Control goes down; the new Providers' own Controls start Not Started except the offered ones.",
  );
  if (wouldAbort) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
