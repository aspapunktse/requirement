import type { RiskStatus } from "@prisma/client";
import { OSCAL_APP_NS } from "@/lib/oscal/ids";

/**
 * The app's Risk status as OSCAL says it (product-owner decision, #456), shared by the Assessment Results and the POA&M.
 * Mitigated and Closed are both `closed`; Accepted and Transferred are `deviation-approved`, and a Transferred Risk also
 * carries the `transferred` prop (true, in the app's namespace). The app's own status travels as the `risk-status` prop.
 */
export function oscalRiskStatus(status: RiskStatus): { state: string; props: { name: string; ns: string; value: string }[] } {
  switch (status) {
    case "OPEN":
      return { state: "open", props: [] };
    case "MITIGATED":
    case "CLOSED":
      return { state: "closed", props: [] };
    case "ACCEPTED":
      return { state: "deviation-approved", props: [] };
    case "TRANSFERRED":
      return { state: "deviation-approved", props: [{ name: "transferred", ns: OSCAL_APP_NS, value: "true" }] };
  }
}
