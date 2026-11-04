import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";
import { whereCounts } from "@/lib/information-type-where";
import { WhereCanIPut } from "../WhereCanIPut";
import type { WhereSystem, WhereView } from "../where-data";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/information-types/where");
});
afterEach(cleanup);

const TYPES = [
  { id: "t-pay", name: "Payroll", description: "Salaries and bank details.", sensitivityLevel: 4, systemCount: 1 },
  { id: "t-cust", name: "Customer data", description: "Names and contact details.", sensitivityLevel: 3, systemCount: 2 },
  { id: "t-notes", name: "Meeting notes", description: null, sensitivityLevel: 1, systemCount: 0 },
];
const sys = (id: string, name: string, level: number | null, typeIds: string[] = [], isProvider = false): WhereSystem => ({ id, name, isProvider, sensitivityLevel: level, typeIds });
// Customer data is Sensitive (3): Jira declares it at 4; Hub declares it at 2 (below); Okta is a Provider at 5 (may hold);
// Equal sits exactly at 3; Low is at 2 and Blank has no level.
const ALL = [
  sys("s-jira", "Jira", 4, ["t-cust"]),
  sys("s-hub", "Hub", 2, ["t-cust"]),
  sys("s-okta", "Okta", 5, [], true),
  sys("s-equal", "Equal", 3),
  sys("s-low", "Low", 2),
  sys("s-blank", "Blank", null),
];

/** `hidden` Systems exist but the viewer may not see them: they count, they are not listed. */
const view = (visible: WhereSystem[] = ALL, all: WhereSystem[] = ALL): WhereView => ({
  types: TYPES,
  levels: [...DEFAULT_SENSITIVITY_LEVELS],
  systems: visible,
  counts: Object.fromEntries(TYPES.map((type) => [type.id, whereCounts(type, all)])),
});

const renderView = (over: Partial<WhereView> = {}, initial: string | null = "t-cust") => render(<WhereCanIPut view={{ ...view(), ...over }} initialTypeId={initial} />);
const heading = (name: RegExp) => screen.getByRole("heading", { level: 4, name });
/** The System names listed under a heading. */
const under = (name: RegExp) =>
  [...(heading(name).nextElementSibling as HTMLElement).querySelectorAll("li .nm a")].map((a) => a.textContent);

