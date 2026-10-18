import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewGroupManager } from "../ReviewGroupManager";
import { ReviewGroupEditor, type ReviewGroupDetail } from "../ReviewGroupEditor";
import { FrameworkReviewGroup } from "../FrameworkReviewGroup";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const WARNING = /no members: only an Admin can decide its Review Step/;

type Call = { url: string; method: string; body?: unknown };

/** Stubs fetch with `routes` keyed "METHOD url"; returns the calls made. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const route = routes[`${method} ${url}`];
      if (!route) throw new Error(`Unexpected fetch: ${method} ${url}`);
      return Promise.resolve(route());
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("ReviewGroupManager", () => {
  const groups = [
    {
      id: "g1",
      name: "GDPR Review Group",
      description: "Privacy",
      members: [{ id: "u1" }],
      frameworks: [{ id: "f1", name: "GDPR", version: "2016" }],
    },
    {
      id: "g2",
      name: "NIS2 Review Group",
      description: null,
      members: [],
      frameworks: [{ id: "f2", name: "NIS2", version: "2022" }],
    },
    { id: "g3", name: "Spare Review Group", description: null, members: [], frameworks: [] },
  ];

  it("lists groups with member counts and ties, and warns only on a tied group with no members", async () => {
    stubFetch({ "GET /api/review-groups": () => json({ reviewGroups: groups }) });
    render(<ReviewGroupManager />);

    expect(await screen.findByRole("link", { name: "GDPR Review Group" })).toHaveAttribute("href", "/admin/review-groups/g1");
    expect(screen.getByText(/1 member · tied to GDPR:2016/)).toBeInTheDocument();
    expect(screen.getByText(/0 members · tied to NIS2:2022/)).toBeInTheDocument();
    expect(screen.getByText(/0 members · not tied to a Framework/)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
  });

  it("creates a group and reloads the list", async () => {
    let created = false;
    const calls = stubFetch({
      "GET /api/review-groups": () => json({ reviewGroups: created ? groups : [] }),
      "POST /api/review-groups": () => {
        created = true;
        return json({ reviewGroup: groups[0] }, 201);
      },
    });
    render(<ReviewGroupManager />);
    await screen.findByText("No Review Groups yet.");

    await userEvent.type(screen.getByLabelText("Name"), "GDPR Review Group");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("link", { name: "GDPR Review Group" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "GDPR Review Group" });
  });

  it("shows the error when a create is refused", async () => {
    stubFetch({
      "GET /api/review-groups": () => json({ reviewGroups: [] }),
      "POST /api/review-groups": () => json({ error: "A Review Group with that name already exists" }, 409),
    });
    render(<ReviewGroupManager />);
    await screen.findByText("No Review Groups yet.");
    await userEvent.type(screen.getByLabelText("Name"), "Dup");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("ReviewGroupEditor", () => {
  const empty: ReviewGroupDetail = {
    id: "g1",
    name: "GDPR Review Group",
    description: null,
    members: [],
    frameworks: [{ id: "f1", name: "GDPR", version: "2016" }],
  };
  const users = [
    { id: "u1", name: "Rita Reviewer", email: "rita@example.com" },
    { id: "u2", name: "Sam Owner", email: "sam@example.com" },
  ];
  const frameworks = [
    { id: "f1", name: "GDPR", version: "2016", reviewGroupId: "g1" },
    { id: "f2", name: "NIS2", version: "2022", reviewGroupId: null },
    { id: "f3", name: "DORA", version: "2022", reviewGroupId: "other" },
  ];

  it("warns when the group is tied and has no members, and not once it has one", async () => {
    const withMember = { ...empty, members: [{ id: "u1", name: "Rita Reviewer", email: "rita@example.com" }] };
    const calls = stubFetch({
      "POST /api/review-groups/g1/members": () => json({ reviewGroup: withMember }, 201),
      "GET /api/review-groups/g1": () => json({ reviewGroup: withMember }),
    });
    render(<ReviewGroupEditor initialGroup={empty} users={users} frameworks={frameworks} />);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);

    await userEvent.selectOptions(screen.getByLabelText("User to add"), "u1");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByText("Rita Reviewer")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ userId: "u1" });
  });

  it("shows no warning for an untied group with no members", () => {
    render(<ReviewGroupEditor initialGroup={{ ...empty, frameworks: [] }} users={users} frameworks={frameworks} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers only users not yet members, and only Frameworks that are untied or already this group's", () => {
    render(
      <ReviewGroupEditor
        initialGroup={{ ...empty, members: [{ id: "u1", name: "Rita Reviewer", email: "rita@example.com" }] }}
        users={users}
        frameworks={frameworks}
      />,
    );
    const userOptions = Array.from(screen.getByLabelText("User to add").querySelectorAll("option")).map((o) => o.textContent);
    expect(userOptions).toEqual(["Add a member…", "Sam Owner (sam@example.com)"]);
    const frameworkOptions = Array.from(screen.getByLabelText("Framework to tie").querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(frameworkOptions).toEqual(["Tie a Framework…", "NIS2:2022"]);
  });

  it("removes a member, even the last one", async () => {
    const one = { ...empty, members: [{ id: "u1", name: "Rita Reviewer", email: "rita@example.com" }] };
    stubFetch({
      "DELETE /api/review-groups/g1/members/u1": () => json({ reviewGroup: empty }),
      "GET /api/review-groups/g1": () => json({ reviewGroup: empty }),
    });
    render(<ReviewGroupEditor initialGroup={one} users={users} frameworks={frameworks} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Rita Reviewer" }));
    expect(await screen.findByText("No members yet.")).toBeInTheDocument();
  });

  it("unties a Framework and ties another", async () => {
    let state: ReviewGroupDetail = empty;
    const calls = stubFetch({
      "DELETE /api/frameworks/f1/review-group": () => {
        state = { ...empty, frameworks: [] };
        return json({ framework: { reviewGroup: null } });
      },
      "PUT /api/frameworks/f2/review-group": () => {
        state = { ...empty, frameworks: [{ id: "f2", name: "NIS2", version: "2022" }] };
        return json({ framework: { reviewGroup: { id: "g1", name: empty.name } } });
      },
      "GET /api/review-groups/g1": () => json({ reviewGroup: state }),
    });
    render(<ReviewGroupEditor initialGroup={empty} users={users} frameworks={frameworks} />);

    await userEvent.click(screen.getByRole("button", { name: "Untie GDPR:2016" }));
    expect(await screen.findByText("Not tied to any Framework.")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Framework to tie"), "f2");
    await userEvent.click(screen.getByRole("button", { name: "Tie Framework" }));
    expect(await screen.findByRole("button", { name: "Untie NIS2:2022" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ reviewGroupId: "g1" });
  });

  it("shows the refusal and stays put when deleting a tied group is refused, and leaves the page when it works", async () => {
    let refuse = true;
    stubFetch({
      "DELETE /api/review-groups/g1": () =>
        refuse ? json({ error: "This Review Group is tied to one or more Frameworks" }, 409) : new Response(null, { status: 204 }),
    });
    render(<ReviewGroupEditor initialGroup={empty} users={users} frameworks={frameworks} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete Review Group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tied to one or more Frameworks");
    expect(push).not.toHaveBeenCalled();

    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Delete Review Group" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/review-groups"));
  });

  it("renames the group", async () => {
    const renamed = { ...empty, name: "Privacy Review Group" };
    const calls = stubFetch({ "PATCH /api/review-groups/g1": () => json({ reviewGroup: renamed }) });
    render(<ReviewGroupEditor initialGroup={empty} users={users} frameworks={frameworks} />);
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Privacy Review Group");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Privacy Review Group", description: "" }));
  });
});

describe("FrameworkReviewGroup", () => {
  const groups = [
    { id: "g1", name: "GDPR Review Group", memberCount: 2 },
    { id: "g2", name: "NIS2 Review Group", memberCount: 0 },
  ];

  it("explains that the base Framework can't be tied", () => {
    render(<FrameworkReviewGroup frameworkId="b" isBase groups={groups} initialReviewGroupId={null} canOpenGroup />);
    expect(screen.getByText(/can't be tied to a Review Group/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the tied group, linking to it only for an Admin", () => {
    const { rerender } = render(
      <FrameworkReviewGroup frameworkId="f1" isBase={false} groups={groups} initialReviewGroupId="g1" canOpenGroup />,
    );
    expect(screen.getByRole("link", { name: "GDPR Review Group" })).toHaveAttribute("href", "/admin/review-groups/g1");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<FrameworkReviewGroup frameworkId="f1" isBase={false} groups={groups} initialReviewGroupId="g1" canOpenGroup={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("GDPR Review Group")).toBeInTheDocument();
  });

  it("warns when the tied group has no members", () => {
    render(<FrameworkReviewGroup frameworkId="f1" isBase={false} groups={groups} initialReviewGroupId="g2" canOpenGroup={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
  });

  it("ties a group from the picker, then unties it", async () => {
    const calls = stubFetch({
      "PUT /api/frameworks/f1/review-group": () => json({ framework: { reviewGroup: { id: "g2", name: "NIS2 Review Group" } } }),
      "DELETE /api/frameworks/f1/review-group": () => json({ framework: { reviewGroup: null } }),
    });
    render(<FrameworkReviewGroup frameworkId="f1" isBase={false} groups={groups} initialReviewGroupId={null} canOpenGroup />);
    expect(screen.getByText(/fall to the base Review Step/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tie" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Review Group to tie"), "g2");
    await userEvent.click(screen.getByRole("button", { name: "Tie" }));
    expect(await screen.findByRole("status")).toHaveTextContent(WARNING);
    expect(calls[0].body).toEqual({ reviewGroupId: "g2" });

    await userEvent.click(screen.getByRole("button", { name: "Untie" }));
    expect(await screen.findByLabelText("Review Group to tie")).toBeInTheDocument();
  });

  it("shows the refusal when tying fails", async () => {
    stubFetch({ "PUT /api/frameworks/f1/review-group": () => json({ error: "This Framework is already tied to a Review Group" }, 409) });
    render(<FrameworkReviewGroup frameworkId="f1" isBase={false} groups={groups} initialReviewGroupId={null} canOpenGroup />);
    await userEvent.selectOptions(screen.getByLabelText("Review Group to tie"), "g1");
    await userEvent.click(screen.getByRole("button", { name: "Tie" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already tied");
    expect(screen.getByLabelText("Review Group to tie")).toBeInTheDocument();
  });
});
