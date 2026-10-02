-- Provider dependencies (PRD 0001 F-IN.3, ADR 0008, #124). A System declares the Providers it depends
-- on and inherits their Full Control Offerings live; this is the System-to-System relation.
--
-- Additive, no data change: the table starts empty (the seed creates no dependency), so nothing
-- inherits anything and no System's status moves until someone declares one. A no-op on an empty
-- database apart from the new objects. No enum value is added: declaring and removing a dependency
-- are CLASSIFICATION_CHANGED events, and a moved effective status is ASSESSMENT_STATUS_CHANGED.
--
-- That the Provider is a System marked as a Provider, and that a System never depends on itself, are
-- enforced by the route (409), not by the schema.

-- CreateTable
CREATE TABLE "ProviderDependency" (
    "id" TEXT NOT NULL,
    "dependentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderDependency_providerId_idx" ON "ProviderDependency"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDependency_dependentId_providerId_key" ON "ProviderDependency"("dependentId", "providerId");

-- AddForeignKey
-- CASCADE: a dependency belongs to the dependent System and goes with it.
ALTER TABLE "ProviderDependency" ADD CONSTRAINT "ProviderDependency_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: a dependency on a Provider goes with the Provider (Systems are never deleted in the app today).
ALTER TABLE "ProviderDependency" ADD CONSTRAINT "ProviderDependency_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
