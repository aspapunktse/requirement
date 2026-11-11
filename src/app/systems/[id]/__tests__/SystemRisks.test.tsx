import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Risk } from "@/components/RiskList";
import { SystemRisks } from "../SystemRisks";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const risk = (over: Partial<Risk> & { id: string; title: string }): Risk => ({
  description: "Something could go wrong",
  severity: "MEDIUM",
  likelihood: "LOW",
  status: "OPEN",
  source: "AD_HOC",
  mitigationPlan: null,
  owner: null,
  controlAssessment: null,
  checkUp: null,
  ...over,
});

const RISKS: Risk[] = [
  risk({ id: "r1", title: "Weak passwords", severity: "CRITICAL", likelihood: "HIGH", owner: { id: "u1", name: "Elena Voss" } }),
  risk({ id: "r2", title: "Unpatched server", severity: "HIGH", likelihood: "MEDIUM", status: "MITIGATED", mitigationPlan: "Patch monthly" }),
  risk({ id: "r3", title: "From a finding", checkUp: { id: "cu1" }, source: "AUDIT_FINDING", controlAssessment: { id: "a1", control: { id: "c1", code: "A.5.1", title: "Policies" } } }),
];

let fetchMock: ReturnType<typeof vi.fn>;
let risks: Risk[];

