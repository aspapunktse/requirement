import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UserRole } from "@prisma/client";

const acting = vi.hoisted(() => ({ user: null as { id: string; role: UserRole } | null }));
vi.mock("@/lib/acting-user", () => ({ getActingUser: async () => acting.user }));
const boundaries = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/compliance-boundary-data", () => ({ listBoundaries: async () => boundaries.rows }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (run: (tx: unknown) => unknown) => run({}) } }));
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import StatementOfApplicabilityPage from "../page";

/**
 * The old `/statement-of-applicability` address (#420): the statement is per Compliance Boundary now, so it redirects when exactly one
 * active Boundary exists and otherwise lists them (the Boundary list itself is `listBoundaries`, tested with the Boundaries).
 */
const row = (id: string, name: string) => ({ id, name, description: null, businessUnit: null, boundaryOwner: null, frameworks: [{ id: `f-${id}`, name: "ISO 27001", version: "2022" }], systemCount: 1, retiredAt: null });

beforeEach(() => {
  acting.user = { id: "u1", role: "VIEWER" };
  boundaries.rows = [];
  redirectMock.mockClear();
});

describe("the old Statement of Applicability address (#420)", () => {
  it("asks for an acting user first", async () => {
    acting.user = null;
    render(await StatementOfApplicabilityPage());
    expect(screen.getByText("Pick a user to act as first.")).toBeInTheDocument();
  });

  it("redirects to the statement of the only active Boundary", async () => {
    boundaries.rows = [row("b1", "ISMS scope")];
    await expect(StatementOfApplicabilityPage()).rejects.toThrow("NEXT_REDIRECT /compliance-boundaries/b1/statement");
    expect(redirectMock).toHaveBeenCalledWith("/compliance-boundaries/b1/statement");
  });

  it("lists the active Boundaries to pick from when there are several, each linking to its statement", async () => {
    boundaries.rows = [row("b1", "ISMS scope"), row("b2", "Customer X contract")];
    render(await StatementOfApplicabilityPage());
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /ISMS scope/ })).toHaveAttribute("href", "/compliance-boundaries/b1/statement");
    expect(screen.getByRole("link", { name: /Customer X contract/ })).toHaveAttribute("href", "/compliance-boundaries/b2/statement");
  });

  it("points to the Compliance Boundaries when there is none", async () => {
    render(await StatementOfApplicabilityPage());
    expect(screen.getByText(/no active Compliance Boundary yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Compliance Boundaries/ })).toHaveAttribute("href", "/compliance-boundaries");
  });
});
