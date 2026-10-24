import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ago, HomeCommandCenter, visibleTasks } from "../HomeCommandCenter";
import { paletteItems } from "../JumpPalette";
import type { HomeTask, HomeView } from "../home-types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const task = (over: Partial<HomeTask> & Pick<HomeTask, "id" | "kind" | "title">): HomeTask => ({
  tone: "warn",
  status: "Your turn",
  href: `/x/${over.id}`,
  lane: "you",
  days: 1,
  action: "Open",
  ...over,
});

const TASKS: HomeTask[] = [
  task({ id: "s1", kind: "System", title: "Payroll Portal", subtitle: "Rejected by Sara", status: "Rejected", tone: "danger", days: 2, action: "Fix and resubmit" }),
  task({ id: "q1", kind: "Query", title: "A.8.5 Secure authentication", subtitle: "ServiceNow", status: "Awaiting your reply", days: 5, action: "Reply" }),
  task({ id: "q2", kind: "Query", title: "A.5.23 Cloud services", subtitle: "ServiceNow", status: "Awaiting your reply", days: 9, action: "Reply" }),
  task({ id: "c1", kind: "Check-up", title: "A.8.15 Logging", status: "Open", tone: "accent", days: 6, lane: "soon", action: "Answer" }),
  task({ id: "s2", kind: "System", title: "HR Archive", status: "In review", tone: "neutral", days: null, lane: "waiting", action: "View" }),
];

const view = (over: Partial<HomeView> = {}): HomeView => ({
  name: "Marcus Lindqvist",
  role: "SYSTEM_OWNER",
  roleLabel: "System Owner",
  lede: "Track the Systems you own.",
  stats: [
    { label: "Needing attention", value: 1, tone: "warn", filter: "System", trend: [0, 1, 1, 2, 1, 1, 1] },
    { label: "Open questions", value: 2, tone: "warn", filter: "Query" },
    { label: "Controls", value: 124 },
  ],
  tasks: TASKS,
  tiles: [
    { title: "Create a System", description: "Start onboarding.", href: "/systems/new", icon: "plus", primary: true },
    { title: "Framework coverage", description: "Which Requirements are covered.", href: "/frameworks", icon: "grid", foot: "6 Frameworks" },
  ],
  picture: { type: "bars", title: "Users by role", note: "3 users", empty: "none", items: [{ id: "a", name: "Admin", value: 2 }] },
  activity: [{ id: "e1", who: "Sara Ek", what: "recorded an Approval decision", target: "Payroll Portal", href: "/systems/s1", days: 2, tone: "danger" }],
  ...over,
});

afterEach(() => {
  cleanup();
  push.mockClear();
});

const rowTitles = () => [...screen.getByRole("tabpanel").querySelectorAll("li")].map((li) => li.querySelector("b")?.textContent);

