/**
 * The pure half of `prisma/seed-production-like.ts` (#385): everything that decides WHAT the production-sized estate
 * looks like, with no database and no Prisma client, so it can be unit-tested and so a dry run can describe the
 * result before anything is written.
 *
 * - `isLocalDatabaseUrl` / `describeDatabaseTarget`: the production guard.
 * - `buildEstatePlan`: the catalogs that exist, the Systems that exist and the Users that exist go in; a plain,
 *   deterministic plan object comes out (same input, same plan). The names, vendors, owners and the status mix come
 *   from `public/design/systems/data.js`, whose Park-Miller generator is copied here.
 *
 * Marker: every row the script creates and that is not removed by a cascade from a System has an id starting with
 * `MARKER`; replace and clean-up select by that prefix, never by display name.
 */
import type { ImpactLevel, OnboardingStatus } from "@prisma/client";

export const MARKER = "seed385-";
export const SEED = 385;
export const TARGET_SYSTEMS = 100;

// ---------------------------------------------------------------------------------------------------------------
// The production guard
// ---------------------------------------------------------------------------------------------------------------

/** Hosts that mean "this machine or the local docker compose database". Anything else is treated as a shared database. */
export function isLocalDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // `?host=/var/run/postgresql` style URLs name the host in the query; a unix socket path is local.
  const hostParam = parsed.searchParams.get("host");
  const host = (hostParam ?? parsed.hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (hostParam !== null && host.startsWith("/")) return true;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost") || host === "db";
}

