-- Review Groups (#197): a named set of Users that reviews the Frameworks it is tied to.
-- Purely additive: one new table, one new join table and one nullable column on "Framework".
-- No existing row changes and there is no data to migrate; every Framework starts untied.
-- The Framework -> ReviewGroup foreign key is ON DELETE RESTRICT, so the database itself backs
-- "a Review Group can't be deleted while it is tied to a Framework".

-- AlterTable
ALTER TABLE "Framework" ADD COLUMN     "reviewGroupId" TEXT;

-- CreateTable
CREATE TABLE "ReviewGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ReviewGroupMember" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ReviewGroupMember_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewGroup_name_key" ON "ReviewGroup"("name");

-- CreateIndex
CREATE INDEX "_ReviewGroupMember_B_index" ON "_ReviewGroupMember"("B");

-- AddForeignKey
ALTER TABLE "Framework" ADD CONSTRAINT "Framework_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReviewGroupMember" ADD CONSTRAINT "_ReviewGroupMember_A_fkey" FOREIGN KEY ("A") REFERENCES "ReviewGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ReviewGroupMember" ADD CONSTRAINT "_ReviewGroupMember_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
