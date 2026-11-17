import { getActingUser } from "@/lib/acting-user";
import { ComparisonPage } from "../ComparisonPage";

/**
 * One Comparison (#373), under Systems in the navigation. `GET /api/comparisons/[id]` supplies everything the client component
 * shows and answers 404 for a Comparison the acting user can't see; this page only passes the id and who is acting.
 */
export default async function ComparisonRoute({ params }: PageProps<"/comparisons/[id]">) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const { id } = await params;
  // Keyed on the acting user and the Comparison, so a switch starts from a clean page.
  return <ComparisonPage key={`${user.id}:${id}`} id={id} userId={user.id} role={user.role} />;
}
