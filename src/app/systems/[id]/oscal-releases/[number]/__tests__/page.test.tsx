import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getActingUser = vi.fn();
const getVisibleSystem = vi.fn();
const findUnique = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("@/lib/acting-user", () => ({ getActingUser: () => getActingUser() }));
vi.mock("@/lib/system-visibility", () => ({ getVisibleSystem: (...a: unknown[]) => getVisibleSystem(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { oscalRelease: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import Page from "../page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const run = (number = "2") => Page({ params: Promise.resolve({ id: "s1", number }) } as never).then((ui) => render(ui));
const HASH = "c".repeat(64);
const release = {
  number: 2,
  trigger: "MANUAL",
  createdAt: new Date("2026-11-20T10:00:00.000Z"),
  sha256: HASH,
  createdBy: { name: "Elena Voss" },
  internalAudit: null,
  manifest: { release: 2, files: [{ name: "ssp.json", sha256: "d".repeat(64) }], evidence: [{ title: "The policy", fileName: "policy.pdf", sha256: "e".repeat(64) }, { title: "Old file", fileName: "old.pdf", sha256: null }] },
};

describe("the OSCAL Release page (#453)", () => {
  it("is not found for an invisible System, a bad number, or a number the System lacks", async () => {
    getActingUser.mockResolvedValue({ id: "u1", role: "ADMIN" });
    getVisibleSystem.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    getVisibleSystem.mockResolvedValue({ id: "s1", name: "Payroll" });
    await expect(run("0")).rejects.toThrow("NEXT_NOT_FOUND");
    findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the metadata, the manifest and the evidence hashes, with a download", async () => {
    getActingUser.mockResolvedValue({ id: "u1", role: "ADMIN" });
    getVisibleSystem.mockResolvedValue({ id: "s1", name: "Payroll" });
    findUnique.mockResolvedValue(release);
    await run();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("OSCAL Release 2 of Payroll");
    expect(screen.getByText("20 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("Elena Voss")).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.getByText("ssp.json")).toBeInTheDocument();
    expect(screen.getByText("d".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("The policy")).toBeInTheDocument();
    expect(screen.getByText("No hash recorded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download release 2" })).toHaveAttribute("href", "/api/systems/s1/oscal-releases/2");
  });
});
