/**
 * The Sensitivity Levels as the migration `20261102120000_add_sensitivity_level` inserts them (ADR 0011).
 * The database is the source of truth; this copy serves the Admin form's "Default" button and the token CSS when the
 * database cannot be read. A test keeps it equal to the migration's INSERT. The colours are data, not UI colour in use.
 */
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

export const DEFAULT_SENSITIVITY_LEVELS: readonly SensitivityLevelInfo[] = [
  { level: 1, label: "Public", description: "Information anyone may see. Publishing it harms nobody.", textColor: "#475569", backgroundColor: "#F1F5F9" },
  { level: 2, label: "Internal", description: "Everyday business information meant for staff, not for the public.", textColor: "#1D4ED8", backgroundColor: "#EFF6FF" },
  { level: 3, label: "Sensitive", description: "Information that would cause harm or embarrassment if it leaked.", textColor: "#854D0E", backgroundColor: "#FEF9C3" },
  { level: 4, label: "Highly Sensitive", description: "Information whose leak would seriously harm people or the business, or break the law.", textColor: "#9A3412", backgroundColor: "#FFEDD5" },
  { level: 5, label: "Critical Sensitivity", description: "Information whose leak or loss would threaten the organisation itself.", textColor: "#991B1B", backgroundColor: "#FEE2E2" },
];
