import { getActingUser } from "@/lib/acting-user";
import { OnboardingInterview } from "@/components/OnboardingInterview";
import { canCreateSystem } from "@/lib/system-permissions";
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

export default async function NewSystemPage() {
  const user = await getActingUser();

  if (!user) {
    return <Refusal>Pick a user to act as first.</Refusal>;
  }

  if (!canCreateSystem(user)) {
    return <Refusal>Only a System Owner, Risk Owner or Admin can create a System.</Refusal>;
  }

  return <OnboardingInterview />;
}
