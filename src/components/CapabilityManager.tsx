import { CatalogManager } from "@/components/CatalogManager";

export function CapabilityManager() {
  return (
    <CatalogManager
      resourcePath="/api/capabilities"
      resourceKey="capabilities"
      itemLabel="Capability"
      itemLabelPlural="Capabilities"
    />
  );
}
