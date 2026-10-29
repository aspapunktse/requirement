import type { ImpactLevel } from "@prisma/client";

/**
 * The wording of the System onboarding interview (design proposal A, issue #258): the seven steps, the
 * plain-language questions and the options of the three Impact Level steps. The Deployment Facets,
 * Frameworks and Providers are not here: they come from the catalogs.
 */

export type ImpactAxisKey = "confidentialityImpactLevel" | "integrityImpactLevel" | "availabilityImpactLevel";

export type InterviewStepKey = "delivery" | "sensitivity" | "integrity" | "downtime" | "laws" | "relies" | "review";

export type InterviewStep = {
  key: InterviewStepKey;
  /** Short name on the stepper and in the review. */
  label: string;
  /** The question, or for the last step its title. */
  title: string;
  help?: string;
};

export const INTERVIEW_STEPS: InterviewStep[] = [
  {
    key: "delivery",
    label: "Delivery",
    title: "How do you get the system?",
    help: "Pick every option that fits. A system that is partly bought as a service and partly run by you takes both.",
  },
  {
    key: "sensitivity",
    label: "Sensitivity",
    title: "What is the most sensitive information in it?",
    help: "Think of the worst document or record it holds, not the typical one.",
  },
  {
    key: "integrity",
    label: "Integrity",
    title: "What happens if its data is wrong or tampered with?",
    help: "Imagine someone changed records without anyone noticing for a week.",
  },
  {
    key: "downtime",
    label: "Downtime",
    title: "How long can the business manage without it?",
    help: "Count from when it stops working until the business is in real trouble.",
  },
  {
    key: "laws",
    label: "Laws and standards",
    title: "Laws and standards",
    help: "Answer each question. Anything that does not apply can stay as it is.",
  },
  {
    key: "relies",
    label: "Relies on",
    title: "What company services does it rely on?",
    help: "These do not change which controls apply. They change who does the work.",
  },
  { key: "review", label: "Review", title: "Review and create" },
];

export type ImpactOption = { level: ImpactLevel; title: string; hint: string };

export const IMPACT_STEPS: Record<"sensitivity" | "integrity" | "downtime", { axis: ImpactAxisKey; options: ImpactOption[] }> = {
  sensitivity: {
    axis: "confidentialityImpactLevel",
    options: [
      { level: "LOW", title: "Public or internal only", hint: "Price lists, intranet pages, internal guides." },
      { level: "MODERATE", title: "Internal business data", hint: "Plans, internal reports, ordinary customer contact details." },
      { level: "HIGH", title: "Confidential", hint: "Contracts, financials, HR records, customer data in bulk." },
      { level: "CRITICAL", title: "Strictly confidential", hint: "Trade secrets, health data, security keys." },
    ],
  },
  integrity: {
    axis: "integrityImpactLevel",
    options: [
      { level: "LOW", title: "A minor annoyance", hint: "Easy to spot and fix." },
      { level: "MODERATE", title: "Rework and delays", hint: "Staff time lost, decisions delayed." },
      { level: "HIGH", title: "Customers or money get hurt", hint: "Wrong invoices, wrong deliveries, financial loss." },
      { level: "CRITICAL", title: "Safety or legal consequences", hint: "Harm to people, regulatory breach." },
    ],
  },
  downtime: {
    axis: "availabilityImpactLevel",
    options: [
      { level: "LOW", title: "A week or more", hint: "People can wait or use a workaround." },
      { level: "MODERATE", title: "About a day", hint: "Work piles up but recovers." },
      { level: "HIGH", title: "A few hours", hint: "Customers notice quickly." },
      { level: "CRITICAL", title: "Minutes", hint: "It must always be up." },
    ],
  },
};

export const IMPACT_LEVEL_WORD: Record<ImpactLevel, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };
