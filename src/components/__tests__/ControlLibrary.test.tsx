import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ControlLibraryRow } from "@/lib/control-library";
import { ControlLibrary } from "../ControlLibrary";

const base: ControlLibraryRow = {
  id: "x",
  code: "X",
  title: "X",
  description: "d",
  category: "Security",
  mandatory: true,
  applicability: "ORGANIZATIONAL",
  question: null,
  intent: null,
  examples: [],
  deploymentFacets: [],
  minConfidentialityImpactLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
  ownerName: null,
  origin: null,
  mappings: [],
};

const rows: ControlLibraryRow[] = [
  { ...base, id: "c1", code: "A.5.1", title: "Policies for information security", description: "Write policies." },
  {
    ...base,
    id: "c2",
    code: "A.8.24",
    title: "Use of cryptography",
    description: "Use it well.",
    applicability: "BOTH",
    question: "Do you encrypt data?",
    intent: "Protect data",
    examples: ["TLS everywhere"],
    deploymentFacets: ["Cloud", "SaaS"],
    minConfidentialityImpactLevel: "HIGH",
    ownerName: "Olivia Owner",
    mappings: [
      { id: "m1", coverage: "FULL", requirementCode: "A.8.24", requirementTitle: "Cryptography", framework: { id: "f1", label: "ISO/IEC 27001:2022" }, draft: false },
      { id: "m2", coverage: "PARTIAL", requirementCode: "9 §", requirementTitle: "Draft thing", framework: { id: "f2", label: "Next Law:1" }, draft: true },
    ],
  },
  {
    ...base,
    id: "c3",
    code: "SUP-1",
    title: "Notify the CSIRT",
    applicability: "PER_SYSTEM",
    mandatory: false,
    origin: { id: "f2", label: "Next Law:1", draft: true },
  },
];

describe("ControlLibrary (#169)", () => {
  it("lists every Control with a compact row and counts them", () => {
    render(<ControlLibrary rows={rows} />);
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("details"))).toHaveLength(3);
    expect(screen.getByText("Showing 3 of 3 Controls")).toBeInTheDocument();
  });

  it("has the detail in an expandable section, closed until opened", async () => {
    const user = userEvent.setup();
    const { container } = render(<ControlLibrary rows={rows} />);
    const item = screen.getByText("Use of cryptography").closest("details") as HTMLDetailsElement;
    expect(item.open).toBe(false);
    await user.click(screen.getByText("Use of cryptography"));
    expect(item.open).toBe(true);
    expect(container.querySelectorAll("details[open]")).toHaveLength(1);

    const detail = within(item);
    expect(detail.getByText("Do you encrypt data?")).toBeInTheDocument();
    expect(detail.getByText("Intent: Protect data")).toBeInTheDocument();
    expect(detail.getByText("TLS everywhere")).toBeInTheDocument();
    expect(detail.getByText("Olivia Owner")).toBeInTheDocument();
    expect(detail.getByText("Cloud, SaaS")).toBeInTheDocument();
    expect(detail.getByText("Min. Confidentiality: HIGH")).toBeInTheDocument();
    expect(detail.getByText("Base Control")).toBeInTheDocument();
    const mapped = detail.getByRole("list", { name: "Requirements mapped to A.8.24" });
    expect(within(mapped).getByText(/Full Coverage/)).toBeInTheDocument();
    expect(within(mapped).getByText(/Partial Coverage · Draft Framework/)).toBeInTheDocument();
    expect(within(mapped).getByRole("link", { name: "ISO/IEC 27001:2022 A.8.24" })).toHaveAttribute("href", "/frameworks/f1/coverage");
  });

  it("says a Control with no Facets or thresholds applies regardless, and an unowned one has no Control Owner", async () => {
    const user = userEvent.setup();
    render(<ControlLibrary rows={rows} />);
    await user.click(screen.getByText("Notify the CSIRT"));
    const item = screen.getByText("Notify the CSIRT").closest("details") as HTMLElement;
    expect(within(item).getAllByText("Applies regardless")).toHaveLength(2);
    expect(within(item).getByText("No Control Owner")).toBeInTheDocument();
    expect(within(item).getByText(/Supplementary, authored for Next Law:1/)).toBeInTheDocument();
  });

  it("filters by text on code and title", async () => {
    const user = userEvent.setup();
    render(<ControlLibrary rows={rows} />);
    await user.type(screen.getByLabelText("Search Controls"), "crypto");
    expect(screen.getByText("Showing 1 of 3 Controls")).toBeInTheDocument();
    expect(screen.queryByText("Notify the CSIRT")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search Controls"));
    await user.type(screen.getByLabelText("Search Controls"), "sup-1");
    expect(screen.getByText("Notify the CSIRT")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 Controls")).toBeInTheDocument();
  });

  it("filters by origin and by Applicability", async () => {
    const user = userEvent.setup();
    render(<ControlLibrary rows={rows} />);
    await user.selectOptions(screen.getByLabelText("Origin filter"), "SUPPLEMENTARY");
    expect(screen.getByText("Showing 1 of 3 Controls")).toBeInTheDocument();
    expect(screen.getByText("Notify the CSIRT")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Origin filter"), "BASE");
    expect(screen.getByText("Showing 2 of 3 Controls")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Applicability filter"), "BOTH");
    expect(screen.getByText("Showing 1 of 3 Controls")).toBeInTheDocument();
    expect(screen.getByText("Use of cryptography")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search Controls"), "zzz");
    expect(screen.getByText("No Controls match.")).toBeInTheDocument();
  });

  it("has no edit controls", () => {
    render(<ControlLibrary rows={rows} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  });
});
