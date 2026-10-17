-- Thumbs-up voting on the public design proposals landing page (#186).
-- Purely additive: one new table, no change to any existing row, no data migration.

-- CreateTable
CREATE TABLE "DesignVote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignVote_voterId_idx" ON "DesignVote"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignVote_proposalId_voterId_key" ON "DesignVote"("proposalId", "voterId");
