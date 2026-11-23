/**
 * One-off: brings the Systems already in a Compliance Boundary up to date with the Boundary's Frameworks (#419).
 *
 * Before #419 a Boundary's Frameworks did nothing, so members joined (#418) without their Control Assessments being synced.
 * From #419 on those Frameworks are part of each member's effective Framework Scope; this adds the Assessments that should
 * exist, logs one Change Event on each System that changed and starts or widens a Change Review on an Onboarded System.
 * Idempotent: a second run changes nothing. Selects Systems by their Boundary memberships, never by id or name.
 *
 * Dry run by default (computes everything and rolls it back); `--apply` writes.
 *
 *   npx tsx scripts/reconcile-boundary-scope.ts            # report only
 *   npx tsx scripts/reconcile-boundary-scope.ts --apply    # write
 */
import { prisma } from "../src/lib/prisma";
import { reconcileBoundaryScope } from "../src/lib/reconcile-boundary-scope";

async function main() {
  const apply = process.argv.includes("--apply");
  const summary = await reconcileBoundaryScope({ apply });
  console.log(apply ? "Applied." : "Dry run: nothing written (pass --apply to write).");
  for (const system of summary.systems) {
    console.log(`  ${system.name}: +${system.added}/-${system.removed} Control Assessment(s), Change Review ${system.changeReview}`);
  }
  console.log(
    `${summary.systems.length} System(s) in a Boundary; ${summary.added} Assessment(s) ${apply ? "created" : "to create"}, ${summary.removed} ${apply ? "removed" : "to remove"}, ${summary.reviews} Change Review(s) ${apply ? "started or widened" : "to start or widen"}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
