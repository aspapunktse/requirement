import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SystemRequirements } from "../SystemRequirements";
import type { DerivedRequirementRow, SystemFrameworkRequirements } from "../FrameworkRequirementsDetail";
import type { FrameworkSummary } from "../system-page-types";
import { resolveEffectiveStatus, resolveImplementedByOrganization, type ProviderSource } from "@/lib/effective-status";

/** A System-specific Control status, as the server sends it for a Control with no inheritance source. */
const own = (status: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED") => resolveEffectiveStatus({ status, personSet: true }, []);

const row = (over: Partial<DerivedRequirementRow>): DerivedRequirementRow => ({
  requirementId: "q",
  code: "1",
  section: "A.5 Organizational",
  title: "Title",
  status: "NOT_MET",
  basis: "CONTROLS",
  gapAccepted: false,
  controls: [],
  ...over,
});

const iso: SystemFrameworkRequirements = {
  framework: { id: "f1", name: "ISO/IEC 27001", version: "2022", strictComplianceRequired: false, isBase: true },
  counts: { MET: 1, PARTIALLY_MET: 1, NOT_MET: 1, NOT_APPLICABLE: 2, total: 5, applicable: 3 },
  rows: [
    row({
      requirementId: "q1",
      code: "A.5.1",
      status: "MET",
      controls: [
        { controlId: "c1", code: "CTL-1", title: "Policies", coverage: "FULL", applicable: true, assessmentStatus: "FULFILLED", effective: own("FULFILLED") },
      ],
    }),
    row({
      requirementId: "q2",
      code: "A.5.2",
      status: "PARTIALLY_MET",
      controls: [
        { controlId: "c1", code: "CTL-1", title: "Policies", coverage: "FULL", applicable: true, assessmentStatus: "FULFILLED", effective: own("FULFILLED") },
        { controlId: "c2", code: "CTL-2", title: "Roles", coverage: "PARTIAL", applicable: true, assessmentStatus: "IN_PROGRESS", effective: own("IN_PROGRESS") },
      ],
    }),
    row({
      requirementId: "q3",
      code: "A.8.1",
      section: "A.8 Technological",
      status: "NOT_MET",
      controls: [
        { controlId: "c3", code: "CTL-3", title: "Endpoints", coverage: "FULL", applicable: true, assessmentStatus: "NOT_STARTED", effective: own("NOT_STARTED") },
      ],
    }),
    row({
      requirementId: "q4",
      code: "6.1",
      section: "6 Planning",
      status: "NOT_APPLICABLE",
      basis: "NO_APPLICABLE_CONTROLS",
      controls: [
        { controlId: "c4", code: "ORG-1", title: "Risk process", coverage: "FULL", applicable: false, assessmentStatus: null, effective: null },
      ],
    }),
    row({ requirementId: "q5", code: "6.2", section: "6 Planning", status: "NOT_APPLICABLE", basis: "NO_APPLICABLE_CONTROLS" }),
  ],
};

const empty: SystemFrameworkRequirements = {
  framework: { id: "f2", name: "GDPR", version: "1", strictComplianceRequired: false, isBase: false },
  counts: { MET: 0, PARTIALLY_MET: 0, NOT_MET: 0, NOT_APPLICABLE: 0, total: 0, applicable: 0 },
  rows: [],
};

const labelOf = (entry: SystemFrameworkRequirements) => `${entry.framework.name}:${entry.framework.version}`;

/** The card's figures, as the server loader derives them from the same counts (system-page-data.ts). */
const summaryOf = (entry: SystemFrameworkRequirements): FrameworkSummary => ({
  id: entry.framework.id,
  label: labelOf(entry),
  isBase: entry.framework.isBase,
  met: entry.counts.MET,
  partial: entry.counts.PARTIALLY_MET,
  notMet: entry.counts.NOT_MET,
  notApplicable: entry.counts.NOT_APPLICABLE,
  applicable: entry.counts.applicable,
});

const renderView = (entries: SystemFrameworkRequirements[]) => render(<SystemRequirements frameworks={entries.map(summaryOf)} entries={entries} />);

const card = (label: string) => within(screen.getByRole("region", { name: `${label} Requirements` }));
/** The card's show/hide button. */
const toggle = (label: string) => card(label).getByRole("button", { name: /Requirements/ });
/** Opens a card; it starts on the Requirements not met, so these tests widen the filter to all of them first. */
async function openFramework(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(toggle(label));
  await user.selectOptions(screen.getByLabelText(`Status filter for ${label}`), "ALL");
}

describe("SystemRequirements", () => {
  it("says so plainly when no Published Framework is in scope", () => {
    renderView([]);
    expect(screen.getByText("This System has no Published Framework in scope.")).toBeInTheDocument();
  });

  it("shows each Framework's Compliance Percentage (Met ÷ applicable) and its figures on its card (#90, #122, #245)", () => {
    renderView([iso, empty]);
    // iso: Met 1 of 3 applicable (Partially Met counts as not Met; 2 Not Applicable are left out): 33.3%.
    const figures = card("ISO/IEC 27001:2022");
    expect(figures.getByRole("img", { name: /1 of 3 applicable Requirements met/ })).toBeInTheDocument();
    expect(figures.getByText("33.3%")).toBeInTheDocument();
    expect(figures.getByText("1 of 3 applicable Requirements met")).toBeInTheDocument();
    // A Framework with no Requirements has no figure, only its "no Requirements yet" line.
    expect(card("GDPR:1").getByText("This Framework has no Requirements yet.")).toBeInTheDocument();
    expect(card("GDPR:1").queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/aren't counted yet/)).not.toBeInTheDocument();
  });

  it("marks the base Framework Base and a Framework that requires strict compliance Strict, and no other", () => {
    const strict: SystemFrameworkRequirements = { ...iso, framework: { ...iso.framework, id: "f4", name: "NIS2", isBase: false, strictComplianceRequired: true } };
    renderView([iso, strict, empty]);
    expect(card("ISO/IEC 27001:2022").getByText("Base")).toBeInTheDocument();
    expect(card("ISO/IEC 27001:2022").queryByText("Strict")).not.toBeInTheDocument();
    expect(card("NIS2:2022").getByText("Strict")).toBeInTheDocument();
    expect(card("NIS2:2022").queryByText("Base")).not.toBeInTheDocument();
    expect(card("GDPR:1").queryByText("Base")).not.toBeInTheDocument();
    expect(card("GDPR:1").queryByText("Strict")).not.toBeInTheDocument();
  });

  it("shows an em dash when no Requirement is applicable", () => {
    const allNotApplicable: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 0, PARTIALLY_MET: 0, NOT_MET: 0, NOT_APPLICABLE: 2, total: 2, applicable: 0 },
      rows: [iso.rows[3], iso.rows[4]],
    };
    renderView([allNotApplicable]);
    const figures = card("ISO/IEC 27001:2022");
    expect(figures.getByText("—")).toBeInTheDocument();
    expect(figures.getByText(/0 of 0 applicable Requirements met/)).toBeInTheDocument();
  });

  it("is collapsed by default, with the count of each status on the card", () => {
    renderView([iso]);
    expect(toggle("ISO/IEC 27001:2022")).toHaveAttribute("aria-expanded", "false");
    expect(toggle("ISO/IEC 27001:2022")).toHaveTextContent("Show Requirements not met");
    const counts = within(screen.getByLabelText("Status counts for ISO/IEC 27001:2022"));
    expect(counts.getByText(/^Met/)).toHaveTextContent("Met 1");
    expect(counts.getByText(/^Partially met/)).toHaveTextContent("Partially met 1");
    expect(counts.getByText(/^Not met/)).toHaveTextContent("Not met 1");
    expect(counts.getByText(/^Not applicable/)).toHaveTextContent("Not applicable 2");
    expect(screen.queryByRole("listitem", { name: "Requirement A.5.1" })).not.toBeInTheDocument();
  });

  it("opens on the Requirements not met", async () => {
    const user = userEvent.setup();
    renderView([iso]);
    await user.click(toggle("ISO/IEC 27001:2022"));
    expect(screen.getByLabelText("Status filter for ISO/IEC 27001:2022")).toHaveValue("NOT_MET");
    expect(screen.getAllByRole("listitem", { name: /^Requirement / })).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: "Requirement A.8.1" })).toBeInTheDocument();
  });

  it("expands and collapses, listing Requirements by section with their applicable Controls and Assessment status", async () => {
    const user = userEvent.setup();
    renderView([iso]);

    await openFramework(user, "ISO/IEC 27001:2022");
    expect(toggle("ISO/IEC 27001:2022")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Section A.8 Technological" })).toBeInTheDocument();

    const a52 = within(screen.getByRole("listitem", { name: "Requirement A.5.2" }));
    expect(a52.getByText("Partially Met")).toBeInTheDocument();
    const controls = within(a52.getByRole("list", { name: "Applicable Controls for A.5.2" }));
    expect(controls.getAllByRole("listitem")).toHaveLength(2);
    expect(controls.getByText("Fulfilled")).toBeInTheDocument();
    expect(controls.getByText("In Progress")).toBeInTheDocument();
    expect(controls.getByText(/Partial coverage/)).toBeInTheDocument();

    // A Not Applicable Requirement shows which mapped Controls didn't apply.
    const clause = within(screen.getByRole("listitem", { name: "Requirement 6.1" }));
    expect(clause.getByText("Not Applicable")).toBeInTheDocument();
    expect(clause.getByText(/None of the mapped Controls apply to this System/)).toHaveTextContent("ORG-1");

    await user.click(toggle("ISO/IEC 27001:2022"));
    expect(toggle("ISO/IEC 27001:2022")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listitem", { name: "Requirement A.5.1" })).not.toBeInTheDocument();
  });

  it("filters by derived status", async () => {
    const user = userEvent.setup();
    renderView([iso]);
    await openFramework(user, "ISO/IEC 27001:2022");
    const filter = screen.getByLabelText("Status filter for ISO/IEC 27001:2022");

    await user.selectOptions(filter, "NOT_APPLICABLE");
    expect(screen.getAllByRole("listitem", { name: /^Requirement / })).toHaveLength(2);
    expect(screen.getByRole("listitem", { name: "Requirement 6.1" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Requirement A.5.1" })).not.toBeInTheDocument();

    await user.selectOptions(filter, "MET");
    expect(screen.getAllByRole("listitem", { name: /^Requirement / })).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: "Requirement A.5.1" })).toBeInTheDocument();

    await user.selectOptions(filter, "ALL");
    expect(screen.getAllByRole("listitem", { name: /^Requirement / })).toHaveLength(5);
  });

  it("says so when a filter matches nothing", async () => {
    const user = userEvent.setup();
    const onlyMet: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 1, PARTIALLY_MET: 0, NOT_MET: 0, NOT_APPLICABLE: 0, total: 1, applicable: 1 },
      rows: [iso.rows[0]],
    };
    renderView([onlyMet]);
    await openFramework(user, "ISO/IEC 27001:2022");
    await user.selectOptions(screen.getByLabelText("Status filter for ISO/IEC 27001:2022"), "NOT_MET");
    expect(screen.getByText("No Requirements match this filter.")).toBeInTheDocument();
  });

  it("a Framework with no Requirements says so on its card, with nothing to expand into", () => {
    renderView([empty]);
    expect(screen.getByText("This Framework has no Requirements yet.")).toBeInTheDocument();
    expect(card("GDPR:1").queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status filter for GDPR:1")).not.toBeInTheDocument();
  });

  it("keeps each Framework's collapse state and filter separate", async () => {
    const user = userEvent.setup();
    const other: SystemFrameworkRequirements = {
      framework: { id: "f3", name: "NIS2", version: "2022", strictComplianceRequired: true, isBase: false },
      counts: { MET: 0, PARTIALLY_MET: 0, NOT_MET: 1, NOT_APPLICABLE: 0, total: 1, applicable: 1 },
      rows: [row({ requirementId: "n1", code: "Art. 1", section: "Art", status: "NOT_MET" })],
    };
    renderView([iso, other]);

    await openFramework(user, "NIS2:2022");
    expect(toggle("NIS2:2022")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("ISO/IEC 27001:2022")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Strict Framework: Waived and Not Applicable/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Requirement Art. 1" })).toBeInTheDocument();
  });

  it("explains the zero-mapping default and accepted-gap cases", async () => {
    const user = userEvent.setup();
    const framework: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 0, PARTIALLY_MET: 2, NOT_MET: 1, NOT_APPLICABLE: 0, total: 3, applicable: 3 },
      rows: [
        row({ requirementId: "z1", code: "Z.1", status: "NOT_MET", basis: "NO_MAPPED_CONTROLS" }),
        row({ requirementId: "z2", code: "Z.2", status: "PARTIALLY_MET", basis: "ACCEPTED_GAP" }),
        row({ requirementId: "z3", code: "Z.3", status: "PARTIALLY_MET", basis: "PARTIAL_COVERAGE" }),
      ],
    };
    renderView([framework]);
    await openFramework(user, "ISO/IEC 27001:2022");
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.1" })).getByText(/counts as Not Met/)).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.2" })).getByText(/accepted gap/)).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.3" })).getByText(/only Partial coverage/)).toBeInTheDocument();
  });

  describe("Organizational Controls behind a Requirement (#122)", () => {
    const orgControl = (status: "NOT_STARTED" | "FULFILLED" | "WAIVED") => ({
      controlId: `o-${status}`,
      code: `ORG-${status}`,
      title: `Policy ${status}`,
      coverage: "FULL" as const,
      applicable: true,
      assessmentStatus: null,
      effective: resolveImplementedByOrganization(status),
    });
    const framework: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 1, PARTIALLY_MET: 0, NOT_MET: 1, NOT_APPLICABLE: 0, total: 2, applicable: 2 },
      rows: [
        row({ requirementId: "o1", code: "5.2", section: "5 Leadership", status: "MET", controls: [orgControl("FULFILLED")] }),
        row({
          requirementId: "o2",
          code: "5.3",
          section: "5 Leadership",
          status: "NOT_MET",
          controls: [
            orgControl("NOT_STARTED"),
            { controlId: "p1", code: "CTL-9", title: "Scoped elsewhere", coverage: "PARTIAL", applicable: false, assessmentStatus: null, effective: null },
          ],
        }),
      ],
    };

    it("lists them with their status and 'Implemented by the Organization', and not as a Control that does not apply", async () => {
      const user = userEvent.setup();
      renderView([framework]);
      await openFramework(user, "ISO/IEC 27001:2022");

      const met = within(screen.getByRole("listitem", { name: "Requirement 5.2" }));
      const metControls = within(met.getByRole("list", { name: "Applicable Controls for 5.2" }));
      expect(metControls.getByText("ORG-FULFILLED")).toBeInTheDocument();
      expect(metControls.getByText("Fulfilled")).toBeInTheDocument();
      expect(metControls.getByText("Implemented by the Organization")).toBeInTheDocument();
      expect(met.queryByText(/Mapped but not applicable|None of the mapped Controls apply/)).not.toBeInTheDocument();

      const notMet = within(screen.getByRole("listitem", { name: "Requirement 5.3" }));
      const controls = within(notMet.getByRole("list", { name: "Applicable Controls for 5.3" }));
      expect(controls.getByText("Not Started")).toBeInTheDocument();
      expect(controls.getByText("Implemented by the Organization")).toBeInTheDocument();
      // Only the per-System Control that really does not apply stays in the muted line.
      expect(notMet.getByText(/Mapped but not applicable to this System/)).toHaveTextContent("CTL-9");
      expect(notMet.getByText(/Mapped but not applicable to this System/)).not.toHaveTextContent("ORG-NOT_STARTED");
    });

    it("shows a Waived Organization status as Waived", async () => {
      const user = userEvent.setup();
      const waived: SystemFrameworkRequirements = {
        ...framework,
        rows: [row({ requirementId: "o3", code: "5.4", section: "5 Leadership", status: "MET", controls: [orgControl("WAIVED")] })],
      };
      renderView([waived]);
      await openFramework(user, "ISO/IEC 27001:2022");
      const controls = within(screen.getByRole("list", { name: "Applicable Controls for 5.4" }));
      expect(controls.getByText("Waived")).toBeInTheDocument();
      expect(controls.getByText("Implemented by the Organization")).toBeInTheDocument();
    });
  });

  describe("the source of each applicable Control (#121)", () => {
    const org = (status: "NOT_STARTED" | "FULFILLED" | "WAIVED") => ({ kind: "ORGANIZATION", type: "FULL", status }) as const;
    const withSources = (
      ownStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED",
      personSet: boolean,
      sources: ReturnType<typeof org>[],
    ) => ({
      assessmentStatus: ownStatus,
      effective: resolveEffectiveStatus({ status: ownStatus, personSet }, sources),
    });
    const framework: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 1, PARTIALLY_MET: 1, NOT_MET: 0, NOT_APPLICABLE: 0, total: 2, applicable: 2 },
      rows: [
        row({
          requirementId: "s1",
          code: "A.5.15",
          status: "MET",
          controls: [
            { controlId: "i1", code: "A.5.15", title: "Access control", coverage: "FULL", applicable: true, ...withSources("NOT_STARTED", false, [org("FULFILLED")]) },
          ],
        }),
        row({
          requirementId: "s2",
          code: "A.5.16",
          status: "PARTIALLY_MET",
          controls: [
            { controlId: "i2", code: "A.5.16", title: "Identity management", coverage: "FULL", applicable: true, ...withSources("NOT_STARTED", false, [org("WAIVED")]) },
            { controlId: "i3", code: "A.5.17", title: "Authentication", coverage: "FULL", applicable: true, ...withSources("IN_PROGRESS", true, [org("FULFILLED")]) },
            { controlId: "i4", code: "A.8.5", title: "Secure authentication", coverage: "FULL", applicable: true, ...withSources("FULFILLED", true, []) },
          ],
        }),
      ],
    };

    it("shows the effective status and Inherited from Organization with the Organization's own status", async () => {
      const user = userEvent.setup();
      renderView([framework]);
      await openFramework(user, "ISO/IEC 27001:2022");

      const inherited = within(
        within(screen.getByRole("listitem", { name: "Requirement A.5.15" })).getByRole("list", { name: "Applicable Controls for A.5.15" }),
      );
      expect(inherited.getByText("Fulfilled")).toBeInTheDocument();
      expect(inherited.getByText("Inherited from Organization · Organization: Fulfilled")).toBeInTheDocument();
    });

    it("shows System-specific otherwise, with the Organization's status when it gives no credit, and the override line", async () => {
      const user = userEvent.setup();
      renderView([framework]);
      await openFramework(user, "ISO/IEC 27001:2022");

      const controls = within(
        within(screen.getByRole("listitem", { name: "Requirement A.5.16" })).getByRole("list", { name: "Applicable Controls for A.5.16" }),
      );
      expect(controls.getByText("System-specific · Organization: Waived (gives no credit)")).toBeInTheDocument();
      expect(
        controls.getByText(
          "System-specific · Organization: Fulfilled This System's own Assessment (In Progress) overrides the Organization's Fulfilled status.",
        ),
      ).toBeInTheDocument();
      expect(controls.getByText("System-specific")).toBeInTheDocument();
    });
  });

  describe("Provider sources (#124)", () => {
    const provider = (overrides: Partial<ProviderSource> = {}): ProviderSource => ({
      kind: "PROVIDER",
      type: "FULL",
      status: "FULFILLED",
      provider: { id: "p1", name: "Landing Zone" },
      providerOnboarded: true,
      appliesToProvider: true,
      customerResponsibility: null,
      ...overrides,
    });
    const controlOf = (id: string, code: string, sources: ProviderSource[], own: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED" = "NOT_STARTED", personSet = false) => ({
      controlId: id,
      code,
      title: `Title ${code}`,
      coverage: "FULL" as const,
      applicable: true,
      assessmentStatus: own,
      effective: resolveEffectiveStatus({ status: own, personSet }, sources),
    });
    const framework: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 1, PARTIALLY_MET: 0, NOT_MET: 3, NOT_APPLICABLE: 0, total: 4, applicable: 4 },
      rows: [
        row({ requirementId: "r1", code: "P.1", status: "MET", controls: [controlOf("k1", "A.8.24", [provider()])] }),
        row({ requirementId: "r2", code: "P.2", controls: [controlOf("k2", "A.8.25", [provider({ providerOnboarded: false })])] }),
        row({
          requirementId: "r3",
          code: "P.3",
          controls: [controlOf("k3", "A.8.26", [provider({ type: "SHARED", customerResponsibility: "Keys are yours" })])],
        }),
        row({
          requirementId: "r4",
          code: "P.4",
          controls: [controlOf("k4", "A.8.27", [provider()], "IN_PROGRESS", true)],
        }),
      ],
    };
    const listFor = (code: string) => within(screen.getByRole("list", { name: `Applicable Controls for ${code}` }));

    it("shows Inherited from Provider X: Full with the Provider's status, and the pending, Shared and overridden cases", async () => {
      const user = userEvent.setup();
      renderView([framework]);
      await openFramework(user, "ISO/IEC 27001:2022");

      const credited = listFor("P.1");
      expect(credited.getByText("Fulfilled")).toBeInTheDocument();
      expect(credited.getByText('Inherited from Provider Landing Zone: Full · Provider "Landing Zone" (Full): Fulfilled')).toBeInTheDocument();

      const pending = listFor("P.2");
      expect(pending.getByText("Not Started")).toBeInTheDocument();
      expect(pending.getByText('System-specific · Provider "Landing Zone" (Full): Fulfilled (pending: Provider not Onboarded)')).toBeInTheDocument();

      const shared = listFor("P.3");
      expect(
        shared.getByText(
          `System-specific · Provider "Landing Zone" (Shared): Fulfilled (this System's own half is not Fulfilled; customer responsibility: Keys are yours)`,
        ),
      ).toBeInTheDocument();

      expect(
        listFor("P.4").getByText(
          `System-specific · Provider "Landing Zone" (Full): Fulfilled This System's own Assessment (In Progress) overrides Provider "Landing Zone"'s Fulfilled status.`,
        ),
      ).toBeInTheDocument();
    });

    it("shows a Control Fulfilled through a Shared Offering, and one held at In Progress while the Provider's half is missing (#125)", async () => {
      const user = userEvent.setup();
      const sharedFramework: SystemFrameworkRequirements = {
        ...iso,
        counts: { MET: 1, PARTIALLY_MET: 0, NOT_MET: 1, NOT_APPLICABLE: 0, total: 2, applicable: 2 },
        rows: [
          row({
            requirementId: "r5",
            code: "P.5",
            status: "MET",
            controls: [controlOf("k5", "A.8.28", [provider({ type: "SHARED", customerResponsibility: "Keys are yours" })], "FULFILLED", true)],
          }),
          row({
            requirementId: "r6",
            code: "P.6",
            controls: [controlOf("k6", "A.8.29", [provider({ type: "SHARED", status: "IN_PROGRESS", customerResponsibility: "Keys are yours" })], "FULFILLED", true)],
          }),
        ],
      };
      renderView([sharedFramework]);
      await openFramework(user, "ISO/IEC 27001:2022");

      const through = listFor("P.5");
      expect(through.getByText("Fulfilled")).toBeInTheDocument();
      expect(
        through.getByText('Inherited from Provider Landing Zone: Shared · Provider "Landing Zone" (Shared): Fulfilled (customer responsibility: Keys are yours)'),
      ).toBeInTheDocument();

      const held = listFor("P.6");
      expect(held.getByText("In Progress")).toBeInTheDocument();
      expect(
        held.getByText(
          /System-specific · Provider "Landing Zone" \(Shared\): In Progress \(the Provider's half is missing: the Provider has not Fulfilled it; customer responsibility: Keys are yours\) This System's own half is Fulfilled, but it is waiting for Provider "Landing Zone" to provide its half, so the Control is In Progress\./,
        ),
      ).toBeInTheDocument();
    });
  });
});
