-- Document Requirements catalogue (#323, PRD 0002 F-DOC.1). Creates two enum types and one table; no data change,
-- no backfill, and nothing references the table yet. Cannot raise: it only creates new objects.
--
-- The two CHECK constraints are not in schema.prisma (Prisma does not model them, and `migrate diff` ignores them).
-- They back up what the API already refuses: at least one Track, and no Self Track on first documentation, which is
-- a Full-track stage.

-- CreateEnum
CREATE TYPE "EvaluationTrack" AS ENUM ('SELF', 'FULL');

-- CreateEnum
CREATE TYPE "DocumentationStage" AS ENUM ('FIRST_DOCUMENTATION', 'SECOND_ROUND');

-- CreateTable
CREATE TABLE "DocumentRequirement" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stage" "DocumentationStage" NOT NULL,
    "tracks" "EvaluationTrack"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRequirement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentRequirement_tracks_not_empty" CHECK (cardinality("tracks") >= 1),
    CONSTRAINT "DocumentRequirement_first_documentation_is_full" CHECK ("stage" <> 'FIRST_DOCUMENTATION' OR NOT ('SELF' = ANY("tracks")))
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequirement_name_key" ON "DocumentRequirement"("name");
