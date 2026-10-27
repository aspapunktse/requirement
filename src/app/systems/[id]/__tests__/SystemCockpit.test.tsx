import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCockpit } from "../SystemCockpit";
import { RISK_LEVELS, TAB_KEYS, type AttentionItem, type SystemPageView, type TabKey } from "../system-page-types";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.setConfig({ testTimeout: 20_000 });

const NOW = "2026-10-26T09:00:00.000Z";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const attentionItem = (n: number, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `item-${n}`,
  kind: "control",
  title: `A.${n} Control ${n}`,
  note: "Mandatory, no Assessment yet",
  tone: "danger",
  tab: "controls",
  ...over,
});

const view = (over: Partial<SystemPageView> = {}): SystemPageView => ({
  userId: "u-me",
  userName: "Marcus Lindqvist",
  role: "SYSTEM_OWNER",
  now: NOW,
  system: {
    id: "s1",
    name: "ServiceNow",
    vendor: "ServiceNow Inc",
    description: "IT service management.",
    status: "DRAFT",
    isProvider: false,
    ownerId: "u-me",
    ownerName: "Marcus Lindqvist",
    facets: [{ id: "f1", name: "SaaS" }],
    confidentiality: "HIGH",
    integrity: "MODERATE",
    availability: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    onboardedAt: null,
  },
  note: "Not submitted yet · Marcus Lindqvist is still assembling the System",
  nextStep: { kind: "submit", blockedBy: 0 },
  canChangeOwner: true,
  headline: { baseFramework: "ISO/IEC 27001:2022", met: 5, applicable: 8, controlsDone: 6, controlsTotal: 9, openRisks: 2 },
  frameworks: [
    { id: "fw-iso", label: "ISO/IEC 27001:2022", isBase: true, met: 5, partial: 2, notMet: 1, notApplicable: 3, applicable: 8 },
    { id: "fw-gdpr", label: "GDPR:2016", isBase: false, met: 1, partial: 0, notMet: 3, notApplicable: 0, applicable: 4 },
  ],
  controls: {
    total: 9,
    done: 6,
    byStatus: { FULFILLED: 4, WAIVED: 1, IN_PROGRESS: 1, NOT_STARTED: 2, NOT_APPLICABLE: 1 },
    bySource: { organization: 2, "provider-full": 1, "provider-shared": 1, system: 5 },
  },
  attention: [attentionItem(1), attentionItem(2, { kind: "risk", title: "Weak passwords", tab: "risks", note: "High Risk, open" })],
  risks: { grid: RISK_LEVELS.map((_, s) => RISK_LEVELS.map((__, l) => (s === 3 && l === 0 ? 1 : s === 2 && l === 2 ? 1 : 0))), open: 2, mitigated: 1, accepted: 0 },
  classification: { facets: ["SaaS"], businessUnits: ["Finance"], frameworkScope: ["GDPR:2016"] },
  activity: [
    { id: "e1", who: "You", what: "submitted a System for review", detail: "Submitted for review", tone: "accent", at: "2026-10-24T09:00:00.000Z" },
    { id: "e2", who: "The system", what: "changed a Risk's status", detail: "Opened a Risk", tone: "warn", at: "2026-10-26T08:00:00.000Z" },
  ],
  timeline: [],
  counts: { controls: 9, requirements: 2, openRisks: 2, providers: 1 },
  controlList: [
    { id: "c1", code: "A.5.1", title: "Policies for information security" },
    { id: "c2", code: "A.8.24", title: "Use of cryptography" },
  ],
  ...over,
});

