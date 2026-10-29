import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PaletteProvider } from "@/components/PaletteProvider";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISMS - system onboarding",
  description: "Onboard systems against the ISMS Control Library, assess controls and track risks.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getActingUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <PaletteProvider>
          <AppHeader devStub={isDevAuthStubEnabled()} user={user} />
          {children}
        </PaletteProvider>
      </body>
    </html>
  );
}
