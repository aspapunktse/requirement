import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewControlForm } from "../NewControlForm";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const reply = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });

async function fill(code: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Code"), code);
  await user.type(screen.getByLabelText("Title"), "Backups");
  await user.type(screen.getByLabelText("Description"), "Back it up.");
  await user.type(screen.getByLabelText("Category"), "Operations");
  await user.type(screen.getByLabelText("Self-Assessment Question"), "Do you back up?");
  return user;
}

describe("NewControlForm (#412)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    router.push.mockReset();
    router.refresh.mockReset();
    vi.unstubAllGlobals();
  });

  it("posts the Control and opens its editor, URL-encoding the code", async () => {
    fetchMock.mockResolvedValue(reply(true, 201, { control: { id: "c1", code: "A.5/1 x" } }));
    render(<NewControlForm />);
    const user = await fill("A.5/1 x");
    await user.click(screen.getByRole("button", { name: "Create Control" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/controls/A.5%2F1%20x/edit"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/controls");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ code: "A.5/1 x", title: "Backups", category: "Operations", applicability: "PER_SYSTEM", question: "Do you back up?" });
  });

  it("shows a refusal in place and keeps what was typed", async () => {
    fetchMock.mockResolvedValue(reply(false, 409, { error: "A Control with that code already exists" }));
    render(<NewControlForm />);
    const user = await fill("SEC-001");
    await user.click(screen.getByRole("button", { name: "Create Control" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A Control with that code already exists");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Code")).toHaveValue("SEC-001");
    expect(screen.getByLabelText("Title")).toHaveValue("Backups");
    expect(screen.getByRole("button", { name: "Create Control" })).toBeEnabled();
  });

  it("shows a network failure and keeps what was typed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<NewControlForm />);
    const user = await fill("SEC-002");
    await user.click(screen.getByRole("button", { name: "Create Control" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not reach the server");
    expect(screen.getByLabelText("Code")).toHaveValue("SEC-002");
  });

  it.each(["new", " NEW "])("explains the reserved code %j without calling the API", async (code) => {
    render(<NewControlForm />);
    const user = await fill(code);
    await user.click(screen.getByRole("button", { name: "Create Control" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('"new" is reserved');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Backups");
  });
});
