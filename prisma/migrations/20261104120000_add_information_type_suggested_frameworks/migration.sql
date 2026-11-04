-- Information Types suggest Frameworks (#300, ADR 0013). Creates tables only; no data (the seed links the example
-- "personal data" type to GDPR on the dev DB).
--
-- 1. _InformationTypeSuggestedFramework: Prisma's implicit many-to-many join table, the Frameworks a type suggests.
--    A = Framework id, B = InformationType id (alphabetical model order). Deleting either side removes its rows.
-- 2. FrameworkSuggestionDecline: one row per (System, Information Type, Framework) the System's owner left out.
--    Primary key is the triple; all three foreign keys are ON DELETE CASCADE.
--
-- Cannot raise: it only creates new tables and constraints.

-- CreateTable
CREATE TABLE "FrameworkSuggestionDecline" (
    "systemId" TEXT NOT NULL,
    "informationTypeId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkSuggestionDecline_pkey" PRIMARY KEY ("systemId","informationTypeId","frameworkId")
);

-- CreateTable
CREATE TABLE "_InformationTypeSuggestedFramework" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InformationTypeSuggestedFramework_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "FrameworkSuggestionDecline_informationTypeId_idx" ON "FrameworkSuggestionDecline"("informationTypeId");

-- CreateIndex
CREATE INDEX "FrameworkSuggestionDecline_frameworkId_idx" ON "FrameworkSuggestionDecline"("frameworkId");

-- CreateIndex
CREATE INDEX "_InformationTypeSuggestedFramework_B_index" ON "_InformationTypeSuggestedFramework"("B");

-- AddForeignKey
ALTER TABLE "FrameworkSuggestionDecline" ADD CONSTRAINT "FrameworkSuggestionDecline_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkSuggestionDecline" ADD CONSTRAINT "FrameworkSuggestionDecline_informationTypeId_fkey" FOREIGN KEY ("informationTypeId") REFERENCES "InformationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkSuggestionDecline" ADD CONSTRAINT "FrameworkSuggestionDecline_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InformationTypeSuggestedFramework" ADD CONSTRAINT "_InformationTypeSuggestedFramework_A_fkey" FOREIGN KEY ("A") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InformationTypeSuggestedFramework" ADD CONSTRAINT "_InformationTypeSuggestedFramework_B_fkey" FOREIGN KEY ("B") REFERENCES "InformationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