beforeEach(() => {
  refresh.mockClear();
  risks = RISKS;
  fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => (init?.method === "POST" ? respond({ risk: {} }, 201) : respond({ risks })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderRisks = (props: Partial<React.ComponentProps<typeof SystemRisks>> = {}) =>
  render(<SystemRisks systemId="s1" canLog canManageStatus canOpenCheckUp {...props} />);

describe("the Risk register", () => {
  it("loads the Risks and shows them in a table of Risk, Severity, Likelihood, Status and Owner", async () => {
    renderRisks();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Risks");
    const table = within(await screen.findByRole("table"));
    expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Risk", "Severity", "Likelihood", "Status", "Owner", "Source"]);
    const row = within(table.getByRole("button", { name: /Weak passwords/ }).closest("tr")!);
    expect(row.getByText("Critical")).toBeInTheDocument();
    expect(row.getByText("High")).toBeInTheDocument();
    expect(row.getByText("Open")).toBeInTheDocument();
    expect(row.getByText("Elena Voss")).toBeInTheDocument();
    expect(row.getByText("Ad hoc")).toBeInTheDocument();
    expect(within(table.getByRole("button", { name: /Unpatched server/ }).closest("tr")!).getByText("Unassigned")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risks");
  });

  it("hides Likelihood and Owner at phone width through the hide-sm class", async () => {
    renderRisks();
    const table = await screen.findByRole("table");
    const hidden = within(table).getAllByRole("columnheader").filter((header) => header.className.includes("hide-sm")).map((header) => header.textContent);
    expect(hidden).toEqual(["Likelihood", "Owner", "Source"]);
  });

  it("draws the grid of open Risks only", async () => {
    renderRisks();
    // Open: Weak passwords (Critical x High) and From a finding (Medium x Low). The Mitigated one is left out.
    expect(await screen.findByRole("img", { name: "Open Risks by severity and likelihood: 2 open" })).toBeInTheDocument();
    expect(screen.getByTitle("Critical severity, high likelihood: 1")).toHaveTextContent("1");
    expect(screen.getByTitle("High severity, medium likelihood: 0")).toHaveTextContent("");
  });

  it("shows each Risk's source and filters the register by it (#322)", async () => {
    const user = userEvent.setup();
    renderRisks();
    const table = within(await screen.findByRole("table"));
    expect(within(table.getByRole("button", { name: /From a finding/ }).closest("tr")!).getByText("Audit finding")).toBeInTheDocument();

    const filter = screen.getByLabelText("Filter by Risk Source");
    expect(within(filter).getAllByRole("option").map((option) => option.textContent)).toEqual(["All sources", "Requirement non-conformance", "Audit finding", "Ad hoc"]);

    await user.selectOptions(filter, "AUDIT_FINDING");
    expect(screen.queryByRole("button", { name: /Weak passwords/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /From a finding/ })).toBeInTheDocument();

    await user.selectOptions(filter, "REQUIREMENT_NONCONFORMANCE");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No Risks from this source.")).toBeInTheDocument();

    await user.selectOptions(filter, "");
    expect(screen.getAllByRole("button", { name: /Weak passwords|Unpatched server|From a finding/ })).toHaveLength(3);
  });

  it("offers every User as a Risk's owner to those who assign owners and sends just the owner (#322, #360)", async () => {
    const user = userEvent.setup();
    renderRisks({ owners: [{ id: "u9", name: "Vera Viewer" }] });
    await user.click(await screen.findByRole("button", { name: /Unpatched server/ }));
    fetchMock.mockImplementation(() => respond({ risk: { ...RISKS[1], ownerId: "u9", owner: { id: "u9", name: "Vera Viewer" } } }));

    const group = within(screen.getByRole("group", { name: "Owner of Unpatched server" }));
    expect(group.getByRole("button", { name: "Save owner" })).toBeDisabled();
    await user.selectOptions(group.getByLabelText("Owner for Unpatched server"), "u9");
    await user.click(group.getByRole("button", { name: "Save owner" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risks/r2", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ ownerId: "u9" }) }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("clears the owner with Unassigned", async () => {
    const user = userEvent.setup();
    renderRisks({ owners: [{ id: "u1", name: "Elena Voss" }] });
    await user.click(await screen.findByRole("button", { name: /Weak passwords/ }));
    fetchMock.mockImplementation(() => respond({ risk: { ...RISKS[0], ownerId: null, owner: null } }));
    await user.selectOptions(screen.getByLabelText("Owner for Weak passwords"), "");
    await user.click(screen.getByRole("button", { name: "Save owner" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risks/r1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ ownerId: null }) }));
  });

  it("shows a Risk Facilitator the owner control but no status form (#362)", async () => {
    const user = userEvent.setup();
    renderRisks({ canLog: false, canManageStatus: false, canAssignOwner: true, owners: [{ id: "u9", name: "Vera Viewer" }] });
    await user.click(await screen.findByRole("button", { name: /Unpatched server/ }));
    expect(screen.getByLabelText("Owner for Unpatched server")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("shows the owner as text to those who may not assign one", async () => {
    const user = userEvent.setup();
    renderRisks({ canManageStatus: false, canAssignOwner: false, owners: [{ id: "u9", name: "Vera Viewer" }] });
    await user.click(await screen.findByRole("button", { name: /Weak passwords/ }));
    expect(screen.queryByLabelText("Owner for Weak passwords")).not.toBeInTheDocument();
    expect(screen.getByText(/Owner: Elena Voss/)).toBeInTheDocument();
  });

  it("opens the Risk a #risk-<id> link points at, with its row in view (#360)", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#risk-r2";
    try {
      renderRisks({ owners: [{ id: "u9", name: "Vera Viewer" }] });
      expect(await screen.findByLabelText("Owner for Unpatched server")).toBeInTheDocument();
      expect(screen.queryByLabelText("Owner for Weak passwords")).not.toBeInTheDocument();
      expect(document.getElementById("risk-r2")).not.toBeNull();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      window.location.hash = "";
    }
  });

  it("offers an owner on an ad hoc Risk to those who assign owners, and sends it (#360)", async () => {
    const user = userEvent.setup();
    renderRisks({ owners: [{ id: "u9", name: "Vera Viewer" }] });
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "+ Log Risk" }));
    const form = within(screen.getByRole("form", { name: "Log a Risk" }));
    await user.type(form.getByLabelText("Title"), "New one");
    await user.type(form.getByLabelText("Description"), "Because");
    await user.selectOptions(form.getByLabelText("Owner"), "u9");
    await user.click(form.getByRole("button", { name: "Log Risk" }));
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(call![1].body as string)).toMatchObject({ title: "New one", ownerId: "u9" });
  });

  it("offers no owner choice without owners", async () => {
    const user = userEvent.setup();
    renderRisks();
    await user.click(await screen.findByRole("button", { name: /Unpatched server/ }));
    expect(screen.queryByLabelText("Owner for Unpatched server")).not.toBeInTheDocument();
  });

  it("says so when no Risk is logged", async () => {
    risks = [];
    renderRisks();
    expect(await screen.findByText("No Risks logged for this System.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when the Risks can't be loaded, and loads them again on request", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => respond({ error: "x" }, 500));
    renderRisks();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Risks.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a Risk's row", () => {
  it("opens the Risk with its origin and the Check-up link for those who may read the audit", async () => {
    const user = userEvent.setup();
    renderRisks();
    await user.click(await screen.findByRole("button", { name: /From a finding/ }));
    expect(screen.getByText(/Originated from A\.5\.1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "see the finding" })).toHaveAttribute("href", "/check-ups/cu1");
  });

  it("leaves out the Check-up link for those who may not read the audit", async () => {
    const user = userEvent.setup();
    renderRisks({ canOpenCheckUp: false });
    await user.click(await screen.findByRole("button", { name: /From a finding/ }));
    expect(screen.getByText(/Opened by an Internal Audit Nonconformity/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "see the finding" })).not.toBeInTheDocument();
  });

  it("changes a Risk's status through the same PATCH and shows the new status in the table", async () => {
    const user = userEvent.setup();
    renderRisks();
    await user.click(await screen.findByRole("button", { name: /Weak passwords/ }));
    fetchMock.mockImplementation(() => respond({ risk: { ...RISKS[0], status: "ACCEPTED" } }));

    await user.selectOptions(screen.getByLabelText("Status for Weak passwords"), "ACCEPTED");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risks/r1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "ACCEPTED", mitigationPlan: null }) }));
    await waitFor(() => expect(within(screen.getByRole("button", { name: /Weak passwords/ }).closest("tr")!).getByText("Accepted")).toBeInTheDocument());
    // The header, the Overview and the timeline are read on the server.
    expect(refresh).toHaveBeenCalled();
  });

  it("shows no status form to those who may not manage statuses", async () => {
    const user = userEvent.setup();
    renderRisks({ canManageStatus: false });
    await user.click(await screen.findByRole("button", { name: /Weak passwords/ }));
    expect(screen.getByText("Something could go wrong")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status for Weak passwords")).not.toBeInTheDocument();
  });

  it("closes the Risk again", async () => {
    const user = userEvent.setup();
    renderRisks();
    const toggle = await screen.findByRole("button", { name: /Weak passwords/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Something could go wrong")).not.toBeInTheDocument();
  });
});

describe("+ Log Risk", () => {
  it("is only there for those who can log a Risk", async () => {
    renderRisks({ canLog: false });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "+ Log Risk" })).not.toBeInTheDocument();
  });

  it("opens the form, posts the Risk, closes and reads the register again", async () => {
    const user = userEvent.setup();
    renderRisks();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "+ Log Risk" }));
    const form = within(screen.getByRole("form", { name: "Log a Risk" }));

    await user.type(form.getByLabelText("Title"), "New Risk");
    await user.type(form.getByLabelText("Description"), "Because");
    await user.selectOptions(form.getByLabelText("Severity"), "HIGH");
    await user.click(form.getByRole("button", { name: "Log Risk" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1/risks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "New Risk", description: "Because", severity: "HIGH", likelihood: "MEDIUM" }) }),
    );
    await waitFor(() => expect(screen.queryByRole("form", { name: "Log a Risk" })).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter((call) => !call[1]?.method).length).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal and keeps the form", async () => {
    const user = userEvent.setup();
    renderRisks();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "+ Log Risk" }));
    fetchMock.mockImplementation(() => respond({ error: "Only the System's owner, a Risk Owner, or an Admin can log a Risk" }, 403));
    const form = within(screen.getByRole("form", { name: "Log a Risk" }));
    await user.type(form.getByLabelText("Title"), "New Risk");
    await user.type(form.getByLabelText("Description"), "Because");
    await user.click(form.getByRole("button", { name: "Log Risk" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Only the System's owner, a Risk Owner, or an Admin can log a Risk");
    expect(screen.getByRole("form", { name: "Log a Risk" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("names every field of the form", async () => {
    const user = userEvent.setup();
    renderRisks();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "+ Log Risk" }));
    const form = within(screen.getByRole("form", { name: "Log a Risk" }));
    expect(form.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(form.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(form.getByRole("combobox", { name: "Severity" })).toBeInTheDocument();
    expect(form.getByRole("combobox", { name: "Likelihood" })).toBeInTheDocument();
  });

  it("cancels without sending anything", async () => {
    const user = userEvent.setup();
    renderRisks();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "+ Log Risk" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Log a Risk" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
});

describe("the Risk Analyses card (#325)", () => {
  it("is not shown unless the page asks for it", async () => {
    renderRisks();
    await screen.findByRole("table");
    expect(screen.queryByRole("heading", { name: "Risk Analyses" })).not.toBeInTheDocument();
  });

  it("is shown below the register, offers the open Risks to review, and reads the register again after a meeting raised some", async () => {
    const user = userEvent.setup();
    renderRisks({ riskAnalyses: { canRecord: true }, owners: [{ id: "u1", name: "Elena Voss" }] });
    await screen.findByRole("table");
    await user.click(await screen.findByRole("button", { name: "+ Record Risk Analysis" }));
    const form = within(screen.getByRole("form", { name: "Record a Risk Analysis" }));
    // Only the open Risks (the mitigated one is left out) and the Users who may take part.
    expect(form.getByRole("checkbox", { name: "Weak passwords" })).toBeChecked();
    expect(form.getByRole("checkbox", { name: "From a finding" })).toBeChecked();
    expect(form.queryByRole("checkbox", { name: "Unpatched server" })).not.toBeInTheDocument();
    expect(form.getByRole("checkbox", { name: "Elena Voss" })).not.toBeChecked();
    const reads = () => fetchMock.mock.calls.filter((call) => call[0] === "/api/systems/s1/risks").length;
    const before = reads();
    await user.click(form.getByRole("button", { name: "Record Risk Analysis" }));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});