describe("HomeCommandCenter: hero (#226)", () => {
  it("greets by first name, shows the lede, the number that need the user and a ring with a count per lane", () => {
    render(<HomeCommandCenter view={view()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^(Welcome|Good (morning|afternoon|evening)), Marcus\.$/);
    expect(screen.getByText("Track the Systems you own.")).toBeInTheDocument();
    expect(screen.getByText("3 need you")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 of 5 tasks are your move" })).toBeInTheDocument();
    const lanes = screen.getByRole("list", { name: "Tasks by lane" });
    expect(within(lanes).getByText("Your move").closest("li")).toHaveTextContent("3");
    expect(within(lanes).getByText("Waiting on others").closest("li")).toHaveTextContent("1");
    expect(within(lanes).getByText("Coming up").closest("li")).toHaveTextContent("1");
  });

  it("says a single task needs the user, and shows the scope chip only when there is a scope", () => {
    const { rerender } = render(<HomeCommandCenter view={view({ tasks: [TASKS[0]] })} />);
    expect(screen.getByText("1 needs you")).toBeInTheDocument();
    expect(screen.queryByText(/Scope:/)).not.toBeInTheDocument();
    rerender(<HomeCommandCenter view={view({ scope: "Finance · DORA" })} />);
    expect(screen.getByText("Scope: Finance · DORA")).toBeInTheDocument();
  });

  it("says all caught up, and draws no ring, when nothing is the user's move", () => {
    render(<HomeCommandCenter view={view({ tasks: [] })} />);
    expect(screen.getByText(/all caught up/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /tasks are your move/ })).not.toBeInTheDocument();
  });
});

describe("HomeCommandCenter: stat cards", () => {
  it("makes a card with a task kind a toggle button that filters the list, and a plain card a non-button", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    expect(screen.queryByRole("button", { name: /Controls/ })).not.toBeInTheDocument();
    expect(screen.getByText("124")).toBeInTheDocument();

    const attention = screen.getByRole("button", { name: /Needing attention/ });
    expect(attention).toHaveAttribute("aria-pressed", "false");
    await user.click(attention);
    expect(attention).toHaveAttribute("aria-pressed", "true");
    expect(rowTitles()).toEqual(["Payroll Portal", "HR Archive"]);
    expect(screen.getByRole("tab", { name: /Systems/ })).toHaveAttribute("aria-selected", "true");

    await user.click(attention);
    expect(attention).toHaveAttribute("aria-pressed", "false");
    expect(rowTitles()).toHaveLength(5);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
  });

  it("moves the pressed state with the card clicked, and a tab click clears it", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    const attention = screen.getByRole("button", { name: /Needing attention/ });
    const questions = screen.getByRole("button", { name: /Open questions/ });
    await user.click(attention);
    await user.click(questions);
    expect(attention).toHaveAttribute("aria-pressed", "false");
    expect(questions).toHaveAttribute("aria-pressed", "true");
    expect(rowTitles()).toEqual(["A.5.23 Cloud services", "A.8.5 Secure authentication"]);
    await user.click(screen.getByRole("tab", { name: /Check-ups/ }));
    expect(questions).toHaveAttribute("aria-pressed", "false");
    expect(rowTitles()).toEqual(["A.8.15 Logging"]);
  });

  it("draws a sparkline for a card with a trend, and none for one without", () => {
    const { container } = render(<HomeCommandCenter view={view()} />);
    expect(container.querySelectorAll(".hc-stat svg polyline")).toHaveLength(1);
  });
});

