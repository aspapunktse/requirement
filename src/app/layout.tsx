import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PaletteProvider } from "@/components/PaletteProvider";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import { FONT_VARIABLE_CLASSES } from "@/app/theme-fonts";
import { MODE_INIT_SCRIPT } from "@/lib/mode";
import { PALETTE_INIT_SCRIPT } from "@/lib/palette";
import { sensitivityTokenCss } from "@/lib/sensitivity-level-css";
import { listSensitivityLevels } from "@/lib/sensitivity-level-data";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISMS - system onboarding",
  description: "Onboard systems against the ISMS Control Library, assess controls and track risks.",
};

/** The Sensitivity Level colour tokens (#291), read on each request so a save shows on the next page load. Falls back to the defaults if the read fails. */
async function readSensitivityTokenCss(): Promise<string> {
  try {
    return sensitivityTokenCss(await listSensitivityLevels());
  } catch {
    return sensitivityTokenCss([]);
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getActingUser();
  const sensitivityCss = await readSensitivityTokenCss();

  return (
    <html lang="en" className={`h-full antialiased ${FONT_VARIABLE_CLASSES}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_INIT_SCRIPT + PALETTE_INIT_SCRIPT }} />
        <style id="sensitivity-level-tokens" dangerouslySetInnerHTML={{ __html: sensitivityCss }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PaletteProvider>
          <AppHeader devStub={isDevAuthStubEnabled()} user={user} />
          {children}
        </PaletteProvider>
      </body>
    </html>
  );
}
