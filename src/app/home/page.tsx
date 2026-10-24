import { getActingUser } from "@/lib/acting-user";
import { homeView } from "./home-view";
import { HomeCommandCenter } from "./HomeCommandCenter";

/**
 * Role-differentiated landing page, the "command center" (design proposal A, issue #226): a greeting with
 * the "your move" ring, headline figures that filter the task list, one task list grouped by urgency
 * beside the role's picture, the shortcuts and recent activity, and a Ctrl+K palette. Everything is built
 * server-side by `homeView`; `HomeCommandCenter` only adds the interactions. Earlier: the plain
 * DashboardCard grid (#54), the document-brief redesign (#57); why it lives at /home rather than /: #59.
 */
export default async function HomePage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  return <HomeCommandCenter view={await homeView(user)} />;
}
