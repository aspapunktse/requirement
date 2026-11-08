import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskRegisterRow } from "@/lib/risk-register";
import { RiskRegister } from "../RiskRegister";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<RiskRegisterRow> & { id: string; title: string }): RiskRegisterRow => ({
  system: { id: "s1", name: "Jira" },
  source: "AD_HOC",
  severity: "MEDIUM",
  likelihood: "LOW",
  status: "OPEN",
  owner: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

const ROWS: RiskRegisterRow[] = [
  row({ id: "r1", title: "Weak passwords", severity: "CRITICAL", owner: { id: "u1", name: "Elena Voss" } }),
  row({ id: "r2", title: "Unpatched server", source: "REQUIREMENT_NONCONFORMANCE", status: "MITIGATED", system: { id: "s2", name: "CATIA" } }),
  row({ id: "r3", title: "Audit gap", source: "AUDIT_FINDING", system: null }),
];

const renderRegister = (props: Partial<React.ComponentProps<typeof RiskRegister>> = {}) =>
  render(<RiskRegister rows={ROWS} canReadOrganizationRisks initialFilters={{ source: "", status: "", severity: "" }} {...props} />);
const titles = () => within(screen.getByRole("table")).getAllByRole("link").map((link) => link.textContent);

beforeEach(() => replace.mockClear());
afterEach(cleanup);

describe("the Risk register (#322)", () => {
  it("lists title, System (Organization for a System-less Risk), Risk Source, severity, likelihood, status, owner and opened date", () => {
    renderRegister();
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Risk", "System", "Risk Source", "Severity", "Likelihood", "Status", "Owner", "Opened"]);
    const first = within(table.getByRole("link", { name: "Weak passwords" }).closest("tr")!);
    for (const text of ["Jira", "Ad hoc", "Critical", "Low", "Open", "Elena Voss", "2026-11-01"]) expect(first.getByText(text)).toBeInTheDocument();
    const org = within(table.getByRole("link", { name: "Audit gap" }).closest("tr")!);
    expect(org.getByText("Organization")).toBeInTheDocument();
    expect(org.getByText("Audit finding")).toBeInTheDocument();
    expect(org.getByText("Unassigned")).toBeInTheDocument();
  });

  it("links each row to where the Risk is managed", () => {
    renderRegister();
    expect(screen.getByRole("link", { name: "Weak passwords" })).toHaveAttribute("href", "/systems/s1#risks");
    expect(screen.getByRole("link", { name: "Unpatched server" })).toHaveAttribute("href", "/systems/s2#risks");
    expect(screen.getByRole("link", { name: "Audit gap" })).toHaveAttribute("href", "/risks/organization");
  });

  it("filters by source, status and severity and keeps them in the URL", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.selectOptions(screen.getByLabelText("Filter by Risk Source"), "REQUIREMENT_NONCONFORMANCE");
    expect(titles()).toEqual(["Unpatched server"]);
    expect(replace).toHaveBeenLastCalledWith("/risks?source=REQUIREMENT_NONCONFORMANCE", { scroll: false });

    await user.selectOptions(screen.getByLabelText("Filter by Risk Source"), "");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "OPEN");
    expect(titles()).toEqual(["Weak passwords", "Audit gap"]);
    await user.selectOptions(screen.getByLabelText("Filter by severity"), "CRITICAL");
    expect(titles()).toEqual(["Weak passwords"]);
    expect(replace).toHaveBeenLastCalledWith("/risks?status=OPEN&severity=CRITICAL", { scroll: false });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(titles()).toHaveLength(3);
    expect(replace).toHaveBeenLastCalledWith("/risks", { scroll: false });
  });

  it("starts from the filters in the URL and ignores values it doesn't know", () => {
    renderRegister({ initialFilters: { source: "AUDIT_FINDING", status: "bogus", severity: "" } });
    expect(titles()).toEqual(["Audit gap"]);
    expect(screen.getByLabelText("Filter by status")).toHaveValue("");
  });

  it("counts open Risks by source on cards that filter", async () => {
    const user = userEvent.setup();
    renderRegister();
    const cards = within(screen.getByRole("region", { name: "Open Risks by Risk Source" }));
    expect(cards.getByRole("button", { name: /Ad hoc/ })).toHaveTextContent("1");
    // Mitigated, so not among the open ones.
    expect(cards.getByRole("button", { name: /Requirement non-conformance/ })).toHaveTextContent("0");
    await user.click(cards.getByRole("button", { name: /Audit finding/ }));
    expect(titles()).toEqual(["Audit gap"]);
    expect(cards.getByRole("button", { name: /Audit finding/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when nothing matches or there are no Risks, and links Organization Risks only to roles that read them", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRegister();
    expect(screen.getByRole("link", { name: "Organization Risks" })).toHaveAttribute("href", "/risks/organization");
    await user.selectOptions(screen.getByLabelText("Filter by Risk Source"), "REQUIREMENT_NONCONFORMANCE");
    await user.selectOptions(screen.getByLabelText("Filter by severity"), "CRITICAL");
    expect(screen.getByText("No Risks match these filters.")).toBeInTheDocument();
    rerender(<RiskRegister rows={[]} canReadOrganizationRisks={false} initialFilters={{ source: "", status: "", severity: "" }} />);
    expect(screen.queryByRole("link", { name: "Organization Risks" })).not.toBeInTheDocument();
  });
});
