import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { canCreateSystem } from "@/lib/system-permissions";
import { loadOnboardingCatalog } from "@/lib/onboarding-catalog";

/**
 * The System onboarding interview's data (#258): the Deployment Facets, the Published Frameworks, the
 * Providers and the Per-System and Both Control library with what applicability and the inheritance
 * sources need, so the page works out the live Control list in the browser. Same audience as the
 * page: whoever can create a System. See `loadOnboardingCatalog` for what is (and is not) revealed
 * about a Provider.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canCreateSystem(auth.user)) {
    return NextResponse.json({ error: "Only a System Owner, Risk Owner or Admin can create a System" }, { status: 403 });
  }

  return NextResponse.json(await loadOnboardingCatalog());
}
