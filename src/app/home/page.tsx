import { getActingUser } from "@/lib/acting-user";
import { PageHead } from "@/components/ui/PageHead";
import { TaskTable } from "@/components/ui/TaskTable";
import { TileNav, type NavTile } from "@/components/ui/TileNav";
import { roleView } from "./role-view";

/**
 * Role-differentiated landing page: a page-head with headline stats, a
 * unified "My tasks" table of everything needing this role's attention, and
 * a "Where to start" tile grid of pure navigation shortcuts. Redesign of the
 * plain DashboardCard grid from #54 — see issue #57 for the EMS "document
 * brief" pattern this follows, and #59 for why this lives at /home rather
 * than /.
 */
export default async function HomePage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const view = await roleView(user);
  // Every role can read the Framework Coverage view (#74), so it's a shortcut for all of them.
  const tiles: NavTile[] = [
    ...view.tiles,
    { title: "Framework coverage", description: "Which Requirements the Control Library covers, and the gaps.", href: "/frameworks" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHead
        breadcrumb={["ISMS · System onboarding", "Home"]}
        pageId={`HOME . ${user.role.replace(/_/g, " ")}`}
        title={`Welcome, ${user.name}.`}
        lede={view.lede}
        stats={[{ label: "Role", value: user.role.replace(/_/g, " ") }, ...view.stats]}
      />

      {view.tasks && (
        <section className="mb-8">
          <SectionHead title="My tasks" note={`${view.tasks.length} open`} />
          <TaskTable rows={view.tasks} />
        </section>
      )}

      <section>
        <SectionHead title="Where to start" note={`${tiles.length} shortcuts · click to open`} />
        <TileNav tiles={tiles} />
      </section>
    </div>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3.5 border-b border-rg-line pb-2">
      <h2>{title}</h2>
      <p className="text-right text-[13px] text-rg-muted">{note}</p>
    </div>
  );
}
