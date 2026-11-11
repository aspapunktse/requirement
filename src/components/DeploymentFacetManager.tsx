import { CatalogManager } from "@/components/CatalogManager";

export function DeploymentFacetManager() {
  return (
    <CatalogManager
      resourcePath="/api/deployment-facets"
      resourceKey="deploymentFacets"
      itemLabel="Deployment Facet"
      flag={{
        key: "requiresVendorDetails",
        label: "Needs vendor details",
        hint: "A System that declares this Facet must give its vendor name and service URL.",
      }}
    />
  );
}