/** `host:port/database`, never the user or the password. */
export function describeDatabaseTarget(url: string | undefined | null): string {
  if (!url) return "(no DATABASE_URL)";
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)";
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${database}`;
  } catch {
    return "(unreadable DATABASE_URL)";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The generator and the example data (public/design/systems/data.js)
// ---------------------------------------------------------------------------------------------------------------

/** The Park-Miller generator of `data.js`, seeded; returns numbers in [0, 1). */
export function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export const OWNER_NAMES = ["Priya Shah", "Marcus Lindqvist", "Elena Voss", "Jonas Berg", "Amira Haddad", "Lucas Ortega", "Sofia Nilsson", "Kenji Mori", "Hanna Ek", "David Okafor"];

/** The names `data.js` uses for Business Units, used only when the Business Unit catalog is empty. */
export const DEFAULT_BUSINESS_UNITS = ["Engineering", "IT Operations", "HR", "Finance", "Legal", "Sales", "Marketing", "Customer Support"];

export const DEFAULT_INFORMATION_TYPES: { name: string; sensitivityLevel: number }[] = [
  { name: "Customer personal data", sensitivityLevel: 3 },
  { name: "Payroll", sensitivityLevel: 4 },
  { name: "Source code", sensitivityLevel: 3 },
  { name: "Published marketing content", sensitivityLevel: 1 },
  { name: "Financial records", sensitivityLevel: 4 },
  { name: "Employee records", sensitivityLevel: 4 },
];

export const DEFAULT_FACETS: { name: string; requiresVendorDetails: boolean }[] = [
  { name: "SaaS", requiresVendorDetails: true },
  { name: "Cloud IaaS/PaaS", requiresVendorDetails: false },
  { name: "On-Premises Datacenter", requiresVendorDetails: false },
];

/** [name, vendor]: the `NAMES` of `data.js`; a null vendor is an in-house System. */
export const NAMES: readonly (readonly [string, string | null])[] = [
  ["Jira", "Atlassian"], ["Confluence", "Atlassian"], ["Microsoft 365", "Microsoft"], ["OpenText", "OpenText"],
  ["Salesforce", "Salesforce"], ["Workday", "Workday"], ["SAP S/4HANA", "SAP"], ["ServiceNow", "ServiceNow"],
  ["GitHub Enterprise", "GitHub"], ["Slack", "Salesforce"], ["Zoom", "Zoom"], ["DocuSign", "DocuSign"],
  ["HubSpot", "HubSpot"], ["Zendesk", "Zendesk"], ["Okta", "Okta"], ["Entra ID", "Microsoft"],
  ["Azure landing zone", "Microsoft"], ["AWS Organisation", "Amazon"], ["Datadog", "Datadog"], ["Splunk", "Cisco"],
  ["Snowflake", "Snowflake"], ["Tableau", "Salesforce"], ["Power BI", "Microsoft"], ["Figma", "Figma"],
  ["Miro", "Miro"], ["Notion", "Notion"], ["Asana", "Asana"], ["Monday.com", "monday"],
  ["Visma Lön", "Visma"], ["Fortnox", "Fortnox"], ["Coupa", "Coupa"], ["Concur", "SAP"],
  ["Greenhouse", "Greenhouse"], ["BambooHR", "BambooHR"], ["Personio", "Personio"], ["Lattice", "Lattice"],
  ["1Password", "AgileBits"], ["CrowdStrike Falcon", "CrowdStrike"], ["Intune", "Microsoft"], ["Jamf Pro", "Jamf"],
  ["Veeam backup", "Veeam"], ["NetApp filers", "NetApp"], ["VMware cluster", "Broadcom"], ["Citrix VDI", "Cloud Software"],
  ["Oracle EBS", "Oracle"], ["Dynamics 365", "Microsoft"], ["Mailchimp", "Intuit"], ["Contentful", "Contentful"],
  ["Customer portal", null], ["Order service", null], ["Billing engine", null], ["Data warehouse", null],
  ["Payroll integration", null], ["Partner API gateway", null], ["Mobile app backend", null], ["Pricing service", null],
  ["Identity broker", null], ["Document archive", null], ["Ticket bridge", null], ["Reporting hub", null],
  ["Kubernetes platform", null], ["CI runners", null], ["Artifact registry", null], ["Feature flags", "LaunchDarkly"],
  ["Sentry", "Functional Software"], ["PagerDuty", "PagerDuty"], ["Statuspage", "Atlassian"], ["Cloudflare", "Cloudflare"],
  ["Twilio", "Twilio"], ["SendGrid", "Twilio"], ["Stripe", "Stripe"], ["Adyen", "Adyen"],
  ["Klarna checkout", "Klarna"], ["Bankgirot file transfer", "Bankgirot"], ["Swish integration", "Getswish"], ["BankID", "Finansiell ID-Teknik"],
  ["Intranet", null], ["Warehouse scanners", null], ["Badge access", "Axis"], ["CCTV recorder", "Milestone"],
  ["Print fleet", "Canon"], ["Meeting rooms", "Crestron"], ["Phone switch", "Telavox"], ["Wi-Fi controllers", "Cisco"],
  ["Legal hold", "Relativity"], ["Contract register", null], ["Board portal", "Diligent"], ["Whistleblower line", "WhistleB"],
  ["Learning platform", "Docebo"], ["Survey tool", "Qualtrics"], ["Translation memory", "Phrase"], ["Chat widget", "Intercom"],
  ["Analytics", "Google"], ["Tag manager", "Google"], ["Ad accounts", "Meta"], ["Brand assets", "Bynder"],
  ["ML feature store", null], ["Forecasting model", null], ["Fraud scoring", null], ["Search cluster", "Elastic"],
  ["Message bus", null], ["Event store", null], ["Legacy CRM", null], ["Mainframe batch", "IBM"],
  ["FTP drop zone", null], ["Expense cards", "Pleo"], ["Travel booking", "Navan"], ["Fleet tracking", "Samsara"],
  ["Lab LIMS", "LabWare"], ["QMS", "Veeva"], ["PLM", "PTC"], ["CAD vault", "Autodesk"],
  ["GIS server", "Esri"], ["Energy metering", null], ["Building BMS", "Siemens"], ["Visitor log", "Envoy"],
];

/** The regex of `data.js` that marks a System as a Provider. */
export const PROVIDER_PATTERN = /Entra|landing zone|AWS Org|Kubernetes|Veeam|Okta|Identity broker|Cloudflare/;

export type ProviderKind = "identity" | "cloud" | "backup" | "cdn";

export function providerKindOf(name: string): ProviderKind | null {
  if (!PROVIDER_PATTERN.test(name)) return null;
  if (/Entra|Okta|Identity broker/.test(name)) return "identity";
  if (/landing zone|AWS Org|Kubernetes/.test(name)) return "cloud";
  if (/Veeam/.test(name)) return "backup";
  return "cdn";
}

/** The status mix of `data.js`: ~18% Draft, ~18% In review, ~14% Approved, ~44% Onboarded, ~6% Rejected. */
export const STATUS_SHARES: readonly (readonly [OnboardingStatus, number])[] = [
  ["DRAFT", 0.18],
  ["IN_REVIEW", 0.18],
  ["APPROVED", 0.14],
  ["ONBOARDED", 0.44],
  ["REJECTED", 0.06],
];

/** How many of `total` each share gets, by largest remainder, so the counts add up exactly. */
export function allocateCounts<K extends string>(total: number, shares: readonly (readonly [K, number])[]): Record<K, number> {
  const exact = shares.map(([key, share]) => ({ key, floor: Math.floor(total * share), rest: total * share - Math.floor(total * share) }));
  let left = total - exact.reduce((sum, entry) => sum + entry.floor, 0);
  for (const entry of [...exact].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    entry.floor += 1;
    left -= 1;
  }
  return Object.fromEntries(exact.map((entry) => [entry.key, entry.floor])) as Record<K, number>;
}

// ---------------------------------------------------------------------------------------------------------------
// Input and output of the plan
// ---------------------------------------------------------------------------------------------------------------

export type CatalogInput = {
  facets: { id: string; name: string; requiresVendorDetails: boolean }[];
  businessUnits: { id: string; name: string }[];
  informationTypes: { id: string; name: string; sensitivityLevel: number; suggestedFrameworkIds: string[] }[];
  frameworks: { id: string; name: string; version: string; status: "DRAFT" | "PUBLISHED"; isBase: boolean }[];
  /** The Sensitivity Levels that exist (1-5). */
  sensitivityLevels: number[];
  /** Names of every System NOT created by this script. */
  existingSystemNames: string[];
  /** Every User NOT created by this script. */
  existingUsers: { id: string; email: string }[];
  stagedEvaluationEnabled: boolean;
};

export type UserRolePlan = "SYSTEM_OWNER" | "REVIEWER" | "RISK_OWNER" | "INTERNAL_AUDITOR";

export type PlannedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRolePlan;
  /** False: an existing User with this email is reused as it is and never modified. */
  create: boolean;
};

export type PlannedDetails = {
  vendorWebsiteUrl: string | null;
  serviceUrl: string | null;
  productPlan: string | null;
  dataLocation: "SWEDEN" | "EU_EEA" | "OUTSIDE_EU_EEA" | "UNKNOWN" | null;
  dataProcessingAgreement: "SIGNED" | "IN_PROGRESS" | "NOT_SIGNED" | "NOT_NEEDED" | null;
  contractReference: string | null;
  /** Months from the run until the contract renews; null when there is no contract. */
  contractRenewsInMonths: number | null;
  noticePeriodMonths: number | null;
};

/** Days before the run for every date of a System's life. Null: that step never happened. */
export type PlannedTimeline = {
  createdDaysAgo: number;
  updatedDaysAgo: number;
  submittedDaysAgo: number | null;
  decidedDaysAgo: number | null;
  onboardedDaysAgo: number | null;
};

export type PlannedSystem = {
  index: number;
  id: string;
  name: string;
  vendor: string | null;
  description: string;
  status: OnboardingStatus;
  ownerId: string;
  facetIds: string[];
  businessUnitIds: string[];
  sensitivityLevel: number | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
  informationTypeIds: string[];
  /** Declared Framework Scope rows on top of the base Framework (which the writer adds). */
  scopeFrameworkIds: string[];
  /** Suggested Frameworks the owner left out, one row per declaring type. */
  declinedSuggestions: { informationTypeId: string; frameworkId: string }[];
  isProvider: boolean;
  providerKind: ProviderKind | null;
  /** Ids of the planned Provider Systems this one depends on. */
  dependsOnIds: string[];
  /** The share of applicable Controls to leave addressed (Fulfilled, Not Applicable or Waived). */
  doneShare: number;
  openQuestions: number;
  riskCount: number;
  /** A Draft that was rejected once and returned to the owner. */
  returnedToDraft: boolean;
  /** A Draft in staged evaluation (first round), only when the App Setting is on. */
  staged: boolean;
  /** A Rejected System was rejected at OG3 by this Business System Owner (staged evaluation closes it for good). */
  businessSystemOwnerId: string | null;
  details: PlannedDetails | null;
  timeline: PlannedTimeline;
};

export type PlannedComparison = {
  id: string;
  name: string;
  need: string;
  ownerId: string;
  candidateIds: string[];
  /** Null: open. Otherwise the outcome to record. */
  outcome: { chosenId: string | null; comment: string } | null;
};

export type PlannedInternalAudit = {
  id: string;
  title: string;
  scopeDescription: string;
  systemIds: string[];
  createdById: string;
  dueInDays: number;
};

export type EstatePlan = {
  seed: number;
  users: PlannedUser[];
  /** Catalog entries the script has to create because the catalog is empty (marker ids). */
  catalogsToCreate: {
    facets: { id: string; name: string; requiresVendorDetails: boolean }[];
    businessUnits: { id: string; name: string }[];
    informationTypes: { id: string; name: string; sensitivityLevel: number }[];
  };
  systems: PlannedSystem[];
  comparisons: PlannedComparison[];
  internalAudit: PlannedInternalAudit | null;
  /** Names left out because a System of that name exists that this script did not create. */
  skippedNames: string[];
  /** What the plan leaves out and why, for the dry-run output. */
  notes: string[];
  reviewerId: string;
  riskOwnerId: string;
  auditorId: string;
};

// ---------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const LEVELS: ImpactLevel[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const DATA_LOCATIONS = ["SWEDEN", "EU_EEA", "EU_EEA", "OUTSIDE_EU_EEA", "UNKNOWN"] as const;
const DPA_STATUSES = ["SIGNED", "SIGNED", "SIGNED", "IN_PROGRESS", "NOT_SIGNED", "NOT_NEEDED"] as const;
const PRODUCT_PLANS = ["Enterprise", "Business", "Standard", "Premium", "Team"];
const REJECTION_COMMENTS = [
  "Evidence for the access-control Controls is incomplete. Attach the latest access review and resubmit.",
  "The Sensitivity Level does not match the Information Types declared. Reclassify and resubmit.",
  "No data processing agreement is in place yet. Sign it before this goes further.",
];
const REJECTION_AT_GATE = [
  "Not authorized to operate: the residual risk is above what the business accepts.",
  "Rejected: the vendor could not commit to the retention and deletion terms we need.",
  "Rejected: overlaps with a System we already run, and the migration cost is not justified.",
];
export const APPROVAL_COMMENTS = [
  "Meets the baseline Controls.",
  "Approved with the follow-up Risks tracked.",
  "Evidence reviewed and accepted.",
  "Approved. Re-check at the next Internal Audit.",
];
export const QUERY_QUESTIONS = [
  "Can you attach evidence for this? The link in the notes no longer opens.",
  "Does this also cover the vendor's sub-processors?",
  "Who owns this Control on your side after the reorganisation?",
  "The answer says Yes, but the description suggests a manual process. Which is it?",
  "Is this covered by the vendor's SOC 2 report, or do we run it ourselves?",
  "Please explain how this is tested, and how often.",
];
export const QUERY_REPLIES = [
  "Updated the evidence link and added last quarter's export.",
  "Yes, the sub-processor list is in the DPA annex. Linked in the notes.",
  "It is run by the platform team now; I have asked them to confirm here.",
];
export const AD_HOC_RISKS: { title: string; description: string }[] = [
  { title: "Shared admin account still in use", description: "A shared administrator login is used by two teams for break-glass access and is not rotated." },
  { title: "Vendor support staff can reach production data", description: "Support access is granted ad hoc and is not logged on our side." },
  { title: "No tested restore for the last quarter", description: "Backups run, but the last successful restore test is older than the policy allows." },
  { title: "Integration uses a long-lived API token", description: "A service token without expiry is used by an integration owned by another team." },
  { title: "End-of-life component in the stack", description: "A supporting component reaches end of vendor support within the year." },
  { title: "Offboarding is manual", description: "Leavers are removed by ticket, and removals have been late in three of the last ten cases." },
  { title: "Data export not reviewed", description: "Scheduled exports to a shared drive have never been reviewed for personal data." },
  { title: "Single person holds the runbook", description: "Only one engineer knows how to recover this System after a failure." },
  { title: "Logging retention shorter than policy", description: "Audit logs are kept for 30 days; the policy asks for 12 months." },
  { title: "Contract renewal missed the notice period", description: "The notice period is shorter than the time the review takes." },
];

type Step = { id: string; title: string };
void ({} as Step);

/** Builds the whole estate plan. Pure: the same input always gives the same plan. */
export function buildEstatePlan(input: CatalogInput): EstatePlan {
  const rnd = makeRng(SEED);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];
  const notes: string[] = [];

  // --- Catalogs: use what exists, create marker entries only for an empty catalog ---------------------------------
  const catalogsToCreate: EstatePlan["catalogsToCreate"] = { facets: [], businessUnits: [], informationTypes: [] };
  let facets = input.facets;
  if (facets.length === 0) {
    catalogsToCreate.facets = DEFAULT_FACETS.map((facet) => ({ id: `${MARKER}facet-${slug(facet.name)}`, ...facet }));
    facets = catalogsToCreate.facets;
    notes.push(`The Deployment Facet catalog is empty: ${facets.length} marker Deployment Facets will be created.`);
  }
  let businessUnits = input.businessUnits;
  if (businessUnits.length === 0) {
    catalogsToCreate.businessUnits = DEFAULT_BUSINESS_UNITS.map((name) => ({ id: `${MARKER}bu-${slug(name)}`, name }));
    businessUnits = catalogsToCreate.businessUnits;
    notes.push(`The Business Unit catalog is empty: ${businessUnits.length} marker Business Units will be created.`);
  }
  const levelsAvailable = [...input.sensitivityLevels].sort((a, b) => a - b);
  let informationTypes = input.informationTypes;
  if (informationTypes.length === 0 && levelsAvailable.length > 0) {
    catalogsToCreate.informationTypes = DEFAULT_INFORMATION_TYPES.filter((type) => levelsAvailable.includes(type.sensitivityLevel)).map((type) => ({
      id: `${MARKER}infotype-${slug(type.name)}`,
      ...type,
    }));
    informationTypes = catalogsToCreate.informationTypes.map((type) => ({ ...type, suggestedFrameworkIds: [] }));
    notes.push(`The Information Type catalog is empty: ${informationTypes.length} marker Information Types will be created.`);
  }
  const publishedNonBase = input.frameworks.filter((framework) => framework.status === "PUBLISHED" && !framework.isBase);
  const suggestable = new Set(publishedNonBase.map((framework) => framework.id));

  // Facet roles: the one that needs vendor details (SaaS), cloud, on-premises.
  const vendorFacet = facets.find((facet) => facet.requiresVendorDetails) ?? facets[0];
  const cloudFacet = facets.find((facet) => /cloud|iaas|paas/i.test(facet.name)) ?? facets[1 % facets.length];
  const onPremFacet = facets.find((facet) => /prem|datacenter|data cent/i.test(facet.name)) ?? facets[2 % facets.length];

  // --- Users -------------------------------------------------------------------------------------------------------
  const existingByEmail = new Map(input.existingUsers.map((user) => [user.email.toLowerCase(), user.id]));
  const userFor = (name: string, role: UserRolePlan, email: string): PlannedUser => {
    const existingId = existingByEmail.get(email);
    return { id: existingId ?? `${MARKER}user-${slug(name)}`, email, name, role, create: existingId === undefined };
  };
  const owners = OWNER_NAMES.map((name) => userFor(name, "SYSTEM_OWNER", `${slug(name).replace("-", ".")}@example.com`));
  const reviewer = userFor("Nora Falk", "REVIEWER", "nora.falk@example.com");
  const riskOwner = userFor("Tomas Wikner", "RISK_OWNER", "tomas.wikner@example.com");
  const auditor = userFor("Ingrid Sjoberg", "INTERNAL_AUDITOR", "ingrid.sjoberg@example.com");
  const users = [...owners, reviewer, riskOwner, auditor];

  // --- Which names -------------------------------------------------------------------------------------------------
  const taken = new Set(input.existingSystemNames.map((name) => name.trim().toLowerCase()));
  const skippedNames: string[] = [];
  const chosen = NAMES.filter(([name]) => {
    if (taken.has(name.toLowerCase())) {
      skippedNames.push(name);
      return false;
    }
    return true;
  }).slice(0, TARGET_SYSTEMS);
  const count = chosen.length;

  // --- Statuses: the exact mix, Providers always Onboarded, the rest shuffled -----------------------------------
  const counts = allocateCounts(count, STATUS_SHARES);
  const providerCount = chosen.filter(([name]) => providerKindOf(name) !== null).length;
  counts.ONBOARDED = Math.max(0, counts.ONBOARDED - providerCount);
  const pool: OnboardingStatus[] = STATUS_SHARES.flatMap(([status]) => Array<OnboardingStatus>(counts[status]).fill(status));
  while (pool.length < count - providerCount) pool.push("ONBOARDED");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const systems: PlannedSystem[] = [];
  let poolIndex = 0;
  chosen.forEach(([name, vendor], index) => {
    const id = `${MARKER}sys-${String(index + 1).padStart(3, "0")}`;
    const providerKind = providerKindOf(name);
    const status: OnboardingStatus = providerKind ? "ONBOARDED" : pool[poolIndex++];
    const owner = pick(owners);

    // Deployment Facets, as `data.js` does: a vendor System is mostly SaaS, otherwise cloud and/or on-premises.
    let facetIds: string[];
    if (providerKind === "identity") facetIds = [vendor ? vendorFacet.id : cloudFacet.id];
    else if (providerKind === "cloud") facetIds = [cloudFacet.id];
    else if (providerKind === "backup") facetIds = [onPremFacet.id, cloudFacet.id];
    else if (providerKind === "cdn") facetIds = [vendorFacet.id];
    else if (vendor && rnd() < 0.7) facetIds = [vendorFacet.id];
    else facetIds = rnd() < 0.5 ? [cloudFacet.id] : rnd() < 0.6 ? [onPremFacet.id] : [cloudFacet.id, onPremFacet.id];
    facetIds = [...new Set(facetIds)];
    const needsVendorDetails = facetIds.some((facetId) => facets.find((facet) => facet.id === facetId)?.requiresVendorDetails);

    // Business Units: one, sometimes two.
    const unit = pick(businessUnits);
    const unitIds = [unit.id];
    if (businessUnits.length > 1 && rnd() < 0.3) unitIds.push(pick(businessUnits.filter((other) => other.id !== unit.id)).id);

    // Information Types and the Sensitivity Level they set the floor for (ADR 0012).
    const typeRoll = rnd();
    const typeCount = informationTypes.length === 0 ? 0 : typeRoll < 0.35 ? 0 : typeRoll < 0.8 ? 1 : typeRoll < 0.95 ? 2 : 3;
    const typeIds: string[] = [];
    while (typeIds.length < Math.min(typeCount, informationTypes.length)) {
      const type = pick(informationTypes);
      if (!typeIds.includes(type.id)) typeIds.push(type.id);
    }
    const types = typeIds.map((typeId) => informationTypes.find((type) => type.id === typeId)!);
    const floor = types.length === 0 ? null : Math.max(...types.map((type) => type.sensitivityLevel));
    const levelRoll = rnd();
    const pickedLevel = levelsAvailable.length === 0 ? null : levelsAvailable[Math.min(levelsAvailable.length - 1, Math.floor(levelRoll * levelRoll * levelsAvailable.length * 1.4))];
    const unclassifiedDraft = status === "DRAFT" && types.length === 0 && rnd() < 0.3;
    let sensitivityLevel: number | null = unclassifiedDraft || levelsAvailable.length === 0 ? null : pickedLevel === null ? null : Math.max(pickedLevel, floor ?? 0);
    if (sensitivityLevel !== null && !levelsAvailable.includes(sensitivityLevel)) sensitivityLevel = levelsAvailable.find((level) => level >= sensitivityLevel!) ?? levelsAvailable[levelsAvailable.length - 1];
    if (floor !== null && (sensitivityLevel === null || sensitivityLevel < floor)) sensitivityLevel = floor;

    const levelOf = (): ImpactLevel | null => (status === "DRAFT" && rnd() < 0.25 ? null : LEVELS[Math.floor(rnd() * 4)]);
    const integrityImpactLevel = levelOf();
    const availabilityImpactLevel = levelOf();

    // Framework Scope: a suggested Framework is added or left out (never left open); sometimes one nobody suggested.
    const scopeFrameworkIds: string[] = [];
    const declinedSuggestions: PlannedSystem["declinedSuggestions"] = [];
    const suggested = [...new Set(types.flatMap((type) => informationTypes.find((entry) => entry.id === type.id)!.suggestedFrameworkIds))].filter((frameworkId) => suggestable.has(frameworkId));
    for (const frameworkId of suggested) {
      if (rnd() < 0.65) scopeFrameworkIds.push(frameworkId);
      else
        for (const type of types) {
          if (informationTypes.find((entry) => entry.id === type.id)!.suggestedFrameworkIds.includes(frameworkId)) declinedSuggestions.push({ informationTypeId: type.id, frameworkId });
        }
    }
    if (publishedNonBase.length > 0 && rnd() < 0.15) {
      const extra = pick(publishedNonBase);
      if (!scopeFrameworkIds.includes(extra.id) && !declinedSuggestions.some((decline) => decline.frameworkId === extra.id)) scopeFrameworkIds.push(extra.id);
    }

    // State that fits the status.
    const doneShare =
      status === "ONBOARDED" ? 0.85 + rnd() * 0.15
      : status === "APPROVED" ? 0.7 + rnd() * 0.25
      : status === "IN_REVIEW" ? 0.35 + rnd() * 0.45
      : status === "DRAFT" ? (rnd() < 0.3 ? 0 : rnd() * 0.3)
      : 0.2 + rnd() * 0.4;
    const questions = status === "IN_REVIEW" || status === "DRAFT" ? (rnd() < 0.45 ? 1 + Math.floor(rnd() * 5) : 0) : rnd() < 0.08 ? 1 : 0;
    const riskCount = Math.floor(rnd() * rnd() * 6);
    const returnedToDraft = status === "DRAFT" && rnd() < 0.2;

    // Dates: how long ago the last change was, then the steps before it.
    const updatedDaysAgo = status === "DRAFT" ? Math.floor(rnd() * 200) : Math.floor(rnd() * rnd() * 220);
    const gap = (min: number, spread: number) => min + Math.floor(rnd() * spread);
    let submittedDaysAgo: number | null = null;
    let decidedDaysAgo: number | null = null;
    let onboardedDaysAgo: number | null = null;
    if (status === "ONBOARDED") {
      onboardedDaysAgo = updatedDaysAgo;
      decidedDaysAgo = onboardedDaysAgo + gap(1, 10);
      submittedDaysAgo = decidedDaysAgo + gap(2, 20);
    } else if (status === "APPROVED") {
      decidedDaysAgo = updatedDaysAgo;
      submittedDaysAgo = decidedDaysAgo + gap(2, 20);
    } else if (status === "IN_REVIEW") {
      submittedDaysAgo = updatedDaysAgo;
    } else if (returnedToDraft) {
      decidedDaysAgo = updatedDaysAgo + gap(0, 4);
      submittedDaysAgo = decidedDaysAgo + gap(1, 10);
    }
    const lastStep = submittedDaysAgo ?? updatedDaysAgo;
    const createdDaysAgo = Math.min(lastStep + gap(8, 60), Math.max(lastStep + 8, 300));

    // Vendor details (#357): required by a facet like SaaS, otherwise there for most vendor Systems.
    let details: PlannedDetails | null = null;
    if (vendor && (needsVendorDetails || rnd() < 0.6)) {
      const hasContract = rnd() < 0.8;
      details = {
        vendorWebsiteUrl: `https://www.${slug(vendor)}.example`,
        serviceUrl: `https://${slug(name)}.example.com`,
        productPlan: pick(PRODUCT_PLANS),
        dataLocation: pick(DATA_LOCATIONS),
        dataProcessingAgreement: pick(DPA_STATUSES),
        contractReference: hasContract ? `C-${2024 + Math.floor(rnd() * 3)}-${String(100 + Math.floor(rnd() * 900))}` : null,
        contractRenewsInMonths: hasContract ? 2 + Math.floor(rnd() * 34) : null,
        noticePeriodMonths: hasContract ? 1 + Math.floor(rnd() * 6) : null,
      };
    } else if (needsVendorDetails) {
      details = null;
    }

    const unitNames = unitIds.map((unitId) => businessUnits.find((entry) => entry.id === unitId)!.name).join(" and ");
    const description = vendor
      ? `${name} from ${vendor}, used by ${unitNames}.`
      : `In-house ${name}, built and run by ${owner.name}'s team for ${unitNames}.`;

    systems.push({
      index,
      id,
      name,
      vendor,
      description,
      status,
      ownerId: owner.id,
      facetIds,
      businessUnitIds: unitIds,
      sensitivityLevel,
      integrityImpactLevel,
      availabilityImpactLevel,
      informationTypeIds: typeIds,
      scopeFrameworkIds,
      declinedSuggestions,
      isProvider: providerKind !== null,
      providerKind,
      dependsOnIds: [],
      doneShare,
      openQuestions: questions,
      riskCount,
      returnedToDraft,
      staged: false,
      businessSystemOwnerId: null,
      details,
      timeline: { createdDaysAgo, updatedDaysAgo, submittedDaysAgo, decidedDaysAgo, onboardedDaysAgo },
    });
  });

  // --- Providers: other Systems depend on them, so inherited Control status shows ---------------------------------
  const providersOf = (kind: ProviderKind) => systems.filter((system) => system.providerKind === kind);
  for (const system of systems) {
    if (system.isProvider || system.status === "REJECTED") continue;
    const depends = new Set<string>();
    const identity = providersOf("identity");
    const cloud = providersOf("cloud");
    const backup = providersOf("backup");
    const cdn = providersOf("cdn");
    const rolls = [rnd(), rnd(), rnd(), rnd()];
    const picks = [rnd(), rnd(), rnd(), rnd()];
    const choose = (list: PlannedSystem[], pickRoll: number) => list[Math.floor(pickRoll * list.length)];
    if (identity.length > 0 && rolls[0] < 0.45) depends.add(choose(identity, picks[0]).id);
    if (cloud.length > 0 && system.facetIds.includes(cloudFacet.id) && rolls[1] < 0.6) depends.add(choose(cloud, picks[1]).id);
    if (backup.length > 0 && system.facetIds.includes(onPremFacet.id) && rolls[2] < 0.6) depends.add(choose(backup, picks[2]).id);
    if (cdn.length > 0 && rolls[3] < 0.2) depends.add(choose(cdn, picks[3]).id);
    system.dependsOnIds = [...depends];
  }

  // --- Rejected: closed for good at the last gate by a Business System Owner -------------------------------------
  for (const system of systems) {
    if (system.status !== "REJECTED") continue;
    system.businessSystemOwnerId = pick(owners.filter((user) => user.id !== system.ownerId)).id;
  }

  // --- Staged evaluation and Comparisons: only when the App Setting is on ----------------------------------------
  const comparisons: PlannedComparison[] = [];
  if (input.stagedEvaluationEnabled) {
    const stageable = systems.filter((system) => system.status === "DRAFT" && !system.returnedToDraft);
    const staged = stageable.slice(0, 7);
    staged.forEach((system) => (system.staged = true));
    if (staged.length >= 6) {
      comparisons.push({
        id: `${MARKER}comparison-1`,
        name: "Chat and meetings platform",
        need: "One tool for chat and video meetings for the whole company, replacing three that overlap.",
        ownerId: staged[0].ownerId,
        candidateIds: staged.slice(0, 3).map((system) => system.id),
        outcome: null,
      });
      comparisons.push({
        id: `${MARKER}comparison-2`,
        name: "Customer support desk",
        need: "A ticketing and chat tool for customer support with Swedish-language support and EU data residency.",
        ownerId: staged[3].ownerId,
        candidateIds: staged.slice(3, 6).map((system) => system.id),
        outcome: { chosenId: staged[3].id, comment: "Best fit on the first-round Controls and keeps data in the EU." },
      });
    }
  } else {
    notes.push("Staged evaluation is off (App Setting), so no System gets an Evaluation stage and no Comparison is created: a Candidate must be a staged System.");
  }

  // --- One Internal Audit (draft): a handful of Onboarded Systems ---------------------------------------------------
  const auditable = systems.filter((system) => system.status === "ONBOARDED" && !system.isProvider).slice(0, 6);
  const internalAudit: PlannedInternalAudit | null =
    auditable.length >= 3
      ? {
          id: `${MARKER}audit-1`,
          title: "Access and backup Controls across business-critical Systems",
          scopeDescription: "Verify user access management and backup Controls on a sample of Onboarded Systems.",
          systemIds: auditable.map((system) => system.id),
          createdById: auditor.id,
          dueInDays: 45,
        }
      : null;
  notes.push("The Internal Audit is created as a draft (not launched), so it owns no Check-ups and a re-run can replace it.");

  return {
    seed: SEED,
    users,
    catalogsToCreate,
    systems,
    comparisons,
    internalAudit,
    skippedNames,
    notes,
    reviewerId: reviewer.id,
    riskOwnerId: riskOwner.id,
    auditorId: auditor.id,
  };
}

export const REJECTION_TEXT = { returned: REJECTION_COMMENTS, gate: REJECTION_AT_GATE };
