import { getActingUser } from "@/lib/acting-user";
import { listUsersWithHoldings } from "@/lib/user-admin";
import { UsersManager } from "./UsersManager";

/**
 * Admin -> Users (#364): create Users, rename them and assign roles. Admin only. A Business Risk Owner's row links to
 * Admin -> Business Risk Owners, where their Business Unit and Framework scope is assigned (product-owner decision 4a).
 */
export default async function UsersPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return <p className="p-6 text-rg-muted">Only Admins can manage Users.</p>;
  }

  // Keyed on the acting user, so a switch of user starts from a clean state.
  return <UsersManager key={user.id} initialUsers={await listUsersWithHoldings()} actingUserId={user.id} />;
}
