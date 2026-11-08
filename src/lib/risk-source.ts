import { z } from "zod";

/**
 * A Risk's source (#322, PRD 0002 F-RA.1; CONTEXT.md "Risk Source"). Plain values, free of Prisma, so
 * client components share the one list and the labels. Mirrors the `RiskSource` enum in schema.prisma.
 */
export const RISK_SOURCES = ["REQUIREMENT_NONCONFORMANCE", "AUDIT_FINDING", "AD_HOC"] as const;
export type RiskSourceValue = (typeof RISK_SOURCES)[number];

export const RISK_SOURCE_LABELS: Record<RiskSourceValue, string> = {
  REQUIREMENT_NONCONFORMANCE: "Requirement non-conformance",
  AUDIT_FINDING: "Audit finding",
  AD_HOC: "Ad hoc",
};

/** For validating a `source` filter on a request. */
export const riskSourceSchema = z.enum(RISK_SOURCES);
