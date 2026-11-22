import Link from "next/link";
import { notFound } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import {
  canCurateFramework,
  canSeeDraftFrameworks,
  mappableControlsWhere,
  requirementInclude,
  visibleOrOwnedFrameworksWhere,
} from "@/lib/frameworks";
import { FrameworkRequirementsEditor } from "@/components/FrameworkRequirementsEditor";
import { FrameworkReviewGroup } from "@/components/FrameworkReviewGroup";
import "@/app/home/home.css";
import "../../frameworks.css";
import { loadFrameworksView } from "../../frameworks-data";
import { FrameworkEditor } from "./FrameworkEditor";

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
 * The editor for one Framework (issue #413), where `/admin/frameworks` used to be: its descriptive fields, delete,
 * Publish for a Draft, Review Group, Requirements and Control Mappings. Open to whoever may curate it
 * (`canCurateFramework`, #320): a Compliance Manager or an Admin, or the owner of a non-base Framework, who edits
 * only the description and the onboarding question and hint, as `PATCH /api/frameworks/[id]` allows. Anyone else
 * gets the refusal below and nothing of the Framework is read for them. An id the user can't see (a Draft that is
 * not theirs included) or that no Framework has is a 404.
 */
export default async function EditFrameworkPage({ params }: PageProps<"/frameworks/[id]/edit">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <Refusal>Pick a user to act as first.</Refusal>;
  }

  const framework = await prisma.framework.findFirst({ where: { id, ...visibleOrOwnedFrameworksWhere(user) } });
  if (!framework) notFound();

  if (!canCurateFramework(user, framework)) {
    return (
      <Refusal>
        {framework.isBase
          ? "Only Compliance Managers and Admins can edit the base Framework. "
          : "Only this Framework’s owner, Compliance Managers and Admins can edit it. "}
        <Link href="/frameworks">Back to Frameworks</Link>.
      </Refusal>
    );
  }

  const catalogManager = canSeeDraftFrameworks(user);
  const [view, requirements, controls, reviewGroups, others] = await Promise.all([
    loadFrameworksView(user),
    prisma.requirement.findMany({
      where: { frameworkId: id },
      orderBy: [{ section: "asc" }, { code: "asc" }],
      include: requirementInclude,
    }),
    prisma.control.findMany({
      // A Framework Owner doesn't see the Supplementary Controls of other Draft Frameworks.
      where: mappableControlsWhere(user, id),
      orderBy: { code: "asc" },
      select: { id: true, code: true, title: true },
    }),
    prisma.reviewGroup.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
    prisma.framework.findMany({
      where: { id: { not: id }, ...visibleOrOwnedFrameworksWhere(user) },
      select: { id: true, name: true, version: true },
      orderBy: [{ name: "asc" }, { version: "asc" }],
    }),
  ]);
  const row = view.rows.find((candidate) => candidate.id === id);
  if (!row) notFound();

  // Keyed on the acting user and the Framework, so switching either starts from a clean form.
  return (
    <FrameworkEditor
      key={`${user.id}:${framework.id}`}
      row={row}
      catalogManager={catalogManager}
      initial={{
        name: framework.name,
        version: framework.version,
        description: framework.description ?? "",
        strictComplianceRequired: framework.strictComplianceRequired,
        licensing: framework.licensing,
        supersedesId: framework.supersedesId ?? "",
        onboardingQuestion: framework.onboardingQuestion ?? "",
        onboardingHint: framework.onboardingHint ?? "",
      }}
      supersedesOptions={others}
      requirementCount={requirements.length}
    >
      <section className="hc-card" aria-label="Review Group">
        <div className="hc-card-b fc-embed">
          <FrameworkReviewGroup
            frameworkId={framework.id}
            isBase={framework.isBase}
            groups={reviewGroups.map((group) => ({ id: group.id, name: group.name, memberCount: group._count.members }))}
            initialReviewGroupId={framework.reviewGroupId}
            canOpenGroup={user.role === "ADMIN"}
          />
        </div>
      </section>
      <section className="hc-card" aria-label="Requirements and Control Mappings">
        <div className="hc-card-h">
          <h2>Requirements and Control Mappings</h2>
        </div>
        <div className="hc-card-b fc-embed">
          <FrameworkRequirementsEditor
            frameworkId={framework.id}
            licensing={framework.licensing}
            initialRequirements={requirements}
            controls={controls}
          />
        </div>
      </section>
    </FrameworkEditor>
  );
}
