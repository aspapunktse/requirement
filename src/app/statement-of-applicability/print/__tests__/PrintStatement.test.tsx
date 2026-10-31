import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";
import type { AuditCover } from "@/lib/soa-audit-export";
import { PrintStatement } from "../PrintStatement";

const counts = { NOT_STARTED: 0, IN_PROGRESS: 1, FULFILLED: 2, NOT_APPLICABLE: 0, WAIVED: 0 };
const row = (over: Partial<StatementOfApplicabilityRow>): StatementOfApplicabilityRow => ({
  controlId: "c",
  code: "C-1",
  title: "Test Control",
  applicability: "PER_SYSTEM",
  included: true,
  appliesToOrganization: false,
  appliesToSystemCount: 3,
  inclusionJustification: "ISO/IEC 27001:2022 A.5.1",
  exclusionJustification: null,
  justificationMissing: false,
  organizationStatus: null,
  systemRollup: { total: 3, counts },
  ...over,
});
const rows = [
  row({ controlId: "1", code: "A-1", title: "Policy" }),
  row({ controlId: "2", code: "A-2", title: "Organizational thing", applicability: "BOTH", organizationStatus: "FULFILLED" }),
  row({ controlId: "3", code: "A-3", title: "Removed", included: false, inclusionJustification: "", exclusionJustification: "Not used here", systemRollup: null }),
  row({ controlId: "4", code: "A-4", title: "Unexplained", included: false, inclusionJustification: "", justificationMissing: true, systemRollup: null }),
];
const cover: AuditCover = {
  organizationName: "Acme AB",
  generatedAt: "2026-10-31T14:05:00.000Z",
  generatedByName: "Test Manager",
  frameworks: ["ISO/IEC 27001:2022", "NIS2:2022"],
  total: 4,
  included: 2,
  excluded: 2,
  excludedWithoutJustification: 1,
};

const print = vi.fn();
vi.stubGlobal("print", print);
afterEach(() => {
  cleanup();
  print.mockClear();
});

describe("PrintStatement (#273)", () => {
  it("shows the cover: Organization, who and when, Frameworks, counts and the live-data line", () => {
    render(<PrintStatement cover={cover} rows={rows} />);
    expect(screen.getByRole("heading", { level: 1, name: "Statement of Applicability" })).toBeInTheDocument();
    expect(screen.getByText("Acme AB")).toBeInTheDocument();
    expect(screen.getAllByText(/2026-10-31 14:05 UTC/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/by Test Manager/)).toBeInTheDocument();
    expect(screen.getByText("ISO/IEC 27001:2022; NIS2:2022")).toBeInTheDocument();
    expect(screen.getByText(/4 in total: 2 included, 2 excluded, of which 1 without a justification/)).toBeInTheDocument();
    expect(screen.getByText(/Generated from live data on 2026-10-31 14:05 UTC/)).toBeInTheDocument();
  });

  it("leaves the Organization line out while the name is unset", () => {
    render(<PrintStatement cover={{ ...cover, organizationName: null }} rows={rows} />);
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
  });

  it("lists every Control with inclusion, justification and status, and never a System name", () => {
    render(<PrintStatement cover={cover} rows={rows} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Control", "Included", "Justification", "Implementation status"]);
    const body = within(table).getAllByRole("row").slice(1);
    expect(body).toHaveLength(4);
    expect(body[0]).toHaveTextContent("A-1 Policy");
    expect(body[0]).toHaveTextContent("Included");
    expect(body[0]).toHaveTextContent("ISO/IEC 27001:2022 A.5.1");
    expect(body[0]).toHaveTextContent("3 Systems: 1 In Progress, 2 Fulfilled");
    expect(body[1]).toHaveTextContent("Organization: Fulfilled");
    expect(body[2]).toHaveTextContent("Excluded");
    expect(body[2]).toHaveTextContent("Not used here");
    expect(body[3]).toHaveTextContent("Justification missing");
  });

  it("handles an empty Statement and a Control that applies to no System yet", () => {
    const { rerender } = render(<PrintStatement cover={{ ...cover, frameworks: [] }} rows={[]} />);
    expect(screen.getByText("The Control Library has no Controls.")).toBeInTheDocument();
    expect(screen.getByText("None published with mapped Controls")).toBeInTheDocument();
    rerender(<PrintStatement cover={cover} rows={[row({ systemRollup: { total: 0, counts: { ...counts, FULFILLED: 0, IN_PROGRESS: 0 } } })]} />);
    expect(screen.getByText("Systems: none yet")).toBeInTheDocument();
  });

  it("opens the print dialog once on load and has an on-screen button for it", () => {
    render(<PrintStatement cover={cover} rows={rows} />);
    expect(print).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Print / Save as PDF" }).click();
    expect(print).toHaveBeenCalledTimes(2);
  });
});
