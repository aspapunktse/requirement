export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ems-paper-1 px-6">
      <h1 className="text-3xl">
        Requirement & Risk Onboarding
      </h1>
      <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Track requirement fulfillment and risk during system and cloud
        onboarding. See <code>prisma/schema.prisma</code> for the domain
        model and <code>README.md</code> to get started.
      </p>
    </div>
  );
}
