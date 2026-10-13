import { NextRequest } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { csvFilename, csvResponse } from "@/lib/csv";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { statementOfApplicabilityCsv } from "@/lib/statement-of-applicability-csv";

/**
 * The Statement of Applicability as a CSV download (PRD 0001 F-OUT.5, #151): every
 * Control once, the same rows as the page and the JSON route. Readable by every
 * signed-in role. Draft mappings are left out for everyone, as in the view.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  return csvResponse(
    statementOfApplicabilityCsv(await loadStatementOfApplicability()),
    csvFilename(["statement-of-applicability"], new Date()),
  );
}
