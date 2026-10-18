import { getActingUser } from "@/lib/acting-user";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";
import { PageHead } from "@/components/ui/PageHead";
import { ReviewGroupManager } from "@/components/ReviewGroupManager";

export default async function ReviewGroupsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_CATALOG.includes(user.role)) {
    return <p className="p-6 text-rg-muted">Only Admins can manage Review Groups.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <PageHead
        pageId="admin-review-groups"
        breadcrumb={["Admin", "Review Groups"]}
        title="Review Groups"
        lede="The people who review Systems on behalf of the Frameworks a group is tied to. A Framework has at most one group."
      />
      <ReviewGroupManager />
    </div>
  );
}
