-- About the system (#357): vendor, service, data location and contract details on a System, and the
-- "needs vendor details" flag on Deployment Facets. Additive only: nullable columns, a flag that
-- defaults to false.

-- CreateEnum
CREATE TYPE "DataLocation" AS ENUM ('SWEDEN', 'EU_EEA', 'OUTSIDE_EU_EEA', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataProcessingAgreementStatus" AS ENUM ('SIGNED', 'IN_PROGRESS', 'NOT_SIGNED', 'NOT_NEEDED');

-- AlterTable
ALTER TABLE "System"
  ADD COLUMN "vendorWebsiteUrl" TEXT,
  ADD COLUMN "serviceUrl" TEXT,
  ADD COLUMN "productPlan" TEXT,
  ADD COLUMN "vendorTrustUrl" TEXT,
  ADD COLUMN "dataLocation" "DataLocation",
  ADD COLUMN "dataProcessingAgreement" "DataProcessingAgreementStatus",
  ADD COLUMN "contractReference" TEXT,
  ADD COLUMN "contractRenewalDate" DATE,
  ADD COLUMN "noticePeriodMonths" INTEGER;

-- AlterTable
ALTER TABLE "DeploymentFacet" ADD COLUMN "requiresVendorDetails" BOOLEAN NOT NULL DEFAULT false;

-- Data: the facet named SaaS (any case) needs vendor details. A no-op when there is none, and safe to
-- run again.
UPDATE "DeploymentFacet" SET "requiresVendorDetails" = true WHERE lower("name") = 'saas';
