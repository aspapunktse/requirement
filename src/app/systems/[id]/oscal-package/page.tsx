import Link from "next/link";
import { notFound } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { closedRefusalText } from "@/lib/system-closed";
import { loadOscalPackage, OSCAL_APP_NS } from "@/lib/oscal/package-builder";
import { OscalPackageReview } from "./OscalPackageReview";

/**
 * A System's OSCAL Package as a page to review and print (#445, PRD #440), at `/systems/<id>/oscal-package`. Built from the same
 * `loadOscalPackage` as the download (`/api/systems/<id>/oscal-package`), so the two can't disagree, with the same access rules: an
 * unknown or invisible System is not found (404), a Rejected or Not selected one is refused. A page can't choose a 409 once it has
 * started rendering, so the refusal is a message in the page with the same text the download answers with.
 */
export default async function OscalPackageReviewPage({ params }: PageProps<"/systems/[id]/oscal-package">) {
  const { id } = await params;
  const user = await getActingUser();
  if (!user) return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;

  const result = await loadOscalPackage(id, user);
  if (result.kind === "not-found") notFound();
  if (result.kind === "closed") {
    return (
      <p className="p-6" role="status">
        {closedRefusalText(result.status)}. <Link href={`/systems/${id}`}>Back to the System</Link>
      </p>
    );
  }
  return <OscalPackageReview pkg={result.pkg} systemId={result.system.id} appNs={OSCAL_APP_NS} />;
}
