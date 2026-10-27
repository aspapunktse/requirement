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
  mitigationPlan: null,
  owner: null,
  controlAssessment: null,
  checkUp: null,
  ...over,
});

const RISKS: Risk[] = [
  risk({ id: "r1", title: "Weak passwords", severity: "CRITICAL", likelihood: "HIGH", owner: { id: "u1", name: "Elena Voss" } }),
  risk({ id: "r2", title: "Unpatched server", severity: "HIGH", likelihood: "MEDIUM", status: "MITIGATED", mitigationPlan: "Patch monthly" }),
  risk({ id: "r3", title: "From a finding", checkUp: { id: "cu1" }, controlAssessment: { id: "a1", control: { id: "c1", code: "A.5.1", title: "Policies" } } }),
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
    expect(table.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Risk", "Severity", "Likelihood", "Status", "Owner"]);
    const row = within(table.getByRole("button", { name: /Weak passwords/ }).closest("tr")!);
    expect(row.getByText("Critical")).toBeInTheDocument();
    expect(row.getByText("High")).toBeInTheDocument();
    expect(row.getByText("Open")).toBeInTheDocument();
    expect(row.getByText("Elena Voss")).toBeInTheDocument();
    expect(within(table.getByRole("button", { name: /Unpatched server/ }).closest("tr")!).getByText("Unassigned")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/risks");
  });

  it("hides Likelihood and Owner at phone width through the hide-sm class", async () => {
    renderRisks();
    const table = await screen.findByRole("table");
    const hidden = within(table).getAllByRole("columnheader").filter((header) => header.className.includes("hide-sm")).map((header) => header.textContent);
    expect(hidden).toEqual(["Likelihood", "Owner"]);
  });

  it("draws the grid of open Risks only", async () => {
    renderRisks();
    // Open: Weak passwords (Critical x High) and From a finding (Medium x Low). The Mitigated one is left out.
    expect(await screen.findByRole("img", { name: "Open Risks by severity and likelihood: 2 open" })).toBeInTheDocument();
    expect(screen.getByTitle("Critical severity, high likelihood: 1")).toHaveTextContent("1");
    expect(screen.getByTitle("High severity, medium likelihood: 0")).toHaveTextContent("");
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
