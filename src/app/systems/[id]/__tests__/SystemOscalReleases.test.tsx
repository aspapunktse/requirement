import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemOscalReleases } from "../SystemOscalReleases";

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const HASH = "a".repeat(64);
const releases = [
  { id: "r2", number: 2, trigger: "INTERNAL_AUDIT_CLOSE", createdAt: "2026-11-20T10:00:00.000Z", createdBy: { id: "u1", name: "Elena Voss" }, sha256: HASH },
  { id: "r1", number: 1, trigger: "MANUAL", createdAt: "2026-11-01T10:00:00.000Z", createdBy: null, sha256: "b".repeat(64) },
];

let fetchMock: ReturnType<typeof vi.fn>;
let canCreate: boolean;
let list: unknown[];

beforeEach(() => {
  canCreate = true;
  list = releases;
  fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respond({ release: {} }, 201) : respond({ releases: list, canCreate })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SystemOscalReleases (#453)", () => {
  it("lists releases with number, date, trigger, who, short hash and a download link", async () => {
    render(<SystemOscalReleases systemId="s1" />);
    expect(await screen.findByRole("link", { name: "Release 2" })).toHaveAttribute("href", "/systems/s1/oscal-releases/2");
    expect(screen.getByText("Internal Audit closed")).toBeInTheDocument();
    expect(screen.getByText("Elena Voss")).toBeInTheDocument();
    expect(screen.getByText("20 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(12))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download release 1" })).toHaveAttribute("href", "/api/systems/s1/oscal-releases/1");
  });

  it("hides Make release unless the list says the user may create one", async () => {
    canCreate = false;
    render(<SystemOscalReleases systemId="s1" />);
    await screen.findByRole("link", { name: "Release 2" });
    expect(screen.queryByRole("button", { name: "Make release" })).not.toBeInTheDocument();
  });

  it("makes a release with a POST and reads the list again", async () => {
    list = [];
    render(<SystemOscalReleases systemId="s1" />);
    expect(await screen.findByText("No release has been made yet.")).toBeInTheDocument();
    list = releases;
    await userEvent.click(screen.getByRole("button", { name: "Make release" }));
    expect(await screen.findByRole("link", { name: "Release 1" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/oscal-releases", { method: "POST" });
  });

  it("shows the server's refusal and keeps the list", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "POST" ? respond({ error: "Only the System's owner or an Admin can make an OSCAL Release" }, 403) : respond({ releases: list, canCreate })));
    render(<SystemOscalReleases systemId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Make release" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the System's owner or an Admin");
    expect(screen.getByRole("link", { name: "Release 2" })).toBeInTheDocument();
  });

  it("says so when the list can't be loaded, and tries again", async () => {
    fetchMock.mockImplementationOnce(() => respond({ error: "x" }, 500));
    render(<SystemOscalReleases systemId="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Release 2" })).toBeInTheDocument());
  });
});
