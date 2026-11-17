import { getActingUser } from "@/lib/acting-user";
import { OnboardingInterview } from "@/components/OnboardingInterview";
import { canCreateSystem } from "@/lib/system-permissions";
import { readInterviewContext } from "@/lib/comparison";
import "@/app/home/home.css";
import "./onboarding.css";

function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <div className="hc ob-wrap">
      <section className="hc-card">
        <p className="hc-card-b hc-empty">{children}</p>
      </section>
    </div>
  );
}

/**
 * The onboarding interview. `?comparison=<id>` (from a Comparison's Add Candidate, #374) carries the Comparison along: the new
 * System becomes its Candidate when it is created. It is refused here, with the reason, when the Comparison is hidden or can't take
 * the acting user's Candidate, or when "Staged evaluation for new Systems" is off (the new System would not be staged).
 */
export default async function NewSystemPage({ searchParams }: { searchParams: Promise<{ comparison?: string | string[] }> }) {
  const user = await getActingUser();

  if (!user) {
    return <Refusal>Pick a user to act as first.</Refusal>;
  }

  if (!canCreateSystem(user)) {
    return <Refusal>Only a System Owner, Risk Owner or Admin can create a System.</Refusal>;
  }

  const { comparison: requested } = await searchParams;
  const comparisonId = Array.isArray(requested) ? requested[0] : requested;
  if (comparisonId) {
    const context = await readInterviewContext(user, comparisonId);
    if (!context.ok) {
      return <Refusal>{context.status === 404 ? "That Comparison doesn't exist, or you can't see it." : context.error}</Refusal>;
    }
    return <OnboardingInterview userId={user.id} comparison={{ ...context.comparison, candidates: context.candidates }} />;
  }

  return <OnboardingInterview userId={user.id} />;
}
