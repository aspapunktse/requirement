-- CreateTable
CREATE TABLE "_CapabilityToSystem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CapabilityToSystem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CapabilityToSystem_B_index" ON "_CapabilityToSystem"("B");

-- AddForeignKey
ALTER TABLE "_CapabilityToSystem" ADD CONSTRAINT "_CapabilityToSystem_A_fkey" FOREIGN KEY ("A") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CapabilityToSystem" ADD CONSTRAINT "_CapabilityToSystem_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
