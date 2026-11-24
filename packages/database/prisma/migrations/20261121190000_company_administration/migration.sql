-- Add new enum values to Role
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'USER';

-- Create Enums
CREATE TYPE "AdminPositionStatus" AS ENUM ('VACANT', 'OCCUPIED', 'SUSPENDED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "SupportCaseCategory" AS ENUM (
    'ONBOARDING',
    'CHANNEL_ISSUE',
    'STUDIO_SUPPORT',
    'UPLOAD_ISSUE',
    'PROCESSING_FAILURE',
    'METADATA_THUMBNAIL',
    'SUBSCRIPTION_INQUIRY',
    'MONETIZATION_SUPPORT',
    'USER_COMPLAINT',
    'CONTENT_REPORT',
    'PAYOUT_STATUS',
    'OTHER'
);
CREATE TYPE "SupportCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED');
CREATE TYPE "ApprovalRequestType" AS ENUM (
    'GLOBAL_MONETIZATION_CHANGE',
    'FINANCIAL_ADJUSTMENT',
    'SECURITY_POLICY_CHANGE',
    'PLATFORM_CONFIG_CHANGE',
    'OTHER'
);
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable: AdminPosition
CREATE TABLE "AdminPosition" (
    "positionNumber" INTEGER NOT NULL,
    "status" "AdminPositionStatus" NOT NULL DEFAULT 'VACANT',
    "userId" UUID,
    "assignment" TEXT,
    "assignedAt" TIMESTAMP(3),
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPosition_pkey" PRIMARY KEY ("positionNumber")
);

-- Seed the exactly three designated Admin positions as VACANT
INSERT INTO "AdminPosition" ("positionNumber", "status", "userId", "assignment", "assignedAt", "permissions", "updatedAt")
VALUES
    (1, 'VACANT', NULL, NULL, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    (2, 'VACANT', NULL, NULL, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
    (3, 'VACANT', NULL, NULL, NULL, ARRAY[]::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("positionNumber") DO NOTHING;

-- CreateTable: AdminInvitation
CREATE TABLE "AdminInvitation" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "positionNumber" INTEGER NOT NULL,
    "assignment" TEXT NOT NULL,
    "customPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "acceptedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportCase
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "caseReference" TEXT NOT NULL,
    "creatorOrUserId" UUID,
    "channelId" UUID,
    "videoId" UUID,
    "reporterEmail" TEXT,
    "category" "SupportCaseCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "SupportCasePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedAdminId" UUID,
    "assignedPositionNumber" INTEGER,
    "createdById" UUID,
    "resolvedById" UUID,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportCaseNote
CREATE TABLE "SupportCaseNote" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportCaseActivity
CREATE TABLE "SupportCaseActivity" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ApprovalRequest
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "type" "ApprovalRequestType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewerNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AdminAuditLog
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetResource" TEXT NOT NULL,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPosition_userId_key" ON "AdminPosition"("userId");
CREATE UNIQUE INDEX "AdminInvitation_tokenHash_key" ON "AdminInvitation"("tokenHash");
CREATE UNIQUE INDEX "AdminInvitation_acceptedById_key" ON "AdminInvitation"("acceptedById");
CREATE INDEX "AdminInvitation_email_idx" ON "AdminInvitation"("email");
CREATE INDEX "AdminInvitation_status_idx" ON "AdminInvitation"("status");
CREATE UNIQUE INDEX "SupportCase_caseReference_key" ON "SupportCase"("caseReference");
CREATE INDEX "SupportCase_status_priority_createdAt_idx" ON "SupportCase"("status", "priority", "createdAt");
CREATE INDEX "SupportCase_assignedAdminId_idx" ON "SupportCase"("assignedAdminId");
CREATE INDEX "SupportCase_channelId_idx" ON "SupportCase"("channelId");
CREATE INDEX "SupportCase_creatorOrUserId_idx" ON "SupportCase"("creatorOrUserId");
CREATE INDEX "SupportCaseNote_caseId_createdAt_idx" ON "SupportCaseNote"("caseId", "createdAt");
CREATE INDEX "SupportCaseActivity_caseId_createdAt_idx" ON "SupportCaseActivity"("caseId", "createdAt");
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX "AdminAuditLog_actorId_idx" ON "AdminAuditLog"("actorId");
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");
CREATE INDEX "AdminAuditLog_targetResource_idx" ON "AdminAuditLog"("targetResource");

-- AddForeignKey
ALTER TABLE "AdminPosition" ADD CONSTRAINT "AdminPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_creatorOrUserId_fkey" FOREIGN KEY ("creatorOrUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportCaseNote" ADD CONSTRAINT "SupportCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCaseNote" ADD CONSTRAINT "SupportCaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCaseActivity" ADD CONSTRAINT "SupportCaseActivity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCaseActivity" ADD CONSTRAINT "SupportCaseActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
