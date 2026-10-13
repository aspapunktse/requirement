import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("StatementOfApplicability exclusion justifications (#150)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const jsonResponse = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

  it("shows the count of excluded Controls with a justification missing", () => {
    render(<StatementOfApplicability rows={rows} />);
    expect(screen.getByText("Exclusion justifications missing: 1")).toBeInTheDocument();
  });

  it("shows the stored text of an excluded Control, and no edit controls without canEdit", () => {
    const written = rows.map((row) => (row.code === "A.8.30" ? { ...row, exclusionJustification: "No development here", justificationMissing: false } : row));
    render(<StatementOfApplicability rows={written} />);
    expect(within(rowOf("A.8.30")).getByText("No development here")).toBeInTheDocument();
    expect(screen.getByText("Exclusion justifications missing: 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /justification of/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("lets an editor write one, PUTs it, and the missing count goes down", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      jsonResponse({ controlId: "c3", exclusionJustification: "No development here", justificationMissing: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<StatementOfApplicability rows={rows} canEdit />);

    // Included Controls get no edit control.
    expect(screen.getAllByRole("button", { name: /Edit justification of/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Edit justification of A.8.30" }));
    await user.type(screen.getByRole("textbox", { name: "Exclusion justification of A.8.30" }), "No development here");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/statement-of-applicability/c3/exclusion-justification",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ justification: "No development here" }) }),
    );
    expect(await within(rowOf("A.8.30")).findByText("No development here")).toBeInTheDocument();
    expect(screen.getByText("Exclusion justifications missing: 0")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("clears a stored justification, and the count goes up again", async () => {
    const user = userEvent.setup();
    const written = rows.map((row) => (row.code === "A.8.30" ? { ...row, exclusionJustification: "Old reason", justificationMissing: false } : row));
    const fetchMock = vi.fn(() => jsonResponse({ controlId: "c3", exclusionJustification: null, justificationMissing: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatementOfApplicability rows={written} canEdit />);

    await user.click(screen.getByRole("button", { name: "Edit justification of A.8.30" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/statement-of-applicability/c3/exclusion-justification",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ justification: null }) }),
    );
    expect(await within(rowOf("A.8.30")).findByText("Justification missing")).toBeInTheDocument();
    expect(screen.getByText("Exclusion justifications missing: 1")).toBeInTheDocument();
  });

  it("cancels without calling the server, and shows the server's error when a save fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => jsonResponse({ error: "Forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatementOfApplicability rows={rows} canEdit />);

    await user.click(screen.getByRole("button", { name: "Edit justification of A.8.30" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit justification of A.8.30" }));
    await user.type(screen.getByRole("textbox"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.getByText("Exclusion justifications missing: 1")).toBeInTheDocument();
  });
});

describe("StatementOfApplicability CSV download (#151)", () => {
  it.each([false, true])("links to the export, whatever the filter (canEdit %s)", async (canEdit) => {
    render(<StatementOfApplicability rows={rows} canEdit={canEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /^Excluded/ }));
    const link = screen.getByRole("link", { name: "Download CSV" });
    expect(link).toHaveAttribute("href", "/api/statement-of-applicability/export");
    expect(link).toHaveAttribute("download");
  });
});
