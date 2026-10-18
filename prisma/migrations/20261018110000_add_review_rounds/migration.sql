-- Review Rounds (#198, ADR 0010): every Approval belongs to one Review Round, and a Review Step is a
-- decision by the base step (reviewGroupId NULL) or by a Review Group. Steps themselves are derived live
-- and not stored.
--
-- Data: nothing is dropped and no existing column changes.
--   * Every existing Approval gets a Review Round of its own and stays a base-step decision. The round's
--     submittedAt is the System's latest SYSTEM_SUBMITTED Change Event at or before the decision, or the
--     decision's own time when there is none (seeded data, older Systems).
--   * Every System In Review gets one open round with no Approvals, submittedAt from its latest
--     SYSTEM_SUBMITTED event, falling back to the System's updatedAt, and never earlier than any of its
--     Approvals, so it is the System's latest round.
-- Round ids are derived from the Approval or System id with md5, so a rerun is a no-op (ON CONFLICT DO
-- NOTHING) and the Approval -> round link needs no lookup. It is a no-op on an empty database. It cannot
-- raise: SET NOT NULL runs after the UPDATE has given every Approval a round, and the foreign keys point
-- at rows this migration just wrote. So there is no pre-check script.
-- Approval.reviewGroupId is ON DELETE RESTRICT: deleting a Review Group must neither erase its recorded
-- decisions nor turn them into base-step ones.

-- CreateTable
CREATE TABLE "ReviewRound" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id")
);

-- AlterTable (reviewRoundId is nullable until the backfill below has run)
ALTER TABLE "Approval" ADD COLUMN     "reviewGroupId" TEXT,
ADD COLUMN     "reviewRoundId" TEXT;

-- Backfill: one round per existing Approval.
INSERT INTO "ReviewRound" ("id", "systemId", "submittedAt")
SELECT
    md5('review-round:approval:' || a."id"),
    a."systemId",
    COALESCE(
        (SELECT max(e."createdAt") FROM "ChangeEvent" e
          WHERE e."systemId" = a."systemId" AND e."action" = 'SYSTEM_SUBMITTED' AND e."createdAt" <= a."decidedAt"),
        a."decidedAt"
    )
FROM "Approval" a
ON CONFLICT ("id") DO NOTHING;

UPDATE "Approval"
SET "reviewRoundId" = md5('review-round:approval:' || "id")
WHERE "reviewRoundId" IS NULL;

-- Backfill: one open round per System In Review.
INSERT INTO "ReviewRound" ("id", "systemId", "submittedAt")
SELECT
    md5('review-round:in-review:' || s."id"),
    s."id",
    GREATEST(
        COALESCE(
            (SELECT max(e."createdAt") FROM "ChangeEvent" e
              WHERE e."systemId" = s."id" AND e."action" = 'SYSTEM_SUBMITTED'),
            s."updatedAt"
        ),
        COALESCE((SELECT max(a."decidedAt") FROM "Approval" a WHERE a."systemId" = s."id"), '-infinity'::timestamp)
    )
FROM "System" s
WHERE s."status" = 'IN_REVIEW'
ON CONFLICT ("id") DO NOTHING;

-- Every Approval now has a round.
ALTER TABLE "Approval" ALTER COLUMN "reviewRoundId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ReviewRound_systemId_submittedAt_idx" ON "ReviewRound"("systemId", "submittedAt");

-- CreateIndex
CREATE INDEX "Approval_reviewRoundId_idx" ON "Approval"("reviewRoundId");

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reviewRoundId_fkey" FOREIGN KEY ("reviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
