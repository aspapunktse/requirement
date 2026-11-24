import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getActingUser = vi.fn();
const loadOscalPackage = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("@/lib/acting-user", () => ({ getActingUser: () => getActingUser() }));
vi.mock("@/lib/oscal/package-builder", () => ({ loadOscalPackage: (...args: unknown[]) => loadOscalPackage(...args), OSCAL_APP_NS: "ns" }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("../OscalPackageReview", () => ({ OscalPackageReview: ({ systemId }: { systemId: string }) => <p>review of {systemId}</p> }));

import Page from "../page";

afterEach(() => {
  cleanup();
  getActingUser.mockReset();
  loadOscalPackage.mockReset();
  notFound.mockClear();
});

const run = async () => render(await Page({ params: Promise.resolve({ id: "s1" }) } as never));
const user = { id: "u1", name: "Ola", role: "VIEWER" };

describe("the OSCAL Package review page's access rules (#445), the download route's", () => {
  it("asks for a user to act as first, loading nothing", async () => {
    getActingUser.mockResolvedValue(null);
    await run();
    expect(screen.getByText("Pick a user to act as first.")).toBeInTheDocument();
    expect(loadOscalPackage).not.toHaveBeenCalled();
  });

  it("is not found for an unknown or invisible System", async () => {
    getActingUser.mockResolvedValue(user);
    loadOscalPackage.mockResolvedValue({ kind: "not-found" });
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadOscalPackage).toHaveBeenCalledWith("s1", user);
  });

  it("refuses a closed System with the download's refusal text", async () => {
    getActingUser.mockResolvedValue(user);
    loadOscalPackage.mockResolvedValue({ kind: "closed", status: "REJECTED" });
    await run();
    expect(screen.getByRole("status")).toHaveTextContent("This System was rejected and is closed");
    expect(screen.queryByText("review of s1")).not.toBeInTheDocument();
  });

  it("renders the review for a visible open System", async () => {
    getActingUser.mockResolvedValue(user);
    loadOscalPackage.mockResolvedValue({ kind: "ok", system: { id: "s1", name: "X" }, pkg: {} });
    await run();
    expect(screen.getByText("review of s1")).toBeInTheDocument();
  });
});
