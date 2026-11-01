import { getActingUser } from "@/lib/acting-user";
import { loadAuditExport } from "@/lib/soa-audit-export";
import { PrintStatement } from "./PrintStatement";

/**
 * The Statement of Applicability for audit (PRD 0001 F-OUT.6, #273): a server-rendered, print-styled page of
 * the whole Statement. The print dialog opens on load; "Save as PDF" makes the file. Readable by every
 * signed-in role, like the page and the CSV export, and always the whole Statement (the page's filters do not
 * apply). It shows System rollup counts only, so it is the same for every role.
 */
export default async function StatementOfApplicabilityPrintPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const { cover, rows } = await loadAuditExport(user);
  return <PrintStatement cover={cover} rows={rows} />;
}
