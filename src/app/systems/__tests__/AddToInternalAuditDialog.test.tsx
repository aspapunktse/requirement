import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddToInternalAuditDialog } from "../AddToInternalAuditDialog";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const audit = (over: Record<string, unknown>) => ({
  id: "a1",
  title: "Access review",
  dueDate: "2026-12-01",
  status: "DRAFT",
  systemCount: 2,
  ...over,
});
const AUDITS = [
  audit({ id: "a1", title: "Access review" }),
  audit({ id: "a2", title: "Launched audit", status: "LAUNCHED" }),
  audit({ id: "a3", title: "Closed audit", status: "CLOSED" }),
  audit({ id: "a4", title: "Backup review", systemCount: 1 }),
];
const SYSTEMS = [
  { id: "s1", name: "Jira" },
  { id: "s2", name: "Okta" },
];

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;
function stub(list: () => Promise<Response>, add: () => Promise<Response> = () => json({ added: 2, skipped: 0 })) {
  fetchMock = vi.fn((input: string | URL | Request) => (String(input) === "/api/internal-audits" ? list() : add()));
  vi.stubGlobal("fetch", fetchMock);
}
const renderDialog = (props: Partial<React.ComponentProps<typeof AddToInternalAuditDialog>> = {}) =>
  render(<AddToInternalAuditDialog systems={SYSTEMS} onClose={vi.fn()} onDone={vi.fn()} {...props} />);

beforeEach(() => stub(() => json({ internalAudits: AUDITS })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AddToInternalAuditDialog (#234)", () => {
  it("lists Draft audits only, and can't save before one is picked", async () => {
    renderDialog();
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    expect(await screen.findByRole("radio", { name: /Access review/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Backup review/ })).toBeInTheDocument();
    expect(screen.queryByText(/Launched audit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Closed audit/)).not.toBeInTheDocument();
    expect(screen.getByText(/Jira, Okta/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to audit" })).toBeDisabled();
  });

  it("says so, with a link to create one, when there is no Draft audit", async () => {
    stub(() => json({ internalAudits: [audit({ status: "LAUNCHED" })] }));
    renderDialog();

    expect(await screen.findByText(/no Draft Internal Audit/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an Internal Audit" })).toHaveAttribute("href", "/internal-audits/new");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows an error when the audits can't be loaded", async () => {
    stub(() => json({ error: "Forbidden" }, 403));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");

    cleanup();
    stub(() => Promise.reject(new Error("offline")));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load the Internal Audits");
  });

  it("posts the selected Systems to the picked audit and reports how many were added and skipped", async () => {
    stub(
      () => json({ internalAudits: AUDITS }),
      () => json({ added: 1, skipped: 1 }),
    );
    const onDone = vi.fn();
    renderDialog({ onDone });

    await userEvent.click(await screen.findByRole("radio", { name: /Backup review/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to audit" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Added 1 System to Backup review; 1 was already in it.");
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/internal-audits/a4/systems")!;
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ systemIds: ["s1", "s2"] });
    expect(screen.getByRole("link", { name: "Open the Internal Audit" })).toHaveAttribute("href", "/internal-audits/a4");
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's message when the add is refused", async () => {
    stub(
      () => json({ internalAudits: AUDITS }),
      () => json({ error: "An Internal Audit can only be edited or deleted while it is a draft (this one is launched)" }, 409),
    );
    const onDone = vi.fn();
    renderDialog({ onDone });

    await userEvent.click(await screen.findByRole("radio", { name: /Access review/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to audit" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/only be edited or deleted while it is a draft/));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add to audit" })).toBeEnabled();
  });

  it("closes on Cancel", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByRole("radio", { name: /Access review/ });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
