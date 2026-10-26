import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getActingUser = vi.fn();
const loadSystemPage = vi.fn();
vi.mock("@/lib/acting-user", () => ({ getActingUser: () => getActingUser() }));
vi.mock("../system-page-data", () => ({ loadSystemPage: (...args: unknown[]) => loadSystemPage(...args) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import SystemDetailPage from "../page";

afterEach(() => {
  cleanup();
  getActingUser.mockReset();
  loadSystemPage.mockReset();
});

const renderPage = async () => render(await SystemDetailPage({ params: Promise.resolve({ id: "s1" }) } as never));

describe("the System page's empty states (#243)", () => {
  it("asks for a user to act as first, without reading anything", async () => {
    getActingUser.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Pick a user to act as first");
    expect(loadSystemPage).not.toHaveBeenCalled();
  });

  it("says the System was not found, with a way back to the list", async () => {
    getActingUser.mockResolvedValue({ id: "u1", name: "Ola", role: "VIEWER" });
    loadSystemPage.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByRole("heading", { name: "System not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the Systems list" })).toHaveAttribute("href", "/systems");
    expect(loadSystemPage).toHaveBeenCalledWith({ id: "u1", name: "Ola", role: "VIEWER" }, "s1");
  });
});