const PANELS = Object.fromEntries(TAB_KEYS.filter((key) => key !== "overview").map((key) => [key, <p key={key}>Section {key}</p>])) as Record<Exclude<TabKey, "overview">, React.ReactNode>;
const renderCockpit = (over: Partial<SystemPageView> = {}) => render(<SystemCockpit view={view(over)} panels={PANELS} />);
const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
const visiblePanel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  window.history.replaceState(null, "", "/systems/s1");
  vi.stubGlobal("fetch", vi.fn(() => json({})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("header (#243)", () => {
  it("shows the breadcrumb, the identity, the lifecycle and the headline figures", () => {
    renderCockpit();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Systems" })).toHaveAttribute("href", "/systems");
    expect(within(crumbs).getByText("ServiceNow")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "ServiceNow" })).toBeInTheDocument();
    expect(screen.getAllByText("Draft")).toHaveLength(2); // the status chip and the lifecycle step
    expect(screen.getByText("Owned by Marcus Lindqvist")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("SaaS", { selector: ".facet" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Confidentiality high, Integrity moderate, Availability not classified" })).toBeInTheDocument();
    expect(screen.getByText("Vendor ServiceNow Inc")).toBeInTheDocument();
    expect(screen.getByText("IT service management.")).toBeInTheDocument();

    const stepper = screen.getByRole("list", { name: "Lifecycle" });
    expect(within(stepper).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Draft", "In review", "Approved", "Onboarded"]);
    expect(within(stepper).getByText("Draft")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/Not submitted yet/)).toBeInTheDocument();

    const figures = screen.getByLabelText("Headline figures").textContent;
    expect(figures).toContain("62.5%");
    expect(figures).toContain("5/8");
    expect(figures).toContain("6/9");
  });

  it("marks a Rejected System on the In review step and a Provider with a chip", () => {
    renderCockpit({ system: { ...view().system, status: "REJECTED", isProvider: true }, nextStep: { kind: "none" } });
    const stepper = screen.getByRole("list", { name: "Lifecycle" });
    expect(within(stepper).getByText("Rejected")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Provider")).toBeInTheDocument();
  });

  it("offers Submit for review on a Draft, which posts to the submit API and refreshes", async () => {
    renderCockpit();
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(fetch).toHaveBeenCalledWith("/api/systems/s1/submit", { method: "POST" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("disables Submit for review while mandatory Controls are not addressed, with a hint that opens the Controls tab", async () => {
    renderCockpit({ nextStep: { kind: "submit", blockedBy: 41 } });
    const submit = screen.getByRole("button", { name: "Submit for review" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("41 mandatory Controls not addressed");
    await userEvent.click(submit);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "41 mandatory Controls not addressed" }));
    expect(window.location.hash).toBe("#controls");
  });

  it("says 'Control' for a single one", () => {
    renderCockpit({ nextStep: { kind: "submit", blockedBy: 1 } });
    expect(screen.getByText("1 mandatory Control not addressed")).toBeInTheDocument();
  });

  it("shows the API's refusal and does not refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Cannot submit: mandatory Controls not yet addressed: A.1" }, 400)));
    renderCockpit();
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot submit: mandatory Controls not yet addressed: A.1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers Mark Onboarded on an Approved System", async () => {
    renderCockpit({ system: { ...view().system, status: "APPROVED" }, nextStep: { kind: "onboard" } });
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark Onboarded" }));
    expect(fetch).toHaveBeenCalledWith("/api/systems/s1/onboard", { method: "POST" });
  });

  it("offers nothing when no step is the user's", () => {
    renderCockpit({ nextStep: { kind: "none" } });
    for (const name of ["Submit for review", "Mark Onboarded", "Reject", "Approve…"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("offers Reject and Approve… on a System In Review, and approves with a comment for the one open step", async () => {
    renderCockpit({
      system: { ...view().system, status: "IN_REVIEW", ownerId: "u-other" },
      nextStep: { kind: "decide", steps: [{ reviewGroupId: null, name: "Base review" }] },
    });
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    const dialog = screen.getByRole("dialog", { name: "Approve ServiceNow" });
    expect(within(dialog).getByText("Review Step: Base review")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Comment" }), "Looks fine");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/systems/s1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "APPROVED", comment: "Looks fine", reviewGroupId: null }),
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects the chosen Review Step when the user may decide several", async () => {
    renderCockpit({
      system: { ...view().system, status: "IN_REVIEW" },
      nextStep: { kind: "decide", steps: [{ reviewGroupId: null, name: "Base review" }, { reviewGroupId: "g1", name: "GDPR Review Group" }] },
    });
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog", { name: "Reject ServiceNow" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Review Step" }), "GDPR Review Group");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Comment" }), "No");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ decision: "REJECTED", comment: "No", reviewGroupId: "g1" });
  });

  it("keeps the dialog open and shows the API's refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "You can't decide this Review Step" }, 403)));
    renderCockpit({ system: { ...view().system, status: "IN_REVIEW" }, nextStep: { kind: "decide", steps: [{ reviewGroupId: null, name: "Base review" }] } });
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "ok");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't decide this Review Step");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("holds Change owner in the ⋯ menu, for whoever may change the owner", async () => {
    const { unmount } = renderCockpit();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Change owner" }));
    expect(screen.getByRole("dialog", { name: "Change owner" })).toBeInTheDocument();
    unmount();

    renderCockpit({ canChangeOwner: false });
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("goes to the Systems list after a non-Admin hands the System away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).includes("owner-candidates")
          ? json({ users: [{ id: "u-risk", name: "Risa Risk", email: "r@example.com", role: "RISK_OWNER" }] })
          : json({ changed: [{ id: "s1", name: "ServiceNow" }], unchanged: [] }),
      ),
    );
    renderCockpit();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Change owner" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-risk");
    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/systems"));
  });
});

