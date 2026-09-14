import { CatalogManager } from "@/components/CatalogManager";

export function DeploymentFacetManager() {
  return (
    <CatalogManager
      resourcePath="/api/deployment-facets"
      resourceKey="deploymentFacets"
      itemLabel="Deployment Facet"
    />
  );
}
