import { CatalogManager } from "@/components/CatalogManager";

export function BusinessUnitManager() {
  return <CatalogManager resourcePath="/api/business-units" resourceKey="businessUnits" itemLabel="Business Unit" />;
}
