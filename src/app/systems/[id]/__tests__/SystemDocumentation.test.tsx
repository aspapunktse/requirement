import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemDocumentRow } from "@/lib/system-documentation";
import { MAX_DOCUMENT_FILE_BYTES } from "@/lib/system-document-file";
import { SystemDocumentation } from "../SystemDocumentation";

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const row = (over: Partial<SystemDocumentRow> & { id: string; name: string }): SystemDocumentRow => ({
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
  row({ id: "d1", name: "Architecture description", description: "How the System is built.", link: "https://example.com/arch", provided: true, updatedAt: "2026-11-01T10:00:00.000Z", updatedBy: { id: "u1", name: "Elena Voss" } }),
  row({ id: "d2", name: "DPIA", stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] }),
];

let fetchMock: ReturnType<typeof vi.fn>;
let canEdit: boolean;

beforeEach(() => {
  canEdit = true;
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return respond({ document: { ...DOCUMENTS[1], ...body, updatedAt: "2026-11-09T09:00:00.000Z", updatedBy: { id: "u1", name: "Elena Voss" } } });
    }
    return respond({ documents: DOCUMENTS, canEdit });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Documentation tab", () => {
  it("lists each applicable Document Requirement under its stage, with description, Tracks and provided or not provided", async () => {
    render(<SystemDocumentation systemId="s1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading documentation");

    const first = within(await screen.findByRole("list", { name: "First documentation" }));
    const architecture = within(first.getByRole("form", { name: "Architecture description" }));
    expect(architecture.getByText("Provided")).toBeInTheDocument();
    expect(architecture.getByText("How the System is built.")).toBeInTheDocument();
    expect(architecture.getByText("Tracks: Full")).toBeInTheDocument();

    const second = within(screen.getByRole("list", { name: "Second round" }));
    const dpia = within(second.getByRole("form", { name: "DPIA" }));
    expect(dpia.getByText("Not provided")).toBeInTheDocument();
    expect(dpia.getByText("Tracks: Self, Full")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 provided")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/documents");
  });

  it("is read-only for someone who can't edit: the link is a link, and there is no field, checkbox or Save", async () => {
    canEdit = false;
    render(<SystemDocumentation systemId="s1" />);

    const link = await screen.findByRole("link", { name: "https://example.com/arch" });
    expect(link).toHaveAttribute("href", "https://example.com/arch");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("No link or file yet")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("lets the owner or an Admin set the link and mark it provided, then shows the saved state", async () => {
    const user = userEvent.setup();
    render(<SystemDocumentation systemId="s1" />);
    const form = within(await screen.findByRole("form", { name: "DPIA" }));

    expect(form.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(form.getByRole("textbox", { name: "Link to DPIA" }), "  https://example.com/dpia ");
    await user.click(form.getByRole("checkbox", { name: "DPIA is provided" }));
    await user.click(form.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("2 of 2 provided")).toBeInTheDocument());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe("/api/systems/s1/documents/d2");
    expect(JSON.parse(put[1].body)).toEqual({ link: "https://example.com/dpia", provided: true });
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "PUT" ? respond({ error: "Add a link to the document before marking it provided." }, 400) : respond({ documents: DOCUMENTS, canEdit }),
    );
    render(<SystemDocumentation systemId="s1" />);
    const form = within(await screen.findByRole("form", { name: "DPIA" }));

    await user.click(form.getByRole("checkbox", { name: "DPIA is provided" }));
    await user.click(form.getByRole("button", { name: "Save" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Add a link to the document before marking it provided.");
    expect(form.getByRole("checkbox", { name: "DPIA is provided" })).toBeChecked();
    expect(screen.getByText("1 of 2 provided")).toBeInTheDocument();
  });

  it("shows the uploaded file with a download link, and a read-only user can download it too", async () => {
    const file = { fileName: "arch.pdf", contentType: "application/pdf", size: 2048, uploadedAt: "2026-11-01T10:00:00.000Z" };
    fetchMock.mockImplementation(() => respond({ documents: [{ ...DOCUMENTS[1], file }], canEdit: false }));
    render(<SystemDocumentation systemId="s1" />);
    const download = await screen.findByRole("link", { name: "arch.pdf (2 KB)" });
    expect(download).toHaveAttribute("href", "/api/systems/s1/documents/d2/file");
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/file for/)).not.toBeInTheDocument();
  });

  it("uploads a file as multipart form data and shows it", async () => {
    const user = userEvent.setup();
    const file = { fileName: "dpia.pdf", contentType: "application/pdf", size: 5, uploadedAt: "2026-11-09T09:00:00.000Z" };
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST" ? respond({ document: { ...DOCUMENTS[1], file, updatedAt: "2026-11-09T09:00:00.000Z" } }) : respond({ documents: DOCUMENTS, canEdit }),
    );
    render(<SystemDocumentation systemId="s1" />);
    const form = within(await screen.findByRole("form", { name: "DPIA" }));

    await user.upload(form.getByLabelText("Upload file for DPIA"), new File(["hello"], "dpia.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("link", { name: "dpia.pdf (5 B)" })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/systems/s1/documents/d2/file");
    expect((post[1].body as FormData).get("file")).toBeInstanceOf(File);
    expect(screen.getByLabelText("Replace file for DPIA")).toBeInTheDocument();
  });

  it("refuses a file that is too large or of another type before uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SystemDocumentation systemId="s1" />);
    const form = within(await screen.findByRole("form", { name: "DPIA" }));

    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: MAX_DOCUMENT_FILE_BYTES + 1 });
    await user.upload(form.getByLabelText("Upload file for DPIA"), big);
    expect(await form.findByRole("alert")).toHaveTextContent("larger than 4 MB");

    await user.upload(form.getByLabelText("Upload file for DPIA"), new File(["<html>"], "page.html", { type: "text/html" }));
    expect(await form.findByRole("alert")).toHaveTextContent("isn't accepted");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("removes the file, and shows the row as not provided when the server says so", async () => {
    const user = userEvent.setup();
    const file = { fileName: "arch.pdf", contentType: "application/pdf", size: 2048, uploadedAt: "2026-11-01T10:00:00.000Z" };
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "DELETE"
        ? respond({ document: { ...DOCUMENTS[1], provided: false, file: null, updatedAt: "2026-11-09T09:00:00.000Z" } })
        : respond({ documents: [{ ...DOCUMENTS[1], provided: true, file }], canEdit }),
    );
    render(<SystemDocumentation systemId="s1" />);
    const form = within(await screen.findByRole("form", { name: "DPIA" }));
    expect(form.getByText("Provided")).toBeInTheDocument();

    await user.click(form.getByRole("button", { name: "Remove the file from DPIA" }));

    expect(await screen.findByText("Not provided")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /arch.pdf/ })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/documents/d2/file", { method: "DELETE" });
  });

  it("says so when no Document Requirement applies", async () => {
    fetchMock.mockImplementation(() => respond({ documents: [], canEdit: true }));
    render(<SystemDocumentation systemId="s1" />);
    expect(await screen.findByText("No Document Requirements apply to this System.")).toBeInTheDocument();
  });

  it("shows an error with a retry when loading fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => respond({ error: "boom" }, 500));
    render(<SystemDocumentation systemId="s1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the documentation");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("form", { name: "DPIA" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
