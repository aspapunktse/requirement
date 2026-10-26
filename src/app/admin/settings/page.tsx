import { getActingUser } from "@/lib/acting-user";
import { APP_SETTINGS, readAppSettings, SETTING_SECTIONS } from "@/lib/app-settings";
import { AppSettingsForm } from "@/components/AppSettingsForm";

/** Settings (#240): the Admin-editable App Settings, a section each, rendered from the registry in `src/lib/app-settings.ts`. */
export default async function SettingsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return <p className="p-6 text-rg-muted">Only Admins can change settings.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Settings</h1>
      <p className="mb-5 text-sm text-rg-muted">Changes take effect at once. Each change is recorded in Recent activity.</p>
      <AppSettingsForm sections={SETTING_SECTIONS} definitions={APP_SETTINGS} values={await readAppSettings()} />
    </div>
  );
}
