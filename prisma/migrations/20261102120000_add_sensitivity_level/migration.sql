-- Sensitivity Level replaces the Confidentiality Impact Level (#290, ADR 0011).
--
-- 1. SensitivityLevel: five fixed, ordered levels keyed by their ordinal. Inserted here
--    (not by the seed) so every database, CI's unseeded one included, has them.
--    The descriptions are placeholders the product owner may reword later; they are all
--    in this one INSERT.
-- 2. System.sensitivityLevel and Control.minSensitivityLevel, nullable foreign keys to it.
-- 3. Copy from the old columns: LOW -> 2 Internal, MODERATE -> 3 Sensitive,
--    HIGH -> 4 Highly Sensitive, CRITICAL -> 5 Critical Sensitivity, NULL -> NULL.
--    Nothing migrates to 1 Public.
-- 4. Drop the old columns. The ImpactLevel enum stays: Integrity and Availability use it.
--
-- Cannot raise: every old value maps through a CASE with a NULL fallback, the foreign keys
-- point at rows inserted above, and on an empty database it only creates and fills the table.

-- CreateTable
CREATE TABLE "SensitivityLevel" (
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "textColor" TEXT NOT NULL,
    "backgroundColor" TEXT NOT NULL,

    CONSTRAINT "SensitivityLevel_pkey" PRIMARY KEY ("level"),
    CONSTRAINT "SensitivityLevel_level_check" CHECK ("level" BETWEEN 1 AND 5)
);

INSERT INTO "SensitivityLevel" ("level", "label", "description", "textColor", "backgroundColor") VALUES
    (1, 'Public', 'Information anyone may see. Publishing it harms nobody.', '#475569', '#F1F5F9'),
    (2, 'Internal', 'Everyday business information meant for staff, not for the public.', '#1D4ED8', '#EFF6FF'),
    (3, 'Sensitive', 'Information that would cause harm or embarrassment if it leaked.', '#854D0E', '#FEF9C3'),
    (4, 'Highly Sensitive', 'Information whose leak would seriously harm people or the business, or break the law.', '#9A3412', '#FFEDD5'),
    (5, 'Critical Sensitivity', 'Information whose leak or loss would threaten the organisation itself.', '#991B1B', '#FEE2E2')
ON CONFLICT ("level") DO NOTHING;

-- AlterTable
ALTER TABLE "System" ADD COLUMN "sensitivityLevel" INTEGER;
ALTER TABLE "Control" ADD COLUMN "minSensitivityLevel" INTEGER;

-- Copy
UPDATE "System" SET "sensitivityLevel" = CASE "confidentialityImpactLevel"
    WHEN 'LOW' THEN 2
    WHEN 'MODERATE' THEN 3
    WHEN 'HIGH' THEN 4
    WHEN 'CRITICAL' THEN 5
    ELSE NULL
END
WHERE "confidentialityImpactLevel" IS NOT NULL;

UPDATE "Control" SET "minSensitivityLevel" = CASE "minConfidentialityImpactLevel"
    WHEN 'LOW' THEN 2
    WHEN 'MODERATE' THEN 3
    WHEN 'HIGH' THEN 4
    WHEN 'CRITICAL' THEN 5
    ELSE NULL
END
WHERE "minConfidentialityImpactLevel" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_sensitivityLevel_fkey" FOREIGN KEY ("sensitivityLevel") REFERENCES "SensitivityLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Control" ADD CONSTRAINT "Control_minSensitivityLevel_fkey" FOREIGN KEY ("minSensitivityLevel") REFERENCES "SensitivityLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropColumns
ALTER TABLE "System" DROP COLUMN "confidentialityImpactLevel";
ALTER TABLE "Control" DROP COLUMN "minConfidentialityImpactLevel";
