import { CatalogManager } from "@/components/CatalogManager";

export function SystemTypeManager() {
  return (
    <CatalogManager
      resourcePath="/api/system-types"
      resourceKey="systemTypes"
      itemLabel="System Type"
    />
  );
}
