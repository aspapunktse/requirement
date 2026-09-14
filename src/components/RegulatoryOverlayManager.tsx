import { CatalogManager } from "@/components/CatalogManager";

export function RegulatoryOverlayManager() {
  return (
    <CatalogManager
      resourcePath="/api/regulatory-overlays"
      resourceKey="regulatoryOverlays"
      itemLabel="Regulatory Overlay"
    />
  );
}
