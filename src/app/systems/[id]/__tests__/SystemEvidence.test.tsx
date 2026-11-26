import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessment, control, json, renderControls, renderDrawer, rowOf, stubApi } from "./controls-test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.setConfig({ testTimeout: 20_000 });

/** Evidence records in the Control drawer, and the stale badge on the Control row (#455). */

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "LINK",
  url: `https://wiki.example.com/${id}`,
  title: null,
  systemDocumentId: null,
  documentRequirementId: null,
  collectedAt: "2026-01-10T00:00:00.000Z",
  expiresAt: null,
  effectiveExpiresAt: null,
  stale: false,
  ...over,
});

const FRESH = item("fresh", { effectiveExpiresAt: "2027-06-01T00:00:00.000Z" });
const OLD = item("old", { title: "Pen test report", collectedAt: "2025-01-10T00:00:00.000Z", effectiveExpiresAt: "2026-01-10T00:00:00.000Z", stale: true });

const withEvidence = (code: string, items: unknown[], validity: number | null = 12) =>
  rowOf({ ...control(code), evidenceValidityMonths: validity } as never, { ...assessment("FULFILLED"), evidenceItems: items } as never);

beforeEach(() => {
  window.history.replaceState(null, "", "/systems/s1#controls");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Stale evidence on the Control row (#455)", () => {
  it("flags a Control whose evidence has expired, and only that one", async () => {
    stubApi([withEvidence("A.1", [OLD, FRESH]), withEvidence("A.2", [FRESH]), rowOf(control("A.3"), null)]);
    renderControls();
    await screen.findByText("Control A.1");
    const rows = [...document.querySelectorAll<HTMLElement>(".sc-crow")];
    const stale = rows.filter((row) => row.querySelector(".sc-stalebadge")).map((row) => row.dataset.controlCode);
    expect(stale).toEqual(["A.1"]);
  });
});

describe("Evidence in the Control drawer (#455)", () => {
  it("lists the records with their dates, a Stale chip on an expired one, and the validity note", async () => {
    stubApi([withEvidence("A.1", [OLD, FRESH])]);
    const { drawer } = await renderDrawer("A.1");
    const region = drawer.getByRole("region", { name: "Evidence records" });
    expect(region).toHaveTextContent("Pen test report");
    expect(region).toHaveTextContent("Stale");
    expect(region).toHaveTextContent("Expired");
    expect(region).toHaveTextContent("Control's validity period");
    expect(region).toHaveTextContent("expires 12 months after it was collected");
    expect(drawer.getByRole("link", { name: "Pen test report" })).toHaveAttribute("href", "https://wiki.example.com/old");
  });

  it("adds a link, sends the dates, and shows the returned record", async () => {
    const added = item("new1", { title: "Backup log", effectiveExpiresAt: "2027-01-01T00:00:00.000Z" });
    const { calls } = stubApi([rowOf(control("A.1"), assessment("FULFILLED"))], {
      handle: (call) => (call.method === "POST" ? json({ assessmentId: "a1", evidence: [added] }, 201) : undefined),
    });
    const { drawer } = await renderDrawer("A.1");
    expect(drawer.getByText("No evidence recorded yet.")).toBeInTheDocument();
    expect(drawer.getByText(/no validity period, so evidence doesn't expire/)).toBeInTheDocument();
    await userEvent.type(drawer.getByLabelText("Evidence link for A.1"), "https://wiki.example.com/backup");
    await userEvent.type(drawer.getByLabelText("Evidence title for A.1"), "Backup log");
    await userEvent.type(drawer.getByLabelText("Evidence expiry date for A.1"), "2027-01-01");
    await userEvent.click(drawer.getByRole("button", { name: "Add evidence" }));
    expect(await drawer.findByRole("link", { name: "Backup log" })).toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe(`/api/systems/s1/assessments/c-A.1/evidence`);
    expect(post.body).toMatchObject({ kind: "LINK", url: "https://wiki.example.com/backup", title: "Backup log", expiresAt: "2027-01-01T23:59:59.999Z" });
    expect((post.body as { collectedAt: string }).collectedAt).toMatch(/T00:00:00\.000Z$/);
  });

  it("adds one of the System's documents from the picker", async () => {
    const { calls } = stubApi([rowOf(control("A.1"), assessment("FULFILLED"))], {
      handle: (call) => {
        if (call.method === "GET" && call.url === "/api/systems/s1/documents")
          return json({ documents: [{ id: "dr1", name: "Policy", link: null, file: { fileName: "policy.pdf" } }, { id: "dr2", name: "Empty", link: null, file: null }] });
        if (call.method === "POST") return json({ assessmentId: "a1", evidence: [item("d1", { kind: "DOCUMENT", url: null, title: "Policy", documentRequirementId: "dr1", systemDocumentId: "sd1" })] }, 201);
        return undefined;
      },
    });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: "Document" }));
    const select = await drawer.findByLabelText("Evidence document for A.1");
    await waitFor(() => expect(drawer.getByRole("option", { name: "Policy (policy.pdf)" })).toBeInTheDocument());
    expect(drawer.queryByRole("option", { name: "Empty" })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "dr1");
    await userEvent.click(drawer.getByRole("button", { name: "Add evidence" }));
    expect(await drawer.findByRole("link", { name: "Policy" })).toHaveAttribute("href", "/api/systems/s1/documents/dr1/file");
    expect(calls.find((call) => call.method === "POST")!.body).toMatchObject({ kind: "DOCUMENT", documentRequirementId: "dr1" });
  });

  it("shows a refusal in place and keeps what was typed", async () => {
    stubApi([rowOf(control("A.1"), assessment("FULFILLED"))], { handle: (call) => (call.method === "POST" ? json({ error: "Not a link" }, 400) : undefined) });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.type(drawer.getByLabelText("Evidence link for A.1"), "nope");
    await userEvent.click(drawer.getByRole("button", { name: "Add evidence" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("Not a link");
    expect(drawer.getByLabelText("Evidence link for A.1")).toHaveValue("nope");
  });

  it("removes a record and shows the remaining ones", async () => {
    const { calls } = stubApi([withEvidence("A.1", [OLD, FRESH])], {
      handle: (call) => (call.method === "DELETE" ? json({ evidence: [FRESH] }) : undefined),
    });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: /Remove evidence Pen test report/ }));
    await waitFor(() => expect(drawer.queryByRole("link", { name: "Pen test report" })).not.toBeInTheDocument());
    expect(calls.find((call) => call.method === "DELETE")!.url).toBe("/api/systems/s1/assessments/c-A.1/evidence/old");
    expect(drawer.getByRole("link", { name: "https://wiki.example.com/fresh" })).toBeInTheDocument();
  });

  it("is read-only for a person who can't edit the System: the records show, no form and no Remove", async () => {
    stubApi([withEvidence("A.1", [FRESH])]);
    const { drawer } = await renderDrawer("A.1", { userRole: "VIEWER", currentUserId: "v", readOnly: true });
    expect(drawer.getByRole("link", { name: "https://wiki.example.com/fresh" })).toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Add evidence" })).not.toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: /Remove evidence/ })).not.toBeInTheDocument();
  });
});
