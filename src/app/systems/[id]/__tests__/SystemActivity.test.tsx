import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemActivity } from "../SystemActivity";
import type { TimelineItem } from "../system-page-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const NOW = "2026-10-26T09:00:00.000Z";

const item = (id: string, over: Partial<TimelineItem>): TimelineItem => ({ id, who: "You", what: "changed a System's classification", detail: "", tone: "accent", at: "2026-10-25T09:00:00.000Z", ...over });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ rounds: [], steps: [] }), { status: 200 }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Approval and activity tab", () => {
  it("holds the approval panel on top and the timeline below it", async () => {
    render(<SystemActivity systemId="s1" timeline={[]} now={NOW} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Approval", "Activity"]);
    expect(await screen.findByText("No Approval decisions recorded yet.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/systems/s1/approvals");
    expect(screen.getByText("Nothing has changed on this System yet.")).toBeInTheDocument();
  });

  it("lists every Change Event in the order given, each with actor, label, detail as written and date", async () => {
    const timeline = [
      item("e1", { who: "Sara Ek", what: "recorded an Approval decision", detail: "Base review: Approved: fine", tone: "accent", at: "2026-10-26T08:00:00.000Z" }),
      item("e2", { detail: 'Framework Scope: added "GDPR:2016"' }),
      item("e3", { who: "The system", what: "logged a Risk", detail: 'Risk "A.5.1: Policies" auto-opened from a "No" Self-Assessment answer to A.5.1 (severity: Medium)', tone: "warn", at: "2026-10-20T09:00:00.000Z" }),
      item("e4", { who: "Marcus Lindqvist", what: "created a System", detail: 'Created the System "ServiceNow"', tone: "ok", at: "2026-09-01T09:00:00.000Z" }),
    ];
    render(<SystemActivity systemId="s1" timeline={timeline} now={NOW} />);

    const entries = within(screen.getByRole("list", { name: "Activity timeline" })).getAllByRole("listitem");
    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveTextContent("Sara Ek recorded an Approval decision");
    expect(entries[0]).toHaveTextContent("Base review: Approved: fine");
    expect(entries[0]).toHaveTextContent("26 Oct 2026");
    expect(entries[1]).toHaveTextContent('You changed a System\'s classification');
    expect(entries[1]).toHaveTextContent('Framework Scope: added "GDPR:2016"');
    expect(entries[2]).toHaveTextContent("The system logged a Risk");
    expect(entries[2]).toHaveTextContent("severity: Medium");
    expect(entries[3]).toHaveTextContent("Marcus Lindqvist created a System");
    // The date's tooltip says how long ago, from the time the page was read.
    expect(within(entries[2]).getByText("20 Oct 2026")).toHaveAttribute("title", "6 d ago");
    await screen.findByText("No Approval decisions recorded yet.");
  });

  it("ends a System older than the creation event in a Created entry without an actor", async () => {
    render(<SystemActivity systemId="s1" timeline={[item("e1", {}), item("created", { who: null, what: "created a System", tone: "ok", at: "2026-01-05T09:00:00.000Z" })]} now={NOW} />);
    const entries = within(screen.getByRole("list", { name: "Activity timeline" })).getAllByRole("listitem");
    expect(entries[1]).toHaveTextContent("System created");
    expect(entries[1]).toHaveTextContent("5 Jan 2026");
    expect(entries[1]).not.toHaveTextContent("created a System");
    await screen.findByText("No Approval decisions recorded yet.");
  });
});
