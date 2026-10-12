import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";
import { StatementOfApplicability } from "../StatementOfApplicability";

const ZERO = { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0 };

const base = {
  appliesToOrganization: false,
  appliesToSystemCount: 0,
  inclusionJustification: "",
  exclusionJustification: null,
  justificationMissing: false,
  organizationStatus: null,
  systemRollup: null,
} satisfies Partial<StatementOfApplicabilityRow>;

const rows: StatementOfApplicabilityRow[] = [
  {
    ...base,
    controlId: "c1",
    code: "A.5.1",
    title: "Policies for information security",
    applicability: "ORGANIZATIONAL",
    included: true,
    appliesToOrganization: true,
    inclusionJustification: "ISO/IEC 27001:2022 A.5.1",
    organizationStatus: "IN_PROGRESS",
  },
  {
    ...base,
    controlId: "c2",
    code: "A.8.24",
    title: "Use of cryptography",
    applicability: "BOTH",
    included: true,
    appliesToOrganization: true,
    appliesToSystemCount: 3,
    inclusionJustification: "ISO/IEC 27001:2022 A.8.24; Cybersäkerhetslagen:2025 3 kap. 2 §",
    organizationStatus: "FULFILLED",
    systemRollup: { total: 3, counts: { ...ZERO, FULFILLED: 2, NOT_STARTED: 1 } },
  },
  {
    ...base,
    controlId: "c3",
    code: "A.8.30",
    title: "Outsourced development",
    applicability: "PER_SYSTEM",
    included: false,
    justificationMissing: true,
  },
];

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;

describe("StatementOfApplicability", () => {
  it("lists every Control with its generated justification and implementation status", () => {
    render(<StatementOfApplicability rows={rows} />);

    expect(within(rowOf("A.5.1")).getByText("ISO/IEC 27001:2022 A.5.1")).toBeInTheDocument();
    expect(within(rowOf("A.5.1")).getByText("In Progress")).toBeInTheDocument();

    const both = rowOf("A.8.24");
    expect(within(both).getByText(/Cybersäkerhetslagen:2025 3 kap\. 2 §/)).toBeInTheDocument();
    expect(within(both).getByText("Fulfilled")).toBeInTheDocument();
    expect(within(both).getByText("1 Not Started, 2 Fulfilled")).toBeInTheDocument();
  });

  it("flags an excluded Control as justification missing, and no included one", () => {
    render(<StatementOfApplicability rows={rows} />);

    expect(within(rowOf("A.8.30")).getByText("Excluded")).toBeInTheDocument();
    expect(within(rowOf("A.8.30")).getByText("Justification missing")).toBeInTheDocument();
    expect(screen.getAllByText("Justification missing")).toHaveLength(1);
  });

  it("shows the counts and filters to included or excluded Controls", async () => {
    const user = userEvent.setup();
    render(<StatementOfApplicability rows={rows} />);

    expect(screen.getByRole("button", { name: "All (3)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Included (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluded (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Excluded (1)" }));
    expect(screen.queryByText("A.5.1")).not.toBeInTheDocument();
    expect(screen.getByText("A.8.30")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Included (2)" }));
    expect(screen.getByText("A.5.1")).toBeInTheDocument();
    expect(screen.getByText("A.8.24")).toBeInTheDocument();
    expect(screen.queryByText("A.8.30")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All (3)" }));
    expect(screen.getByText("A.8.30")).toBeInTheDocument();
  });
});