describe("Where can I put this information?", () => {
  it("lists the picked type's Systems in three groups with their counts", () => {
    renderView();
    expect(under(/^Already declare it/)).toEqual(["Jira", "Hub"]);
    expect(under(/^May hold it/)).toEqual(["Okta", "Equal"]);
    expect(under(/^Below it, so no/)).toEqual(["Low", "Blank"]);
    expect(heading(/^Already declare it/)).toHaveTextContent("2");
    expect(heading(/^May hold it/)).toHaveTextContent("2");
    expect(heading(/^Below it, so no/)).toHaveTextContent("2");
  });

  it("marks each row: Declared, Below its Information Types for a declaring System below the level, At or above, Below, No level declared", () => {
    renderView();
    const row = (name: string) => screen.getByRole("link", { name }).closest("li") as HTMLElement;
    expect(within(row("Jira")).getByText("Declared")).toBeInTheDocument();
    expect(within(row("Hub")).getByText("Below its Information Types")).toBeInTheDocument();
    expect(within(row("Hub")).queryByText("Declared")).toBeNull();
    expect(within(row("Okta")).getByText("At or above")).toBeInTheDocument();
    expect(within(row("Equal")).getByText("At or above")).toBeInTheDocument();
    expect(within(row("Low")).getByText("Below")).toBeInTheDocument();
    expect(within(row("Blank")).getByText("No level declared")).toBeInTheDocument();
  });

  it("says how many Systems may hold it and how many declare it, with the declaring ones below the level", () => {
    renderView();
    // Level 3 or above: Jira, Okta, Equal. Two declare it, one of them below.
    expect(screen.getByText(/3 Systems/).closest("p")).toHaveTextContent("3 Systems may hold it: their level is Sensitive or above. 2 declare it, 1 of them below that level.");
  });

  it("says nothing about below when no declaring System is below, and uses the singular", () => {
    renderView({ ...view([sys("s-one", "One", 5, ["t-cust"])], [sys("s-one", "One", 5, ["t-cust"])]) });
    expect(screen.getByText(/1 System\b/).closest("p")).toHaveTextContent("1 System may hold it: their level is Sensitive or above. 1 declares it.");
  });

  it("links each row to its System and tags a Provider", () => {
    renderView();
    expect(screen.getByRole("link", { name: "Okta" })).toHaveAttribute("href", "/systems/s-okta");
    expect((screen.getByRole("link", { name: "Okta" }).closest("li") as HTMLElement).textContent).toContain("Provider");
    expect((screen.getByRole("link", { name: "Jira" }).closest("li") as HTMLElement).textContent).not.toContain("Provider");
  });

  it("lists only the Systems the viewer can see, counts every System, and says how many are not visible", () => {
    // The viewer sees Jira and Equal; Hub, Okta, Low and Blank exist but are hidden.
    renderView(view([ALL[0], ALL[3]], ALL));
    expect(under(/^Already declare it/)).toEqual(["Jira"]);
    expect(heading(/^Already declare it/)).toHaveTextContent("2");
    expect(under(/^May hold it/)).toEqual(["Equal"]);
    expect(under(/^Below it, so no/)).toEqual([]);
    // Hub is hidden among those that declare it, Okta among those that may hold it, Low and Blank among those below.
    expect(screen.getAllByText(/more not visible to you/).map((el) => el.textContent)).toEqual(["1 more not visible to you.", "1 more not visible to you.", "2 more not visible to you."]);
    expect(screen.queryByText("Hub")).toBeNull();
    // The summary line is over all Systems, as the SoA's counts are.
    expect(screen.getByText(/3 Systems/).closest("p")).toHaveTextContent("3 Systems may hold it");
  });

  it("shows the empty lines instead of an empty list", () => {
    renderView(view([], []), "t-notes");
    expect(screen.getByText("No System declares it yet.")).toBeInTheDocument();
    expect(screen.getByText("No other System is at this level.")).toBeInTheDocument();
    expect(screen.getByText("None.")).toBeInTheDocument();
    expect(screen.getByText("No description.")).toBeInTheDocument();
  });

  it("picks a type from a radio group in the level order given, keeps it in the URL, and shows its description", async () => {
    renderView();
    const group = screen.getByRole("radiogroup", { name: "Information Type" });
    expect(within(group).getAllByRole("radio").map((r) => (r.closest("label") as HTMLElement).querySelector(".t")?.textContent)).toEqual(["Payroll", "Customer data", "Meeting notes"]);
    expect(within(group).getByRole("radio", { name: /Customer data/ })).toBeChecked();
    expect(screen.getByText("Names and contact details.")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("radio", { name: /Payroll/ }));
    expect(within(group).getByRole("radio", { name: /Payroll/ })).toBeChecked();
    expect(screen.getByRole("heading", { level: 3, name: /Payroll/ })).toBeInTheDocument();
    expect(screen.getByText("Salaries and bank details.")).toBeInTheDocument();
    expect(window.location.search).toBe("?type=t-pay");
    // Payroll is Highly Sensitive (4): only Jira (4) and Okta (5) may hold it, Jira not declaring it.
    expect(under(/^May hold it/)).toEqual(["Jira", "Okta"]);
  });

  it("searches the pick list", async () => {
    renderView();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Information Types" }), "pay");
    const group = screen.getByRole("radiogroup", { name: "Information Type" });
    expect(within(group).getAllByRole("radio")).toHaveLength(1);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search Information Types" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Information Types" }), "zzz");
    expect(within(group).queryAllByRole("radio")).toHaveLength(0);
    expect(within(group).getByText("No Information Type matches.")).toBeInTheDocument();
  });

  it("closes with the note that May hold it is about the level only", () => {
    renderView();
    expect(screen.getByText(/is about the level only/)).toHaveTextContent("A System's owner still has to declare the type on its Profile tab");
  });

  it("handles an empty catalogue", () => {
    render(<WhereCanIPut view={{ types: [], levels: [...DEFAULT_SENSITIVITY_LEVELS], systems: [], counts: {} }} initialTypeId={null} />);
    expect(screen.getByText("No Information Types in the catalogue yet.")).toBeInTheDocument();
    expect(screen.getByText("Pick an Information Type to see where it may go.")).toBeInTheDocument();
  });
});
