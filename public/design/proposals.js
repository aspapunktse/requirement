// The list behind the /design landing page. Add an entry here whenever a new design proposal is
// built under public/design/<part>/ (see "Design proposals" in AGENTS.md). Newest part first.
// `id` is the vote key: keep it stable once people have voted, or the votes are orphaned.
window.DESIGN_PARTS = [
  {
    id: "soa",
    name: "Statement of Applicability",
    added: "2026-10-17",
    question: "How should the Statement of Applicability show 300+ Controls so it can be read, audited and completed?",
    proposals: [
      {
        id: "soa-a",
        label: "A",
        title: "Ledger",
        href: "/design/soa/proposal-a.html",
        summary: "Four chart cards that double as filters, views such as Missing justification, and a grouped table with a drawer to write exclusion justifications in place.",
      },
      {
        id: "soa-b",
        label: "B",
        title: "Mosaic",
        href: "/design/soa/proposal-b.html",
        summary: "A one-sentence summary and readiness ring, then three modes: one cell per Control by domain, a typeset document with an index, and a review queue for exclusions.",
      },
    ],
  },
  {
    id: "system",
    name: "System detail",
    added: "2026-10-17",
    question: "How should one System's page present its profile, Controls, Requirements, Risks and approval?",
    proposals: [
      {
        id: "system-a",
        label: "A",
        title: "Cockpit",
        href: "/design/system/proposal-a.html",
        summary: "A header with the lifecycle stepper and decision, then tabs: an overview dashboard of tiles, grouped Controls with a detail drawer, Requirements, Risks, Providers.",
      },
      {
        id: "system-b",
        label: "B",
        title: "Dossier",
        href: "/design/system/proposal-b.html",
        summary: "One scrolling page with a section rail, an inheritance flow and a mosaic of one tile per Control, beside a readiness checklist for approval.",
      },
      {
        id: "system-c",
        label: "C",
        title: "Action register",
        href: "/design/system/proposal-c.html",
        summary: "A prioritized action register with expandable Assessments, compact System context and read-only readiness, alongside Controls, Framework totals, Risks and Providers.",
      },
    ],
  },
  {
    id: "controls",
    name: "Control Library",
    added: "2026-10-17",
    question: "How should someone browse and work in a library of 300+ Controls?",
    proposals: [
      {
        id: "controls-a",
        label: "A",
        title: "Workbench",
        href: "/design/controls/proposal-a.html",
        summary: "Saved views, a facet rail with live counts, a dense grouped grid, bulk actions and a detail drawer.",
      },
      {
        id: "controls-b",
        label: "B",
        title: "Atlas",
        href: "/design/controls/proposal-b.html",
        summary: "Every Control at once as one cell per Control by domain, then a three-pane browser and a Ctrl+K jump palette.",
      },
      {
        id: "controls-c",
        label: "C",
        title: "Coverage register",
        href: "/design/controls/proposal-c.html",
        summary: "A Framework-first register grouped by mapping relationship, with ownership and scoping filters and expandable mapping-count traces.",
      },
    ],
  },
  {
    id: "systems",
    name: "Systems list",
    added: "2026-10-17",
    question: "How should the app show 100+ Systems?",
    proposals: [
      {
        id: "systems-a",
        label: "A",
        title: "Register table",
        href: "/design/systems/proposal-a.html",
        summary: "A filterable, sortable table with saved views, status tabs, grouping, paging and bulk select.",
      },
      {
        id: "systems-b",
        label: "B",
        title: "Portfolio view",
        href: "/design/systems/proposal-b.html",
        summary: "An onboarding pipeline and needs-attention overview over a grouped list with a preview pane.",
      },
      {
        id: "systems-c",
        label: "C",
        title: "Comparison register",
        href: "/design/systems/proposal-c.html",
        summary: "An expandable System register with search and filters, plus up to three pinned Systems compared side by side across classification and assessment progress.",
      },
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding a System",
    added: "2026-10-16",
    question: "How should a System Owner tell us what their System is, and see which Controls apply?",
    proposals: [
      {
        id: "onboarding-a",
        label: "A",
        title: "Guided interview",
        href: "/design/onboarding/proposal-a.html",
        summary: "One question at a time, with a live register beside it that updates as you answer.",
      },
      {
        id: "onboarding-b",
        label: "B",
        title: "System profile",
        href: "/design/onboarding/proposal-b.html",
        summary: "One page: a profile form in place of the register's filters, a domain map, a change ledger and the register.",
      },
      {
        id: "onboarding-c",
        label: "C",
        title: "Scope comparison",
        href: "/design/onboarding/proposal-c.html",
        summary: "Compare an editable System profile against a saved baseline, inspect scope additions and removals, and read responsibility changes in the Control register.",
      },
    ],
  },
];
