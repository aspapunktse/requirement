import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeReviewView } from "@/lib/change-review";
import { SystemChangeReview } from "../SystemChangeReview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

function review(controlCodes: string[]): ChangeReviewView {
  return {
    id: "cr1",
    startedAt: new Date("2026-11-10T10:00:00Z").toISOString(),
    hasBusinessSystemOwner: true,
    canDecide: false,
    allRecommended: false,
    sendBackTargets: null,
    participants: [
      {
        reviewGroupId: "g1",
        name: "Export Review Group",
        controls: controlCodes.map((code) => ({ code, title: `Title ${code}` })),
        recommendation: null,
        reopened: null,
        canGive: false,
      },
    ],
  };
}

describe("SystemChangeReview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the open review, and reads it again when the revision from the server page changes", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ changeReview: review(url.includes("rev=two") ? ["X.1", "X.2"] : ["X.1"]) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<SystemChangeReview systemId="s1" revision="one" />);
    expect(await screen.findByText(/Added Controls: X\.1 Title X\.1$/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<SystemChangeReview systemId="s1" revision="two" />);
    await waitFor(() => expect(screen.getByText(/X\.1 Title X\.1; X\.2 Title X\.2/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says so when the review can't be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<SystemChangeReview systemId="s1" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("warns when the System has no Business System Owner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ changeReview: { ...review(["X.1"]), hasBusinessSystemOwner: false } }), { status: 200 })));
    render(<SystemChangeReview systemId="s1" />);
    expect(await screen.findByText(/has no Business System Owner/)).toBeTruthy();
  });
});
