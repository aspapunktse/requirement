-- CreateTable
CREATE TABLE "RequirementQuery" (
    "id" TEXT NOT NULL,
    "requirementAssessmentId" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAuthorId" TEXT NOT NULL,

    CONSTRAINT "RequirementQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryMessage" (
    "id" TEXT NOT NULL,
    "requirementQueryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RequirementQuery" ADD CONSTRAINT "RequirementQuery_requirementAssessmentId_fkey" FOREIGN KEY ("requirementAssessmentId") REFERENCES "RequirementAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementQuery" ADD CONSTRAINT "RequirementQuery_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryMessage" ADD CONSTRAINT "QueryMessage_requirementQueryId_fkey" FOREIGN KEY ("requirementQueryId") REFERENCES "RequirementQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryMessage" ADD CONSTRAINT "QueryMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
