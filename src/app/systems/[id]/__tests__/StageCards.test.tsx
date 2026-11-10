import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemDocumentRow } from "@/lib/system-documentation";
import type { RiskAnalysisView } from "@/lib/risk-analysis";
import { RiskAnalysisRecord, RiskSummary, StageDocumentation } from "../StageCards";

vi.setConfig({ testTimeout: 20_000 });

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const doc = (over: Partial<SystemDocumentRow> & { id: string; name: string }): SystemDocumentRow => ({
  description: null,
  stage: "FIRST_DOCUMENTATION",
  tracks: ["FULL"],
  link: null,
  provided: false,
  file: null,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

const DOCUMENTS: SystemDocumentRow[] = [
  doc({ id: "d1", name: "Architecture description", link: "https://example.com/arch", provided: true, updatedAt: "2026-11-01T10:00:00.000Z", updatedBy: { id: "u1", name: "Elena Voss" } }),
  doc({
    id: "d2",
    name: "Pen test report",
    file: { fileName: "pentest.pdf", contentType: "application/pdf", size: 2048, uploadedAt: "2026-11-02T10:00:00.000Z" },
    provided: true,
  }),
  doc({ id: "d3", name: "Exit plan" }),
  doc({ id: "d4", name: "DPIA", stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] }),
  doc({ id: "d5", name: "Self-only second round", stage: "SECOND_ROUND", tracks: ["SELF"] }),
];

let fetchMock: ReturnType<typeof vi.fn>;

function serve(routes: Record<string, () => Promise<Response>>) {
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.endsWith(path));
    return hit ? routes[hit]() : respond({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => serve({}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StageDocumentation", () => {
  it("lists the stage's Document Requirements with status, link and file, and not other stages'", async () => {
    serve({ "/documents": () => respond({ documents: DOCUMENTS, canEdit: false }) });
    render(<StageDocumentation systemId="s1" stage="FIRST_DOCUMENTATION" track="FULL" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading documentation");
    const list = await screen.findByRole("list", { name: "First documentation Document Requirements" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("link", { name: "https://example.com/arch" })).toHaveAttribute("href", "https://example.com/arch");
    expect(within(items[0]).getByText("Provided")).toBeInTheDocument();
    expect(within(items[0]).getByText(/by Elena Voss/)).toBeInTheDocument();
    expect(within(items[1]).getByRole("link", { name: /pentest\.pdf/ })).toHaveAttribute("href", "/api/systems/s1/documents/d2/file");
    expect(within(items[2]).getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 provided")).toBeInTheDocument();
    expect(screen.queryByText("DPIA")).not.toBeInTheDocument();
    // Read-only: nothing to type into or upload, and no pointer to the editing tab for someone who can't edit.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Documentation tab" })).not.toBeInTheDocument();
  });

  it("filters the second round by the System's Track, and shows every requirement while there is no Track", async () => {
    serve({ "/documents": () => respond({ documents: DOCUMENTS, canEdit: true }) });
    const { unmount } = render(<StageDocumentation systemId="s1" stage="SECOND_ROUND" track="FULL" />);
    const list = await screen.findByRole("list", { name: "Second round Document Requirements" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("DPIA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documentation tab" })).toBeInTheDocument();
    unmount();

    render(<StageDocumentation systemId="s1" stage="SECOND_ROUND" track={null} />);
    expect(await within(await screen.findByRole("list", { name: "Second round Document Requirements" })).findAllByRole("listitem")).toHaveLength(2);
  });

  it("says so when no Document Requirement applies at the stage", async () => {
    serve({ "/documents": () => respond({ documents: [DOCUMENTS[3]], canEdit: false }) });
    render(<StageDocumentation systemId="s1" stage="FIRST_DOCUMENTATION" track="FULL" />);
    expect(await screen.findByText("No Document Requirements apply at this stage.")).toBeInTheDocument();
  });

  it("shows an error with a way to try again when the read fails", async () => {
    serve({ "/documents": () => respond({ error: "no" }, 500) });
    render(<StageDocumentation systemId="s1" stage="FIRST_DOCUMENTATION" track="FULL" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the documentation");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

const analysis = (over: Partial<RiskAnalysisView> = {}): RiskAnalysisView => ({
  id: "a1",
  heldOn: "2026-11-05",
  notes: "Walked the register.",
  participants: [{ id: "u1", name: "Elena Voss" }],
  outsiders: ["Vendor rep"],
  reviewedRisks: [{ id: "r1", title: "Vendor lock-in", severity: "HIGH", status: "OPEN", ownerId: "u1" }],
  raisedRisks: [{ id: "r2", title: "No exit plan", severity: "MEDIUM", status: "OPEN", ownerId: null }],
  recordedBy: { id: "u1", name: "Elena Voss" },
  createdAt: "2026-11-05T10:00:00.000Z",
  completedAt: null,
  completedBy: null,
  ...over,
});

describe("RiskAnalysisRecord", () => {
  it("shows the latest analysis read-only, with its Risks and what is not done", async () => {
    serve({ "/risk-analyses": () => respond({ riskAnalyses: [analysis(), analysis({ id: "a0", heldOn: "2026-10-01" })] }) });
    render(<RiskAnalysisRecord systemId="s1" />);
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Elena Voss, Vendor rep")).toBeInTheDocument();
    expect(screen.getByText("Walked the register.")).toBeInTheDocument();
    const risks = screen.getByRole("list", { name: "Risks in this analysis" });
    expect(within(risks).getByText("Vendor lock-in")).toBeInTheDocument();
    expect(within(risks).getByText("Raised")).toBeInTheDocument();
    expect(screen.getByText("Not done: 1 open Risk without a Risk owner.")).toBeInTheDocument();
    expect(screen.getByText(/1 earlier analysis is/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record Risk Analysis|Complete|Edit/ })).not.toBeInTheDocument();
  });

  it("marks a completed analysis done", async () => {
    serve({
      "/risk-analyses": () =>
        respond({ riskAnalyses: [analysis({ completedAt: "2026-11-06T10:00:00.000Z", completedBy: { id: "u1", name: "Elena Voss" }, raisedRisks: [], notes: "" })] }),
    });
    render(<RiskAnalysisRecord systemId="s1" />);
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("✓ Every open Risk here has a Risk owner.")).toBeInTheDocument();
  });

  it("has an empty state that points to the Risks tab, and an error state", async () => {
    serve({ "/risk-analyses": () => respond({ riskAnalyses: [] }) });
    const { unmount } = render(<RiskAnalysisRecord systemId="s1" />);
    expect(await screen.findByText("No Risk Analysis recorded yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Risks tab" })).toBeInTheDocument();
    unmount();

    serve({ "/risk-analyses": () => respond({ error: "no" }, 500) });
    render(<RiskAnalysisRecord systemId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Risk Analysis");
  });
});

const risk = (id: string, severity: string, source: string, status = "OPEN", ownerId: string | null = "u1") => ({
  id,
  title: id,
  description: "",
  severity,
  likelihood: "LOW",
  status,
  source,
  mitigationPlan: null,
  ownerId,
  owner: ownerId ? { id: ownerId, name: "Owner" } : null,
  controlAssessment: null,
});

describe("RiskSummary", () => {
  it("counts open Risks by severity and by Risk Source, leaving closed ones out", async () => {
    serve({
      "/risks": () =>
        respond({
          risks: [
            risk("a", "HIGH", "AD_HOC"),
            risk("b", "HIGH", "AUDIT_FINDING", "OPEN", null),
            risk("c", "LOW", "AD_HOC"),
            risk("d", "CRITICAL", "AD_HOC", "CLOSED"),
          ],
        }),
    });
    render(<RiskSummary systemId="s1" />);
    expect(await screen.findByText(/3 open Risks · 1 without a Risk owner/)).toBeInTheDocument();
    const key = screen.getByRole("list", { name: "Open Risks by severity" });
    expect(within(key).getByText("High").closest("li")).toHaveTextContent("High 2");
    expect(within(key).getByText("Critical").closest("li")).toHaveTextContent("Critical 0");
    const adHoc = screen.getByRole("row", { name: /Ad hoc/ });
    expect(within(adHoc).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["·", "1", "·", "1", "2"]);
  });

  it("has empty and error states", async () => {
    serve({ "/risks": () => respond({ risks: [] }) });
    const { unmount } = render(<RiskSummary systemId="s1" />);
    expect(await screen.findByText("No open Risks.")).toBeInTheDocument();
    unmount();

    serve({ "/risks": () => respond({ error: "no" }, 500) });
    render(<RiskSummary systemId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Risks");
  });
});