describe("the Approval panel after a header action (#243)", () => {
  // A stand-in that reads once on mount, as the real panel does.
  const mounts = vi.fn();
  function Probe() {
    useEffect(() => {
      mounts();
    }, []);
    return <p>Approval history</p>;
  }
  const withProbe = (over: Partial<SystemPageView>) => render(<SystemCockpit view={view(over)} panels={{ ...PANELS, activity: <Probe /> }} />);
  afterEach(() => mounts.mockClear());

  it("is read again after a decision made in the header", async () => {
    withProbe({ system: { ...view().system, status: "IN_REVIEW" }, nextStep: { kind: "decide", steps: [{ reviewGroupId: null, name: "Base review" }] } });
    expect(mounts).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Approve…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Comment" }), "ok");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mounts).toHaveBeenCalledTimes(2));
  });

  it("is read again after Submit for review, and not after a refused one", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "no" }, 400)));
    withProbe({});
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await screen.findByRole("alert");
    expect(mounts).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(() => json({})));
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mounts).toHaveBeenCalledTimes(2));
  });
});

describe("tabs (#243)", () => {
  it("lists the seven tabs with their counts, the open Risks highlighted", () => {
    renderCockpit();
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual(["Overview", "Controls9", "Requirements2", "Risks2", "Providers1", "Profile", "Approval and activity"]);
    expect(tab(/^Risks/).querySelector(".n")).toHaveClass("hot");
    expect(tab(/^Controls/).querySelector(".n")).not.toHaveClass("hot");
  });

  it("does not highlight Risks when none is open", () => {
    renderCockpit({ counts: { ...view().counts, openRisks: 0 } });
    expect(tab(/^Risks/).querySelector(".n")).not.toHaveClass("hot");
  });

  it("starts on the Overview and shows one panel at a time", () => {
    renderCockpit();
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(visiblePanel()).toHaveAttribute("id", "sc-panel-overview");
    expect(window.location.hash).toBe("");
    // The other sections stay mounted, so their state survives a switch.
    expect(screen.getByText("Section controls")).not.toBeVisible();
  });

  it("switches on click and keeps the tab in the URL hash", async () => {
    renderCockpit();
    await userEvent.click(tab(/^Controls/));
    expect(window.location.hash).toBe("#controls");
    expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true");
    expect(visiblePanel()).toHaveAttribute("id", "sc-panel-controls");
    expect(screen.getByText("Section controls")).toBeVisible();
    await userEvent.click(tab("Approval and activity"));
    expect(window.location.hash).toBe("#activity");
    expect(screen.getByText("Section activity")).toBeVisible();
  });

  it("opens the tab the URL names", () => {
    window.history.replaceState(null, "", "/systems/s1#risks");
    renderCockpit();
    expect(tab(/^Risks/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Section risks")).toBeVisible();
  });

  it("opens the Controls tab for a hash that names a Control (#244)", () => {
    window.history.replaceState(null, "", "/systems/s1#controls/A.5.13");
    renderCockpit();
    expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Section controls")).toBeVisible();
  });

  it("falls back to the Overview for a hash that is no tab", () => {
    window.history.replaceState(null, "", "/systems/s1#nonsense");
    renderCockpit();
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });

  it("follows Back and Forward", async () => {
    renderCockpit();
    await userEvent.click(tab(/^Controls/));
    await userEvent.click(tab(/^Profile/));
    act(() => window.history.back());
    await waitFor(() => expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true"));
    act(() => window.history.forward());
    await waitFor(() => expect(tab(/^Profile/)).toHaveAttribute("aria-selected", "true"));
  });

  it("moves with the arrow keys, wrapping round, and with Home and End; only the selected tab is in the tab order", async () => {
    renderCockpit();
    tab("Overview").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Controls/)).toHaveFocus();
    expect(tab("Overview")).toHaveAttribute("tabindex", "-1");
    expect(tab(/^Controls/)).toHaveAttribute("tabindex", "0");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(tab("Approval and activity")).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#activity");
    await userEvent.keyboard("{ArrowRight}");
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    expect(tab("Approval and activity")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(tab("Overview")).toHaveFocus();
  });

  it("refreshes the page's data when coming back to the Overview from another tab", async () => {
    renderCockpit();
    await userEvent.click(tab(/^Controls/));
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(tab("Overview"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("Overview tiles (#243)", () => {
  it("draws the ring for the base Framework and switches it when another Framework is chosen", async () => {
    renderCockpit();
    expect(screen.getByRole("img", { name: "ISO/IEC 27001:2022: 5 of 8 Requirements met" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Frameworks in scope" });
    expect(within(list).getByRole("button", { name: /ISO\/IEC 27001:2022/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(list).getByRole("button", { name: /GDPR:2016/ }));
    expect(screen.getByRole("img", { name: "GDPR:2016: 1 of 4 Requirements met" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /GDPR:2016/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(list).getByRole("button", { name: /ISO\/IEC 27001:2022/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("25%", { selector: ".hc-ring-num" })).toBeInTheDocument();
  });

  it("explains an empty Compliance tile", () => {
    renderCockpit({ frameworks: [] });
    expect(screen.getByText("No Framework is in scope for this System yet.")).toBeInTheDocument();
  });

  it("shows the done count, the status legend and where the status comes from", () => {
    renderCockpit();
    const tile = screen.getByRole("region", { name: "Controls" });
    expect(within(tile).getByText("6")).toBeInTheDocument();
    expect(within(tile).getByRole("img", { name: /^Controls by status: 4 Fulfilled, 1 Waived, 1 In progress, 2 Not started, 1 Not applicable$/ })).toBeInTheDocument();
    const sources = within(tile).getByRole("list", { name: "Where the status comes from" });
    expect(within(sources).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Organization2", "Provider, full1", "Provider, shared1", "This System5"]);
  });

  it("sends 'Open Controls', 'All Requirements', 'Risk register', 'Change' and 'All' to their tabs", async () => {
    renderCockpit();
    for (const [name, hash] of [
      ["Open Controls →", "#controls"],
      ["All Requirements →", "#requirements"],
      ["Risk register →", "#risks"],
      ["Change →", "#profile"],
      ["All →", "#activity"],
    ] as const) {
      await userEvent.click(tab("Overview"));
      await userEvent.click(screen.getByRole("button", { name }));
      expect(window.location.hash, name).toBe(hash);
    }
  });

  it("lists Needs attention items with an Open button to the right tab", async () => {
    renderCockpit();
    const tile = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(tile).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(tile).getByRole("button", { name: "Open: Weak passwords" }));
    expect(window.location.hash).toBe("#risks");
    await userEvent.click(tab("Overview"));
    await userEvent.click(within(tile).getByRole("button", { name: "Open: A.1 Control 1" }));
    expect(window.location.hash).toBe("#controls");
  });

  it("opens the Control's drawer for an item that names a Control (#244)", async () => {
    renderCockpit({
      attention: [
        attentionItem(1, { controlCode: "A.5.13" }),
        attentionItem(2, { kind: "query", title: "Which version?", controlCode: "A.8.24" }),
      ],
    });
    const tile = screen.getByRole("region", { name: /Needs attention/ });
    await userEvent.click(within(tile).getByRole("button", { name: "Open: A.1 Control 1" }));
    expect(window.location.hash).toBe("#controls/A.5.13");
    expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tab("Overview"));
    await userEvent.click(within(tile).getByRole("button", { name: "Open: Which version?" }));
    expect(window.location.hash).toBe("#controls/A.8.24");
  });

  it("shows the first six items, then 'N more →' which shows the rest", async () => {
    renderCockpit({ attention: Array.from({ length: 9 }, (_, i) => attentionItem(i + 1)) });
    const tile = screen.getByRole("region", { name: /Needs attention/ });
    expect(within(tile).getAllByRole("listitem")).toHaveLength(6);
    await userEvent.click(within(tile).getByRole("button", { name: "3 more →" }));
    expect(within(tile).getAllByRole("listitem")).toHaveLength(9);
    await userEvent.click(within(tile).getByRole("button", { name: "Show fewer" }));
    expect(within(tile).getAllByRole("listitem")).toHaveLength(6);
  });

  it("says when nothing needs attention", () => {
    renderCockpit({ attention: [] });
    expect(screen.getByText("Nothing needs attention on this System.")).toBeInTheDocument();
  });

  it("draws the Risk grid, the tally, the Classification tags and the recent activity", () => {
    renderCockpit();
    const risks = screen.getByRole("region", { name: "Risks" });
    expect(within(risks).getByRole("img", { name: "Open Risks by severity and likelihood: 2 open" })).toBeInTheDocument();
    expect(within(risks).getByText("Open").previousElementSibling).toHaveTextContent("2");
    expect(within(risks).getByText("Mitigated").previousElementSibling).toHaveTextContent("1");
    const classification = screen.getByRole("region", { name: "Classification" });
    expect(within(classification).getByRole("img", { name: "Availability: Not classified" })).toBeInTheDocument();
    expect(within(classification).getByRole("img", { name: "Confidentiality: High" })).toBeInTheDocument();
    for (const tag of ["SaaS", "Finance", "GDPR:2016"]) expect(within(classification).getByText(tag)).toBeInTheDocument();
    const activity = screen.getByRole("region", { name: "Recent activity" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(2);
    expect(within(activity).getByText("2 d ago")).toBeInTheDocument();
    expect(within(activity).getByText("today")).toBeInTheDocument();
  });
});

describe("Ctrl+K palette (#243)", () => {
  it("lists the tabs and every Control, and opens the Controls tab for a Control", async () => {
    renderCockpit();
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Jump to" });
    expect(within(dialog).getAllByRole("option")).toHaveLength(TAB_KEYS.length + 2);
    await userEvent.type(within(dialog).getByRole("combobox"), "A.8.24");
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The palette opens that Control's drawer on the Controls tab (#244).
    expect(window.location.hash).toBe("#controls/A.8.24");
    expect(tab(/^Controls/)).toHaveAttribute("aria-selected", "true");
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a tab from the palette", async () => {
    renderCockpit();
    await userEvent.click(screen.getByRole("button", { name: "Ctrl K" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByRole("combobox"), "Providers");
    await userEvent.keyboard("{Enter}");
    expect(window.location.hash).toBe("#providers");
  });
});
