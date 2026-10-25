import type { SystemRow, SystemsView } from "../systems-types";

/** Row and view builders for the Systems list's unit and component tests. */
export const NOW = "2026-10-25T09:00:00.000Z";

export const row = (over: Partial<SystemRow> & Pick<SystemRow, "id" | "name">): SystemRow => ({
  vendor: null,
  isProvider: false,
  status: "ONBOARDED",
  ownerId: "u-priya",
  ownerName: "Priya Shah",
  facets: [{ id: "f-saas", name: "SaaS" }],
  businessUnits: [{ id: "b-fin", name: "Finance" }],
  confidentiality: "MODERATE",
  integrity: "MODERATE",
  availability: "MODERATE",
  openQuestions: 0,
  met: 8,
  applicable: 10,
  updatedAt: "2026-10-20T09:00:00.000Z",
  inRoleView: false,
  needsAttention: false,
  ...over,
});

export const ROWS: SystemRow[] = [
  row({ id: "s-jira", name: "Jira", vendor: "Atlassian", ownerId: "u-me", ownerName: "Marcus Lindqvist", inRoleView: true, met: 9, applicable: 10 }),
  row({
    id: "s-billing",
    name: "Billing engine",
    status: "IN_REVIEW",
    ownerId: "u-elena",
    ownerName: "Elena Voss",
    facets: [{ id: "f-cloud", name: "Cloud IaaS/PaaS" }, { id: "f-onprem", name: "On-Premises Datacenter" }],
    businessUnits: [{ id: "b-eng", name: "Engineering" }, { id: "b-fin", name: "Finance" }],
    confidentiality: "HIGH",
    integrity: "CRITICAL",
    availability: null,
    openQuestions: 3,
    needsAttention: true,
    met: 3,
    applicable: 10,
    updatedAt: "2026-10-24T09:00:00.000Z",
  }),
  row({ id: "s-okta", name: "Okta", vendor: "Okta", isProvider: true, ownerId: "u-priya", status: "APPROVED", met: 10, applicable: 10, updatedAt: "2025-10-24T09:00:00.000Z" }),
  row({
    id: "s-legacy",
    name: "Legacy CRM",
    status: "DRAFT",
    ownerId: "u-elena",
    ownerName: "Elena Voss",
    businessUnits: [],
    facets: [],
    confidentiality: null,
    integrity: null,
    availability: null,
    met: null,
    applicable: null,
    needsAttention: true,
    updatedAt: "2026-06-01T09:00:00.000Z",
  }),
  row({ id: "s-hub", name: "=HYPERLINK(hub)", vendor: 'Acme, "Inc"', status: "REJECTED", ownerId: "u-priya", needsAttention: true, confidentiality: "LOW", integrity: "LOW", availability: "LOW", met: 0, applicable: 4 }),
];

export const view = (over: Partial<SystemsView> = {}): SystemsView => ({
  userId: "u-me",
  userName: "Marcus Lindqvist",
  role: "SYSTEM_OWNER",
  roleLabel: "System Owner",
  canCreate: true,
  now: NOW,
  rows: ROWS,
  roleView: { label: "Owned by me", warn: false },
  trends: { all: [3, 4, 5], attention: [1, 2, 3] },
  baseFramework: "ISO/IEC 27001:2022",
  ...over,
});
