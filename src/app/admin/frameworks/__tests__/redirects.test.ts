import { describe, expect, it } from "vitest";
import RetiredAdminFrameworkPage from "../[id]/page";
import RetiredAdminFrameworksPage from "../page";

// `/admin/frameworks` was retired in #413; bookmarks go to the Framework catalog and the Framework's edit page.
async function redirectOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("/admin/frameworks", () => {
  it("redirects to /frameworks", async () => {
    expect(await redirectOf(() => RetiredAdminFrameworksPage())).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/frameworks;/) });
  });

  it("redirects /admin/frameworks/<id> to /frameworks/<id>/edit", async () => {
    const thrown = await redirectOf(() => RetiredAdminFrameworkPage({ params: Promise.resolve({ id: "abc123" }) } as never));
    expect(thrown).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/frameworks\/abc123\/edit;/) });
  });
});