describe("HomeCommandCenter: My tasks", () => {
  it("groups by urgency with a heading per lane, the most urgent first, and a link per row", () => {
    render(<HomeCommandCenter view={view()} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^Your move · 3/);
    expect(headings[1]).toMatch(/^Waiting on others · 1/);
    expect(headings[2]).toMatch(/^Coming up · 1/);
    // Within the lane: danger first, then by longest wait.
    expect(rowTitles().slice(0, 3)).toEqual(["Payroll Portal", "A.5.23 Cloud services", "A.8.5 Secure authentication"]);
    const link = screen.getByRole("link", { name: "Fix and resubmit: Payroll Portal" });
    expect(link).toHaveAttribute("href", "/x/s1");
  });

  it("shows tabs with counts, and Query as Queries", () => {
    render(<HomeCommandCenter view={view()} />);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["All5", "Systems2", "Queries2", "Check-ups1"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    screen.getByRole("tab", { name: /All/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Systems/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Systems/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Check-ups/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
  });

  it("filters by text over title, subtitle and status, and Clear filters brings everything back", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    await user.type(screen.getByRole("searchbox", { name: "Filter tasks" }), "rejected");
    expect(rowTitles()).toEqual(["Payroll Portal"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "no such task");
    expect(screen.getByText("No tasks match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowTitles()).toHaveLength(5);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("focuses the filter on '/', but not while typing in a field", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    await user.keyboard("/");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await user.keyboard("a/b");
    expect(screen.getByRole("searchbox")).toHaveValue("a/b");
  });

  it("orders newest first and oldest first, a task without a date last, and drops the lane headings", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Order" }), "new");
    expect(rowTitles()).toEqual(["Payroll Portal", "A.8.5 Secure authentication", "A.8.15 Logging", "A.5.23 Cloud services", "HR Archive"]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    await user.selectOptions(screen.getByRole("combobox", { name: "Order" }), "old");
    expect(rowTitles()).toEqual(["A.5.23 Cloud services", "A.8.15 Logging", "A.8.5 Secure authentication", "Payroll Portal", "HR Archive"]);
  });

  it("shows 'Nothing needs you' with the primary shortcut when there are no tasks", () => {
    render(<HomeCommandCenter view={view({ tasks: [] })} />);
    expect(screen.getByText("Nothing needs you")).toBeInTheDocument();
    const [link] = screen.getAllByRole("link", { name: /Create a System/ });
    expect(link).toHaveAttribute("href", "/systems/new");
    expect(screen.queryByRole("searchbox", { name: "x" })).not.toBeInTheDocument();
  });

  it("keeps a stat-filtered kind with no task as an empty, clearable list", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view({ tasks: [TASKS[1]] })} />);
    await user.click(screen.getByRole("button", { name: /Needing attention/ }));
    expect(screen.getByText("No tasks match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowTitles()).toEqual(["A.8.5 Secure authentication"]);
    expect(screen.getByRole("button", { name: /Needing attention/ })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("HomeCommandCenter: side column", () => {
  it("shows the picture, the shortcuts with the primary one marked, and the activity with a link to the System", () => {
    render(<HomeCommandCenter view={view()} />);
    expect(screen.getByRole("heading", { name: "Users by role" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a System/ })).toHaveClass("primary");
    expect(screen.getByRole("link", { name: /Framework coverage/ })).toHaveAttribute("href", "/frameworks");
    expect(screen.getByText("2 shortcuts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Payroll Portal" })).toHaveAttribute("href", "/systems/s1");
    expect(screen.getByText(/recorded an Approval decision/)).toBeInTheDocument();
  });

  it("says nothing changed when there is no activity", () => {
    render(<HomeCommandCenter view={view({ activity: [] })} />);
    expect(screen.getByText("Nothing changed in the last two weeks.")).toBeInTheDocument();
  });
});

describe("HomeCommandCenter: Ctrl+K palette", () => {
  it("opens with Ctrl+K as a dialog, lists tasks and pages, filters by typing, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Jump to" });
    expect(dialog).toBeInTheDocument();
    const box = within(dialog).getByRole("combobox");
    expect(box).toHaveFocus();
    expect(within(dialog).getAllByRole("option")).toHaveLength(7);

    await user.type(box, "cloud");
    const options = within(dialog).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("A.5.23 Cloud services");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles with the same shortcut and with the button, and returns focus to where it was", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    const button = screen.getByRole("button", { name: "Ctrl K" });
    await user.click(button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("moves with the arrow keys, marks the active option and opens it on Enter", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    await user.keyboard("{Control>}k{/Control}");
    const box = within(screen.getByRole("dialog")).getByRole("combobox");
    const options = () => within(screen.getByRole("dialog")).getAllByRole("option");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[0].id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[2].id);
    await user.keyboard("{ArrowUp}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/x/q1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens an option on click, closes on a click outside, and says when nothing matches", async () => {
    const user = userEvent.setup();
    const { container } = render(<HomeCommandCenter view={view()} />);
    await user.keyboard("{Control>}k{/Control}");
    await user.click(screen.getByRole("option", { name: /Framework coverage/ }));
    expect(push).toHaveBeenCalledWith("/frameworks");

    await user.keyboard("{Control>}k{/Control}");
    await user.type(within(screen.getByRole("dialog")).getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    fireEvent.click(container.ownerDocument.querySelector(".hc-pal-scrim")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers no 'act as' group: only tasks and pages", async () => {
    const user = userEvent.setup();
    render(<HomeCommandCenter view={view()} />);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByText(/Act as/i)).not.toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("writes ages in words", () => {
    expect(ago(null)).toBe("—");
    expect(ago(0)).toBe("today");
    expect(ago(1)).toBe("yesterday");
    expect(ago(12)).toBe("12 d ago");
    expect(ago(90)).toBe("3 mo ago");
    expect(ago(800)).toBe("2 y ago");
  });

  it("filters and sorts tasks without touching the input", () => {
    const copy = [...TASKS];
    expect(visibleTasks(TASKS, { kind: "Query", q: "cloud", sort: "lane" }).map((t) => t.id)).toEqual(["q2"]);
    expect(TASKS).toEqual(copy);
  });

  it("offers every task and page, narrowed by what is typed", () => {
    const tiles = view().tiles;
    expect(paletteItems(TASKS, tiles, "").map((i) => i.group)).toEqual(["Tasks", "Tasks", "Tasks", "Tasks", "Tasks", "Pages", "Pages"]);
    expect(paletteItems(TASKS, tiles, "6 Frameworks").map((i) => i.label)).toEqual(["Framework coverage"]);
  });
});
