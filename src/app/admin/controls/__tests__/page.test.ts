import { describe, expect, it } from "vitest";
import RetiredAdminControlsPage from "../page";

// `/admin/controls` was retired in #412; bookmarks go to the Control Library.
describe("/admin/controls", () => {
  it("redirects to /controls", () => {
    let thrown: unknown;
    try {
      RetiredAdminControlsPage();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/controls;/) });
  });
});
