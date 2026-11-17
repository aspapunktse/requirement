import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonsList } from "../ComparisonsList";
import type { ComparisonListRow } from "../comparison-types";
import { listRow } from "./fixtures";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
const registration = vi.hoisted(() => ({ current: null as null | { items: { label: string; href: string; meta?: string }[] } }));
vi.mock("@/components/PaletteProvider", () => ({
  usePagePalette: (value: NonNullable<typeof registration.current>) => {
    registration.current = value;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

function serve(rows: ComparisonListRow[] | "fail") {
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, status: 201, json: async () => ({ comparison: { id: "cmp-new" } }) } as Response;
    return rows === "fail" ? ({ ok: false, status: 500, json: async () => ({}) } as Response) : ({ ok: true, status: 200, json: async () => ({ comparisons: rows }) } as Response);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const open = (canCreate = true) => render(<ComparisonsList canCreate={canCreate} roleLabel="A Viewer" />);
const lane = (name: string) => screen.getByRole("region", { name: `${name} Comparisons` });

const rows = [listRow("Alpha HR"), listRow("Beta CRM", { owner: { id: "u2", name: "Pat Peer" } }), listRow("Old ERP", { closed: true, candidateCount: 1 })];

describe("ComparisonsList", () => {
  it("says it is loading, then lists", async () => {
    serve(rows);
    open();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Comparisons");
    expect(await screen.findByRole("link", { name: "Alpha HR" })).toHaveAttribute("href", "/comparisons/cmp-Alpha HR");
  });

  it("shows an error with Try again, and recovers", async () => {
    const mock = serve("fail");
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    mock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ comparisons: rows }) }) as Response);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Alpha HR" })).toBeInTheDocument();
  });

  it("is not inside the Systems register's .sy wrapper, whose table rules would stack the rows on a phone and force a 980px width", async () => {
    serve(rows);
    const { container } = open();
    await screen.findByRole("link", { name: "Alpha HR" });
    expect(container.querySelector(".sy")).toBeNull();
    expect(container.querySelector(".cmp-tablewrap .cmp-reg thead")).not.toBeNull();
  });

  it("splits the list into an Open and a Closed section, each with a lane header and a count", async () => {
    serve(rows);
    open();
    await screen.findByRole("link", { name: "Alpha HR" });
    const openLane = lane("Open");
    const closedLane = lane("Closed");
    expect(within(openLane).getByRole("heading", { name: /Open/ })).toHaveTextContent("2 Comparisons");
    expect(within(closedLane).getByRole("heading", { name: /Closed/ })).toHaveTextContent("1 Comparison");
    expect(within(openLane).getByRole("link", { name: "Alpha HR" })).toBeInTheDocument();
    expect(within(openLane).getByRole("link", { name: "Beta CRM" })).toBeInTheDocument();
    expect(within(openLane).queryByRole("link", { name: "Old ERP" })).not.toBeInTheDocument();
    expect(within(closedLane).getByRole("link", { name: "Old ERP" })).toBeInTheDocument();
    expect(within(closedLane).getByText("1 Candidate")).toBeInTheDocument();
  });

  it("counts the tabs, and the Open and Closed tabs show one section each", async () => {
    serve(rows);
    open();
    await screen.findByRole("link", { name: "Alpha HR" });
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /^Open/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /^Closed/ })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("tab", { name: /^Closed/ }));
    expect(screen.queryByRole("region", { name: "Open Comparisons" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Old ERP" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Open/ }));
    expect(screen.queryByRole("region", { name: "Closed Comparisons" })).not.toBeInTheDocument();
  });

  it("searches name, need and owner, and says when nothing matches", async () => {
    serve(rows);
    open();
    await screen.findByRole("link", { name: "Alpha HR" });
    const search = screen.getByRole("searchbox", { name: "Search Comparisons" });
    await userEvent.type(search, "pat");
    expect(screen.queryByRole("link", { name: "Alpha HR" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Beta CRM" })).toBeInTheDocument();
    // A section with no match still shows its header and says so.
    expect(within(lane("Closed")).getByText(/No closed Comparison matches/)).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByRole("heading", { name: "Nothing matches" })).toBeInTheDocument();
  });

  it("says so when there is no Comparison to show", async () => {
    serve([]);
    open();
    expect(await screen.findByRole("heading", { name: "No Comparison to show" })).toBeInTheDocument();
  });

  it("offers New Comparison to a role that can create one and explains otherwise", async () => {
    serve(rows);
    open(true);
    await screen.findByRole("link", { name: "Alpha HR" });
    expect(screen.getByRole("button", { name: "+ New Comparison" })).toBeInTheDocument();
    cleanup();
    serve(rows);
    open(false);
    await screen.findByRole("link", { name: "Alpha HR" });
    expect(screen.queryByRole("button", { name: "+ New Comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/A Viewer can't create a Comparison/)).toBeInTheDocument();
  });

  it("creates a Comparison and opens it", async () => {
    const mock = serve(rows);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "+ New Comparison" }));
    const dialog = screen.getByRole("dialog", { name: "New Comparison" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Fresh");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create Comparison" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/comparisons/cmp-new"));
    const post = mock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/comparisons");
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ name: "Fresh" });
  });

  it("registers its Comparisons in the palette", async () => {
    serve(rows);
    open();
    await screen.findByRole("link", { name: "Alpha HR" });
    expect(registration.current!.items.map((item) => item.label)).toEqual(["Alpha HR", "Beta CRM", "Old ERP"]);
  });
});
