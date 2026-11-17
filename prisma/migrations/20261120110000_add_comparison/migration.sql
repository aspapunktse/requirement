-- Comparison (#372): a named record that sets two to five Systems side by side, with its Candidates and participants.
-- Structure only: no rows are read, copied or changed, so it is a no-op on an empty database and on existing data.
--   Comparison.owner            Restrict: a User who owns a Comparison can't be deleted until it is handed over or deleted.
--   ComparisonCandidate.system  Cascade: deleting a System removes its Candidate rows (the Comparison loses that Candidate).
--   ComparisonCandidate.comparison / ComparisonParticipant.comparison  Cascade: deleting a Comparison leaves the Systems untouched.
--   ComparisonCandidate.addedBy SetNull: deleting the User who added a Candidate keeps the Candidate.
--   ComparisonParticipant.user  Cascade.

-- CreateTable
CREATE TABLE "Comparison" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "need" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonCandidate" (
    "comparisonId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "ComparisonCandidate_pkey" PRIMARY KEY ("comparisonId","systemId")
);

-- CreateTable
CREATE TABLE "ComparisonParticipant" (
    "comparisonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparisonParticipant_pkey" PRIMARY KEY ("comparisonId","userId")
);

-- CreateIndex
CREATE INDEX "Comparison_ownerId_idx" ON "Comparison"("ownerId");

-- CreateIndex
CREATE INDEX "ComparisonCandidate_systemId_idx" ON "ComparisonCandidate"("systemId");

-- CreateIndex
CREATE INDEX "ComparisonParticipant_userId_idx" ON "ComparisonParticipant"("userId");

-- AddForeignKey
ALTER TABLE "Comparison" ADD CONSTRAINT "Comparison_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCandidate" ADD CONSTRAINT "ComparisonCandidate_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCandidate" ADD CONSTRAINT "ComparisonCandidate_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCandidate" ADD CONSTRAINT "ComparisonCandidate_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonParticipant" ADD CONSTRAINT "ComparisonParticipant_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "Comparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonParticipant" ADD CONSTRAINT "ComparisonParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
