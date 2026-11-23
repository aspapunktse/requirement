import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoundaryListRow } from "@/lib/compliance-boundary";
import { BoundaryList } from "../BoundaryList";

const cmmc = { id: "f-cmmc", name: "CMMC", version: "L1" };
const iso = { id: "f-iso", name: "ISO 27001", version: "2022" };
const ces = { id: "f-ces", name: "Cyber Essentials", version: "3.1" };

const row = (id: string, name: string, frameworks: BoundaryListRow["frameworks"], retiredAt: string | null = null): BoundaryListRow => ({
  id,
  name,
  description: null,
  businessUnit: null,
  boundaryOwner: null,
  frameworks,
  systemCount: 2,
  retiredAt,
});

const rows = [
  row("b1", "FCI boundary", [cmmc]),
  row("b2", "UK contract", [ces, iso]),
  row("b3", "ISMS scope", [iso]),
  row("b4", "Old contract", [ces], "2026-11-01T00:00:00.000Z"),
];

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const stat = (label: RegExp) => screen.getByRole("button", { name: label });
const listed = () => within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent ?? "");

describe("the Compliance Boundary list's Framework counters (#433)", () => {
  it("shows one card per Framework held by an active Boundary, a Boundary with two counting under both, a retired one under none", () => {
    render(<BoundaryList boundaries={rows} showRetired hiddenRetired={0} initialFramework={null} />);
    expect(stat(/All Frameworks/)).toHaveTextContent("3"); // the active Boundaries, not the retired one
    expect(stat(/^CMMC:L1/)).toHaveTextContent("1");
    expect(stat(/^ISO 27001:2022/)).toHaveTextContent("2"); // UK contract and ISMS scope
    expect(stat(/^Cyber Essentials:3.1/)).toHaveTextContent("1"); // the retired Old contract does not count
    expect(screen.queryByText(/Onboarded|not yet operating/i)).toBeNull(); // no counters by state
  });

  it("filters the list on a click, clears it on a second click or on All, and keeps the choice in the URL", async () => {
    render(<BoundaryList boundaries={rows} showRetired hiddenRetired={0} initialFramework={null} />);
    expect(listed()).toHaveLength(4);
    await userEvent.click(stat(/^ISO 27001/));
    expect(stat(/^ISO 27001/)).toHaveAttribute("aria-pressed", "true");
    expect(listed().map((text) => text.split("Contract")[0])).toHaveLength(2);
    expect(screen.getByText("UK contract")).toBeInTheDocument();
    expect(screen.getByText("ISMS scope")).toBeInTheDocument();
    expect(screen.queryByText("FCI boundary")).toBeNull();
    expect(window.location.search).toBe("?framework=f-iso");
    await userEvent.click(stat(/^ISO 27001/));
    expect(listed()).toHaveLength(4);
    expect(window.location.search).toBe("");
    await userEvent.click(stat(/^Cyber Essentials/));
    expect(listed()).toHaveLength(2); // the active and the retired one that hold it
    await userEvent.click(stat(/All Frameworks/));
    expect(listed()).toHaveLength(4);
    expect(stat(/All Frameworks/)).toHaveAttribute("aria-pressed", "true");
  });

  it("starts from the Framework named in the URL, and ignores one no active Boundary holds", () => {
    const { unmount } = render(<BoundaryList boundaries={rows} showRetired={false} hiddenRetired={1} initialFramework="f-cmmc" />);
    expect(listed()).toHaveLength(1);
    unmount();
    render(<BoundaryList boundaries={rows} showRetired={false} hiddenRetired={1} initialFramework="f-gone" />);
    expect(listed()).toHaveLength(4);
  });

  it("keeps the Show retired link, and shows no cards and the empty message when there is no Boundary", () => {
    const { unmount } = render(<BoundaryList boundaries={rows} showRetired={false} hiddenRetired={1} initialFramework={null} />);
    expect(screen.getByRole("link", { name: "Show retired Compliance Boundaries" })).toHaveAttribute("href", "/compliance-boundaries?retired=1");
    unmount();
    render(<BoundaryList boundaries={[]} showRetired={false} hiddenRetired={0} initialFramework={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("No Compliance Boundaries yet.")).toBeInTheDocument();
  });

  it("counts nothing when only retired Boundaries exist, and says so", () => {
    render(<BoundaryList boundaries={[rows[3]]} showRetired hiddenRetired={0} initialFramework={null} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Old contract")).toBeInTheDocument();
  });
});
