-- CreateTable
CREATE TABLE "_CapabilityToRequirement" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CapabilityToRequirement_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RequirementToSystemType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RequirementToSystemType_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CapabilityToRequirement_B_index" ON "_CapabilityToRequirement"("B");

-- CreateIndex
CREATE INDEX "_RequirementToSystemType_B_index" ON "_RequirementToSystemType"("B");

-- AddForeignKey
ALTER TABLE "_CapabilityToRequirement" ADD CONSTRAINT "_CapabilityToRequirement_A_fkey" FOREIGN KEY ("A") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CapabilityToRequirement" ADD CONSTRAINT "_CapabilityToRequirement_B_fkey" FOREIGN KEY ("B") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RequirementToSystemType" ADD CONSTRAINT "_RequirementToSystemType_A_fkey" FOREIGN KEY ("A") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RequirementToSystemType" ADD CONSTRAINT "_RequirementToSystemType_B_fkey" FOREIGN KEY ("B") REFERENCES "SystemType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
