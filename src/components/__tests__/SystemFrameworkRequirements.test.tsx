import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  SystemFrameworkRequirementsView,
  type DerivedRequirementRow,
  type SystemFrameworkRequirements,
} from "../SystemFrameworkRequirements";

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
        { controlId: "c1", code: "CTL-1", title: "Policies", coverage: "FULL", applicable: true, assessmentStatus: "FULFILLED" },
      ],
    }),
    row({
      requirementId: "q2",
      code: "A.5.2",
      status: "PARTIALLY_MET",
      controls: [
        { controlId: "c1", code: "CTL-1", title: "Policies", coverage: "FULL", applicable: true, assessmentStatus: "FULFILLED" },
        { controlId: "c2", code: "CTL-2", title: "Roles", coverage: "PARTIAL", applicable: true, assessmentStatus: "IN_PROGRESS" },
      ],
    }),
    row({
      requirementId: "q3",
      code: "A.8.1",
      section: "A.8 Technological",
      status: "NOT_MET",
      controls: [
        { controlId: "c3", code: "CTL-3", title: "Endpoints", coverage: "FULL", applicable: true, assessmentStatus: "NOT_STARTED" },
      ],
    }),
    row({
      requirementId: "q4",
      code: "6.1",
      section: "6 Planning",
      status: "NOT_APPLICABLE",
      basis: "NO_APPLICABLE_CONTROLS",
      controls: [
        { controlId: "c4", code: "ORG-1", title: "Risk process", coverage: "FULL", applicable: false, assessmentStatus: null },
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

const toggle = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

describe("SystemFrameworkRequirementsView", () => {
  it("says so plainly when no Published Framework is in scope", () => {
    render(<SystemFrameworkRequirementsView frameworks={[]} />);
    expect(screen.getByText("This System has no Published Framework in scope.")).toBeInTheDocument();
  });

  it("shows each Framework's Compliance Percentage (Met ÷ applicable) in its header, and the Organizational note once (#90)", () => {
    render(<SystemFrameworkRequirementsView frameworks={[iso, empty]} />);
    // iso: Met 1 of 3 applicable (Partially Met counts as not Met; 2 Not Applicable are left out): 33.3%.
    const figure = within(screen.getByLabelText("Compliance for ISO/IEC 27001:2022"));
    expect(figure.getByText("33.3%")).toBeInTheDocument();
    expect(figure.getByText(/1 of 3 applicable Requirements met/)).toBeInTheDocument();
    // A Framework with no Requirements has no figure, only its "no Requirements yet" line.
    expect(screen.queryByLabelText("Compliance for GDPR:1")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Organizational Requirements aren't counted yet/)).toHaveLength(1);
  });

  it("shows an em dash when no Requirement is applicable", () => {
    const allNotApplicable: SystemFrameworkRequirements = {
      ...iso,
      counts: { MET: 0, PARTIALLY_MET: 0, NOT_MET: 0, NOT_APPLICABLE: 2, total: 2, applicable: 0 },
      rows: [iso.rows[3], iso.rows[4]],
    };
    render(<SystemFrameworkRequirementsView frameworks={[allNotApplicable]} />);
    const figure = within(screen.getByLabelText("Compliance for ISO/IEC 27001:2022"));
    expect(figure.getByText("—")).toBeInTheDocument();
    expect(figure.getByText(/0 of 0 applicable Requirements met/)).toBeInTheDocument();
  });

  it("is collapsed by default, with the per-status counts in the header", () => {
    render(<SystemFrameworkRequirementsView frameworks={[iso]} />);
    const header = toggle("ISO/IEC 27001:2022");
    expect(header).toHaveAttribute("aria-expanded", "false");
    const counts = within(screen.getByLabelText("Status counts for ISO/IEC 27001:2022"));
    expect(counts.getByText("Met 1")).toBeInTheDocument();
    expect(counts.getByText("Partially Met 1")).toBeInTheDocument();
    expect(counts.getByText("Not Met 1")).toBeInTheDocument();
    expect(counts.getByText("Not Applicable 2")).toBeInTheDocument();
    expect(counts.getByText("of 5")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Requirement A.5.1" })).not.toBeInTheDocument();
  });

  it("expands and collapses, listing Requirements by section with their applicable Controls and Assessment status", async () => {
    const user = userEvent.setup();
    render(<SystemFrameworkRequirementsView frameworks={[iso]} />);

    await user.click(toggle("ISO/IEC 27001:2022"));
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
    render(<SystemFrameworkRequirementsView frameworks={[iso]} />);
    await user.click(toggle("ISO/IEC 27001:2022"));
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
    render(<SystemFrameworkRequirementsView frameworks={[onlyMet]} />);
    await user.click(toggle("ISO/IEC 27001:2022"));
    await user.selectOptions(screen.getByLabelText("Status filter for ISO/IEC 27001:2022"), "NOT_MET");
    expect(screen.getByText("No Requirements match this filter.")).toBeInTheDocument();
  });

  it("a Framework with no Requirements says so in its header, with nothing to expand into", async () => {
    const user = userEvent.setup();
    render(<SystemFrameworkRequirementsView frameworks={[empty]} />);
    expect(screen.getByText("This Framework has no Requirements yet.")).toBeInTheDocument();
    await user.click(toggle("GDPR:1"));
    expect(screen.queryByLabelText("Status filter for GDPR:1")).not.toBeInTheDocument();
  });

  it("keeps each Framework's collapse state and filter separate", async () => {
    const user = userEvent.setup();
    const other: SystemFrameworkRequirements = {
      framework: { id: "f3", name: "NIS2", version: "2022", strictComplianceRequired: true, isBase: false },
      counts: { MET: 0, PARTIALLY_MET: 0, NOT_MET: 1, NOT_APPLICABLE: 0, total: 1, applicable: 1 },
      rows: [row({ requirementId: "n1", code: "Art. 1", section: "Art", status: "NOT_MET" })],
    };
    render(<SystemFrameworkRequirementsView frameworks={[iso, other]} />);

    await user.click(toggle("NIS2:2022"));
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
    render(<SystemFrameworkRequirementsView frameworks={[framework]} />);
    await user.click(toggle("ISO/IEC 27001:2022"));
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.1" })).getByText(/counts as Not Met/)).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.2" })).getByText(/accepted gap/)).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Requirement Z.3" })).getByText(/only Partial coverage/)).toBeInTheDocument();
  });
});
