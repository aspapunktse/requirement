import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISMS - system onboarding",
  description: "Onboard systems against the ISMS requirement catalog, assess requirements and track risks.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getActingUser();

  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AppHeader devStub={isDevAuthStubEnabled()} user={user} />
        {children}
      </body>
    </html>
  );
}
