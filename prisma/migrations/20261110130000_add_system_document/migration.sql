-- What a System has provided against each Document Requirement (#324, PRD 0002 F-DOC.2). Creates two tables (SystemDocument, and
-- SystemDocumentFile holding the one uploaded file's bytes) with their indexes and foreign keys; no data change and no backfill (no row means "not provided"). Cannot raise: it only
-- creates new objects. Both the System and the Document Requirement cascade, so deleting either removes its rows;
-- the last editor is cleared (SET NULL) if that User is ever deleted.

-- CreateTable
CREATE TABLE "SystemDocument" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "documentRequirementId" TEXT NOT NULL,
    "link" TEXT,
    "provided" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemDocument_documentRequirementId_idx" ON "SystemDocument"("documentRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemDocument_systemId_documentRequirementId_key" ON "SystemDocument"("systemId", "documentRequirementId");

-- AddForeignKey
ALTER TABLE "SystemDocument" ADD CONSTRAINT "SystemDocument_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemDocument" ADD CONSTRAINT "SystemDocument_documentRequirementId_fkey" FOREIGN KEY ("documentRequirementId") REFERENCES "DocumentRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemDocument" ADD CONSTRAINT "SystemDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SystemDocumentFile" (
    "id" TEXT NOT NULL,
    "systemDocumentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "SystemDocumentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemDocumentFile_systemDocumentId_key" ON "SystemDocumentFile"("systemDocumentId");

-- AddForeignKey
ALTER TABLE "SystemDocumentFile" ADD CONSTRAINT "SystemDocumentFile_systemDocumentId_fkey" FOREIGN KEY ("systemDocumentId") REFERENCES "SystemDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemDocumentFile" ADD CONSTRAINT "SystemDocumentFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
