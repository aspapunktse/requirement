import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { canSeeDraftFrameworks } from "@/lib/frameworks";
import "@/app/home/home.css";
import "../frameworks.css";
import { NewFrameworkForm } from "./NewFrameworkForm";

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <div className="hc fc">
      <section className="hc-card">
        <p className="hc-card-b hc-empty">{children}</p>
      </section>
    </div>
  );
}

/**
 * "New Framework" (issue #266, product-owner decision 4b): the create form that used to sit at the foot of
 * /admin/frameworks, on its own page in the Home look. Compliance Managers and Admins only (the same roles
 * `POST /api/frameworks` admits). The new Framework starts as a Draft; its authoring page opens next.
 */
export default async function NewFrameworkPage() {
  const user = await getActingUser();

  if (!user) {
    return <Refusal>Pick a user to act as first.</Refusal>;
  }

  if (!canSeeDraftFrameworks(user)) {
    return <Refusal>Only Compliance Managers and Admins can add a Framework.</Refusal>;
  }

  const frameworks = await prisma.framework.findMany({
    select: { id: true, name: true, version: true },
    orderBy: [{ name: "asc" }, { version: "asc" }],
  });

  return <NewFrameworkForm frameworks={frameworks} />;
}
