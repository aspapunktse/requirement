-- Information Type catalogue (#303, ADR 0012). Creates tables only; no data (the seed adds examples for the dev DB).
--
-- 1. InformationType: unique name, optional description, one Sensitivity Level (required, ON DELETE RESTRICT).
-- 2. _InformationTypeToSystem: Prisma's implicit many-to-many join table, the System's declared types.
--    A = InformationType id, B = System id (alphabetical model order). Deleting either side removes its rows.
--
-- Cannot raise: it only creates new tables and constraints.

-- CreateTable
CREATE TABLE "InformationType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sensitivityLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_InformationTypeToSystem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InformationTypeToSystem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "InformationType_name_key" ON "InformationType"("name");

-- CreateIndex
CREATE INDEX "_InformationTypeToSystem_B_index" ON "_InformationTypeToSystem"("B");

-- AddForeignKey
ALTER TABLE "InformationType" ADD CONSTRAINT "InformationType_sensitivityLevel_fkey" FOREIGN KEY ("sensitivityLevel") REFERENCES "SensitivityLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InformationTypeToSystem" ADD CONSTRAINT "_InformationTypeToSystem_A_fkey" FOREIGN KEY ("A") REFERENCES "InformationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InformationTypeToSystem" ADD CONSTRAINT "_InformationTypeToSystem_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
