-- #227: a daily snapshot of each User's Home stat figures, so trend lines can be exact.
-- A new, empty table only (CREATE TABLE, index, foreign key): no existing row changes, so it is a
-- no-op on an empty database and cannot raise.

-- CreateTable
CREATE TABLE "StatSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "statKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatSnapshot_userId_statKey_day_key" ON "StatSnapshot"("userId", "statKey", "day");

-- AddForeignKey
ALTER TABLE "StatSnapshot" ADD CONSTRAINT "StatSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
